import { scheduleMicroTask } from 'hostConfig';
import { beginWork } from './beginWork';
import {
  commitHookEffectListCreate,
  commitHookEffectListDestroy,
  commitHookEffectListUnmount,
  commitLayoutEffects,
  commitMutationEffects
} from './commitWork';
import { completeWork } from './completeWork';
import {
  createWorkInProgress,
  FiberNode,
  FiberRootNode,
  PendingPassiveEffects
} from './fiber';
import {
  HostEffectMask,
  MutationMask,
  NoFlags,
  PassiveEffect,
  PassiveMask
} from './fiberFlags';
import {
  getHighestPriorityLane,
  getNextLane,
  Lane,
  lanesToSchedulerPriority,
  markRootFinished,
  markRootSuspended,
  mergeLanes,
  NoLane,
  SyncLane
} from './fiberLanes';
import { flushSyncCallbacks, scheduleSyncCallback } from './syncTaskQueue';
import { HostRoot } from './workTags';
import {
  unstable_scheduleCallback as scheduleCallback, // 调度回调函数
  unstable_NormalPriority as NormalPriority, // 优先级
  unstable_shouldYield,
  unstable_cancelCallback
} from 'scheduler';
import { HookHasEffect, Passive } from './hookEffectTags';
import { throwException } from './fiberThrow';
import { SuspenseException, getSuspenseThenable } from './thenable';
import { unwindWork } from './fiberUnwindWork';
import { resetHooksOnUnwind } from './fiberHooks';

// 正在工作的 FiberNode
let workInProgress: FiberNode | null = null;
// 本次更新的 lane
let wipRootRenderLane: Lane = NoLane;
// 是否正在调度执行 PassiveEffect
let rootDoesHasPassiveEffects = false;

type RootExitStatus = number;
// 工作中的状态
const RootInProgress = 0;
// 并发中间状态
const RootInComplete = 1;
// 完成状态
const RootCompleted = 2;
// 未完成状态，不用进入commit阶段
const RootDidNotComplete = 3;
let workInProgressRootExitStatus: number = RootInProgress;

// Suspense
type SuspendedReason =
  | typeof NotSuspended
  | typeof SuspendedOnError
  | typeof SuspendedOnData
  | typeof SuspendedOnDeprecatedThrowPromise;
const NotSuspended = 0;
const SuspendedOnError = 1;
const SuspendedOnData = 2;
const SuspendedOnDeprecatedThrowPromise = 4;

let workInProgressSuspendedReason: SuspendedReason = NotSuspended;
let workInProgressThrownValue: any = null;

// 开始渲染前初始化状态
function prepareFreshStack(root: FiberRootNode, lane: Lane) {
  root.finishedLane = NoLane;
  root.finishedWork = null;

  // 创建 workInProgress
  workInProgress = createWorkInProgress(root.current, {});
  // 赋值当前的 lane
  wipRootRenderLane = lane;

  workInProgressRootExitStatus = RootInProgress;
  workInProgressSuspendedReason = NotSuspended;
  workInProgressThrownValue = null;
}

// 在 Fiber 中调度任务
export function scheduleUpdateOnFiber(fiber: FiberNode, lane: Lane) {
  // 找到根节点
  const root = markUpdateLaneFromFiberToRoot(fiber, lane);

  // 标记 lane
  markRootUpdated(root, lane);

  // 进入调度过程
  ensureRootIsScheduled(root);
}

// schedule 阶段入口
export function ensureRootIsScheduled(root: FiberRootNode) {
  const updateLane = getNextLane(root);
  const existingCallback = root.callbackNode;

  // 没有对应更新的 update
  if (updateLane === NoLane) {
    if (existingCallback !== null) {
      unstable_cancelCallback(existingCallback);
    }
    root.callbackNode = null;
    root.callbackPriority = NoLane;
    return;
  }

  const curPriority = updateLane;
  const prevPriority = root.callbackPriority;

  if (curPriority === prevPriority) {
    return;
  }

  if (existingCallback !== null) {
    unstable_cancelCallback(existingCallback);
  }
  let newCallbackNode = null;

  if (__DEV__) {
    console.log(
      `在${updateLane === SyncLane ? '微' : '宏'}任务中调度，优先级：`,
      updateLane
    );
  }

  if (updateLane === SyncLane) {
    // 调度同步任务（向同步任务队列中插入任务）：[performSyncWorkOnRoot, performSyncWorkOnRoot, performSyncWorkOnRoot]
    scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root, updateLane));

    // 同步任务，用微任务调度
    scheduleMicroTask(flushSyncCallbacks);
  } else {
    // 其他优先级 用宏任务调度
    const schedulerPriority = lanesToSchedulerPriority(updateLane);

    // 执行
    newCallbackNode = scheduleCallback(
      schedulerPriority,
      // @ts-ignore
      performConcurrentWorkOnRoot.bind(null, root)
    );
  }
  root.callbackNode = newCallbackNode;
  root.callbackPriority = curPriority;
}

// 调度阶段，在 fiberRoot 中标记(追加)当前的 lane
export function markRootUpdated(root: FiberRootNode, lane: Lane) {
  root.pendingLanes = mergeLanes(root.pendingLanes, lane);
}

// 从当前 Fiber 节点查到到根节点
export function markUpdateLaneFromFiberToRoot(fiber: FiberNode, lane: Lane) {
  let node = fiber;
  let parent = node.return;
  while (parent !== null) {
    parent.childLanes = mergeLanes(parent.childLanes, lane);
    const alternate = parent.alternate;
    if (alternate !== null) {
      alternate.childLanes = mergeLanes(alternate.childLanes, lane);
    }

    node = parent;
    parent = node.return;
  }
  if (node.tag === HostRoot) {
    return node.stateNode;
  }
  return null;
}

// 调度并发（异步）任务
function performConcurrentWorkOnRoot(
  root: FiberRootNode,
  didTimeout: boolean
): any {
  // 保证useEffect回调执行
  const curCallback = root.callbackNode;
  const didFlushPassiveEffect = flushPassiveEffects(root.pendingPassiveEffects);
  if (didFlushPassiveEffect) {
    if (root.callbackNode !== curCallback) {
      return null;
    }
  }

  const lane = getNextLane(root);
  const curCallbackNode = root.callbackNode;
  if (lane === NoLane) {
    return null;
  }
  const needSync = lane === SyncLane || didTimeout;

  // render阶段
  const exitStatus = renderRoot(root, lane, !needSync);

  switch (exitStatus) {
    // 中断
    case RootInComplete:
      if (root.callbackNode !== curCallbackNode) {
        return null;
      }
      return performConcurrentWorkOnRoot.bind(null, root);
    case RootCompleted:
      // 获取到带有 Flags 完成的 workInProgressFiber
      const finishedWork = root.current.alternate;
      root.finishedWork = finishedWork;
      root.finishedLane = lane;
      wipRootRenderLane = NoLane;

      // 进入 commit 阶段
      commitRoot(root);
      break;
    case RootDidNotComplete:
      markRootSuspended(root, lane);
      wipRootRenderLane = NoLane;
      ensureRootIsScheduled(root);
      break;
    default:
      if (__DEV__) {
        console.error('还未实现的并发更新结束状态');
      }
  }
}

// 调度同步任务
function performSyncWorkOnRoot(root: FiberRootNode) {
  // 同一批同步任务，此处要执行多次；
  const nextLane = getNextLane(root);

  // 所以每次都要判断 nextLane 是否为同步任务
  if (nextLane !== SyncLane) {
    // 1、其他比SyncLane低的优先级
    // 2、NoLane
    ensureRootIsScheduled(root);
    return;
  }

  const exitStatus = renderRoot(root, nextLane, false);

  switch (exitStatus) {
    case RootCompleted:
      const finishedWork = root.current.alternate;
      root.finishedWork = finishedWork;
      root.finishedLane = nextLane;
      wipRootRenderLane = NoLane;
      commitRoot(root);
      break;
    case RootDidNotComplete:
      wipRootRenderLane = NoLane;
      markRootSuspended(root, nextLane);
      ensureRootIsScheduled(root);
      break;
    default:
      if (__DEV__) {
        console.error('还未实现的同步更新结束状态');
      }
      break;
  }
}

let c = 0;

/**
 * 开始进行渲染更新(递归两阶段)，以下方法触发此函数
 * ReactDOM.createRoot().render、ReactDOM.render
 * this.setState
 * useState
 * dispatch
 */
function renderRoot(root: FiberRootNode, lane: Lane, shouldTimeSlice: boolean) {
  if (__DEV__) {
    console.log(`开始${shouldTimeSlice ? '并发' : '同步'}更新`, root);
  }

  if (wipRootRenderLane !== lane) {
    // 开始渲染前初始化状态
    prepareFreshStack(root, lane);
  }

  do {
    try {
      if (
        workInProgressSuspendedReason !== NotSuspended &&
        workInProgress !== null
      ) {
        const thrownValue = workInProgressThrownValue;

        workInProgressSuspendedReason = NotSuspended;
        workInProgressThrownValue = null;

        throwAndUnwindWorkLoop(root, workInProgress, thrownValue, lane);
      }

      shouldTimeSlice ? workLoopConcurrent() : workLoopSync();
      break;
    } catch (e) {
      if (__DEV__) {
        console.warn('workLoop发生错误', e);
      }
      c++;
      if (c > 20) {
        break;
        console.warn('break!');
      }
      handleThrow(root, e);
    }
  } while (true);

  if (workInProgressRootExitStatus !== RootInProgress) {
    return workInProgressRootExitStatus;
  }

  // 中断执行
  if (shouldTimeSlice && workInProgress !== null) {
    return RootInComplete;
  }
  // render阶段执行完
  if (!shouldTimeSlice && workInProgress !== null && __DEV__) {
    console.error(`render阶段结束时wip不应该不是null`);
  }
  return RootCompleted;
}

// commit 包含三个子阶段：beforeMutation(突变前)、mutation(突变)、layout
// 1、fiber 树的切换：root.current = finishedWork
// 2、对元素的 Effect 执行对应的操作
function commitRoot(root: FiberRootNode) {
  // 之前构造好的带有 Flags 的 wip
  const finishedWork = root.finishedWork;

  if (finishedWork === null) {
    return;
  }

  if (__DEV__) {
    console.warn('commit阶段开始', finishedWork);
  }
  const lane = root.finishedLane;

  if (lane === NoLane && __DEV__) {
    console.error('commit阶段finishedLane不应该是NoLane');
  }

  // 重置
  root.finishedWork = null;
  root.finishedLane = NoLane;

  markRootFinished(root, lane);

  if (
    (finishedWork.flags & PassiveMask) !== NoFlags ||
    (finishedWork.subtreeFlags & PassiveMask) !== NoFlags
  ) {
    if (!rootDoesHasPassiveEffects) {
      rootDoesHasPassiveEffects = true;
      // 调度副作用：
      // 1、以 NormalPriority 优先级进行调度
      // 2、在 setTimeout 中被执行的副作用函数 flushPassiveEffects
      scheduleCallback(NormalPriority, () => {
        // 执行副作用
        flushPassiveEffects(root.pendingPassiveEffects);
        return;
      });
    }
  }

  // 判断是否存在3个子阶段需要执行的操作
  // root flags root subtreeFlags
  const subtreeHasEffect =
    (finishedWork.subtreeFlags & (MutationMask | PassiveMask)) !== NoFlags;
  const rootHasEffect =
    (finishedWork.flags & (MutationMask | PassiveMask)) !== NoFlags;

  if (subtreeHasEffect || rootHasEffect) {
    // beforeMutation

    // 从根节点找到变更的元素，执行对应操作
    // 进行 mutation
    commitMutationEffects(finishedWork, root);

    // 阶段：切换 fibber 树
    root.current = finishedWork;

    // 阶段3/3:Layout
    commitLayoutEffects(finishedWork, root);
  } else {
    root.current = finishedWork;
  }

  rootDoesHasPassiveEffects = false;
  ensureRootIsScheduled(root);
}

// 执行副作用：本次更新的任何create回调函数都必须在上一次更新的destory回到函数后执行
// 整体执行流程包括：
// 1、遍历effect
// 2、首先触发所有unmount effect，且对于某个fiber，如果触发了unmount destroy，本次更新不会再触发update create
// 3、触发所有上次更新的destroy
// 4、触发所有这次更新的create
function flushPassiveEffects(pendingPassiveEffects: PendingPassiveEffects) {
  let didFlushPassiveEffect = false;
  // 先执行 unmount 的副作用函数
  pendingPassiveEffects.unmount.forEach((effect) => {
    didFlushPassiveEffect = true;
    commitHookEffectListUnmount(Passive, effect);
  });
  pendingPassiveEffects.unmount = [];

  // 再执行 update 副作用函数；执行两次、本次更新的任何create回调函数都必须在上一次更新的destory回到函数后执行
  pendingPassiveEffects.update.forEach((effect) => {
    didFlushPassiveEffect = true;
    commitHookEffectListDestroy(Passive | HookHasEffect, effect);
  });
  pendingPassiveEffects.update.forEach((effect) => {
    didFlushPassiveEffect = true;
    commitHookEffectListCreate(Passive | HookHasEffect, effect);
  });
  pendingPassiveEffects.update = [];

  // 回调函数中，还有可能有新的更新；继续执行更新流程
  flushSyncCallbacks();
  return didFlushPassiveEffect;
}

function workLoopSync() {
  while (workInProgress !== null) {
    performUnitOfWork(workInProgress);
  }
}
function workLoopConcurrent() {
  while (workInProgress !== null && !unstable_shouldYield()) {
    performUnitOfWork(workInProgress);
  }
}

// 开始执行工作单元 - 递的阶段
function performUnitOfWork(fiber: FiberNode) {
  // 返回子 Fiber
  const next = beginWork(fiber, wipRootRenderLane);
  // 更改 props 的值
  fiber.memoizedProps = fiber.pendingProps;

  if (next === null) {
    // 找不到子 Fiber 进入归的阶段
    completeUnitOfWork(fiber);
  } else {
    // 将子 Fiber 赋值给 workInProgress
    workInProgress = next;
  }
}

// 完成工作单元 - 归的阶段
function completeUnitOfWork(fiber: FiberNode) {
  let node: FiberNode | null = fiber;

  do {
    // "向上"查找
    completeWork(node);

    // 返回兄弟 Fiber
    const sibling = node.sibling;

    if (sibling !== null) {
      // 有兄弟 Fiber 将 sibling 赋值给 workInProgress
      workInProgress = sibling;
      return;
    }

    // 没有兄弟 Fiber 向上找 father Fiber
    node = node.return;
    // 将 father Fiber 赋值给 workInProgress
    workInProgress = node;
  } while (node !== null);
}

function handleThrow(root: FiberRootNode, thrownValue: any): void {
  /*
		throw可能的情况
			1. use thenable
			2. error (Error Boundary处理)
	*/
  if (thrownValue === SuspenseException) {
    workInProgressSuspendedReason = SuspendedOnData;
    thrownValue = getSuspenseThenable();
  } else {
    const isWakeable =
      thrownValue !== null &&
      typeof thrownValue === 'object' &&
      typeof thrownValue.then === 'function';

    workInProgressThrownValue = thrownValue;
    workInProgressSuspendedReason = isWakeable
      ? SuspendedOnDeprecatedThrowPromise
      : SuspendedOnError;
  }
  workInProgressThrownValue = thrownValue;
}

function throwAndUnwindWorkLoop(
  root: FiberRootNode,
  unitOfWork: FiberNode,
  thrownValue: any,
  lane: Lane
) {
  // unwind前的重置hook，避免 hook0 use hook1 时 use造成中断，再恢复时前后hook对应不上
  resetHooksOnUnwind(unitOfWork);
  throwException(root, thrownValue, lane);
  unwindUnitOfWork(unitOfWork);
}

function unwindUnitOfWork(unitOfWork: FiberNode) {
  let incompleteWork: FiberNode | null = unitOfWork;
  do {
    const next = unwindWork(incompleteWork);

    if (next !== null) {
      next.flags &= HostEffectMask;
      workInProgress = next;
      return;
    }

    const returnFiber = incompleteWork.return as FiberNode;
    if (returnFiber !== null) {
      returnFiber.deletions = null;
    }
    incompleteWork = returnFiber;
    // workInProgress = incompleteWork;
  } while (incompleteWork !== null);

  // 没有 边界 中止unwind流程，一直到root
  workInProgress = null;
  workInProgressRootExitStatus = RootDidNotComplete;
}
