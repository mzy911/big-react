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
  unstable_NormalPriority as NormalPriority, // 对应 DefaultLane 优先级
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
// 本次 wip 的 lane
let wipRootRenderLane: Lane = NoLane;
// 是否正在调度执行 PassiveEffect （当前 fiber 上本次更新，需要触发 useEffect 的情况）
let rootDoesHasPassiveEffects = false;

// render 流程的结果状态
const RootInProgress = 0; // 工作中的状态
const RootInComplete = 1; // 并发中断状态
const RootCompleted = 2; // 完成状态
const RootDidNotComplete = 3; // 未完成状态，不用进入commit阶段（cpn 没有被 Suspense 包裹时）

// wip 过程中，是否进入了未完成状态
let workInProgressRootExitStatus: number = RootInProgress;

// Suspense：挂起原因
type SuspendedReason =
  | typeof NotSuspended
  | typeof SuspendedOnError
  | typeof SuspendedOnData
  | typeof SuspendedOnDeprecatedThrowPromise;

// 组件挂起的四种状态
const NotSuspended = 0;
const SuspendedOnError = 1; // error 的挂起
const SuspendedOnData = 2; // 请求数据的挂起
const SuspendedOnDeprecatedThrowPromise = 4; // Promise.then 的挂起

// 组件挂起状态
let workInProgressSuspendedReason: SuspendedReason = NotSuspended;
// 渲染过程中失败值
let workInProgressThrownValue: any = null;

// 每次进入 render 先重置全局状态
function prepareFreshStack(root: FiberRootNode, lane: Lane) {
  root.finishedLane = NoLane;
  root.finishedWork = null;

  // 创建 workInProgress
  workInProgress = createWorkInProgress(root.current, {});

  // 赋值当前的 lane
  wipRootRenderLane = lane;

  // '未完成'状态
  workInProgressRootExitStatus = RootInProgress;
  // 挂起状态
  workInProgressSuspendedReason = NotSuspended;
  // 渲染过程中失败值
  workInProgressThrownValue = null;
}

// 调度任务的入口函数
export function scheduleUpdateOnFiber(fiber: FiberNode, lane: Lane) {
  // 1、向上找到 fiberRootNode 根结点
  // 2、途径 father 的 fiber 上的 childLanes 标记 lane
  const root = markUpdateLaneFromFiberToRoot(fiber, lane);

  // 在 fiberRootNode 的 pendingLanes 上标记当前的 lane
  markRootUpdated(root, lane);

  // 进入调度过程
  ensureRootIsScheduled(root);
}

// 调度任务
export function ensureRootIsScheduled(root: FiberRootNode) {
  // 获取优先级最高的 lane
  const updateLane = getNextLane(root);
  const existingCallback = root.callbackNode;

  // 不存在 update
  if (updateLane === NoLane) {
    if (existingCallback !== null) {
      // 取消调度
      unstable_cancelCallback(existingCallback);
    }
    // 重置
    root.callbackNode = null;
    root.callbackPriority = NoLane;
    return;
  }

  const curPriority = updateLane;
  const prevPriority = root.callbackPriority;

  // 1、curPriority === prevPriority 不进入新的调度
  // 2、一次调度会执行，相同 lane 创建的 updates
  if (curPriority === prevPriority) {
    return;
  }

  // 1、走到此处，说明有更高优先级的任务
  // 2、取消之前的任务（非同步优先级的任务）
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
    // 同步优先级，使用微任务调度
    // 1、scheduleSyncCallback：向 syncQueue 数组中插入回调函数
    // 2、performSyncWorkOnRoot：调度同步任务
    scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root));

    // 3、使用微任务执行同步任务
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

  // 重置状态
  root.callbackNode = newCallbackNode;
  root.callbackPriority = curPriority;
}

// ping 的时候 root 上标记 pendingLanes
export function markRootUpdated(root: FiberRootNode, lane: Lane) {
  root.pendingLanes = mergeLanes(root.pendingLanes, lane);
}

// 从当前 Fiber 节点查到到根节点
export function markUpdateLaneFromFiberToRoot(fiber: FiberNode, lane: Lane) {
  let node = fiber;
  let parent = node.return;

  while (parent !== null) {
    parent.childLanes = mergeLanes(parent.childLanes, lane);

    // 存在 current 需要合并 childLanes
    const alternate = parent.alternate;
    if (alternate !== null) {
      alternate.childLanes = mergeLanes(alternate.childLanes, lane);
    }

    node = parent;
    parent = node.return;
  }

  // 找到根节点
  if (node.tag === HostRoot) {
    return node.stateNode;
  }
  return null;
}

// 调度同步任务：同一批任务，此函数执行多次（每个update执行一次）
function performSyncWorkOnRoot(root: FiberRootNode) {
  const nextLane = getNextLane(root);

  if (nextLane !== SyncLane) {
    // 1、NoLane、
    // 2、或比 SyncLane 低的优先级（pingedLanes）
    ensureRootIsScheduled(root);
    return;
  }

  // 获取 renderRoot 后的状态
  const exitStatus = renderRoot(root, nextLane, false);

  switch (exitStatus) {
    // 完成：进入 commit 阶段
    case RootCompleted:
      const finishedWork = root.current.alternate;
      root.finishedWork = finishedWork;
      root.finishedLane = nextLane;
      wipRootRenderLane = NoLane;
      commitRoot(root);
      break;

    // 未完成：使用了 use 但是没有使用 Suspense 包裹
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

// 调度并发（异步）任务
function performConcurrentWorkOnRoot(
  root: FiberRootNode,
  didTimeout: boolean
): any {
  const curCallback = root.callbackNode;

  // 保证 useEffect 回调执行完
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

  // TODO: 异步任务中，为啥要判断 lane === SyncLane
  const needSync = lane === SyncLane || didTimeout;

  // render 阶段
  const exitStatus = renderRoot(root, lane, !needSync);

  switch (exitStatus) {
    // 中断：继续执行 performConcurrentWorkOnRoot
    case RootInComplete:
      if (root.callbackNode !== curCallbackNode) {
        return null;
      }
      return performConcurrentWorkOnRoot.bind(null, root);

    // 完成：进入 commit 阶段
    case RootCompleted:
      // 获取到带有 Flags 完成的 workInProgressFiber
      const finishedWork = root.current.alternate;
      root.finishedWork = finishedWork;
      root.finishedLane = lane;
      wipRootRenderLane = NoLane;

      // 进入 commit 阶段
      commitRoot(root);
      break;

    // 未完成：使用了 use 但是没有使用 Suspense 包裹
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

let c = 0;

/**
 * 进入 render 阶段 (递归两个过程)
 * ReactDOM.createRoot().render、ReactDOM.render
 * this.setState、useState、dispatch
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
        // 重置挂起状态
        const thrownValue = workInProgressThrownValue;
        workInProgressSuspendedReason = NotSuspended;
        workInProgressThrownValue = null;

        // 1、进入 unwind 的流程
        // 2、向上找到最近的 Suspense 节点并赋值给 workInProgress
        // 3、进入下一步，继续新的 render 流程
        throwAndUnwindWorkLoop(root, workInProgress, thrownValue, lane);
      }

      shouldTimeSlice ? workLoopConcurrent() : workLoopSync();

      // 手动打断
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

      // WorkLoop 阶段：处理 render 过程中，抛出的错误
      handleThrow(root, e);
    }
  } while (true);

  // '未完成'状态
  if (workInProgressRootExitStatus !== RootInProgress) {
    return workInProgressRootExitStatus;
  }

  // 异步中断状态
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

  // commit 阶段，移除、重置相关联的 lanes
  markRootFinished(root, lane);

  if (
    (finishedWork.flags & PassiveMask) !== NoFlags ||
    (finishedWork.subtreeFlags & PassiveMask) !== NoFlags
  ) {
    if (!rootDoesHasPassiveEffects) {
      rootDoesHasPassiveEffects = true;
      // 调度 useEffects 等副作用函数
      // 1、以 NormalPriority（ DefaultLane ） 优先级进行调度
      // 2、在 setTimeout 中被执行的副作用函数 flushPassiveEffects
      scheduleCallback(NormalPriority, () => {
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

// render - 递的阶段
function performUnitOfWork(fiber: FiberNode) {
  // 返回子 Fiber
  const next = beginWork(fiber, wipRootRenderLane);
  // 更改 props 的值
  fiber.memoizedProps = fiber.pendingProps;

  if (next === null) {
    // 找不到叶子节点进入 completeWork
    completeUnitOfWork(fiber);
  } else {
    // 存在叶子节点继续 renderWork
    workInProgress = next;
  }
}

// render - 归的阶段
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

// WorkLoop 阶段：处理 render 过程中，抛出的错误
function handleThrow(root: FiberRootNode, thrownValue: any): void {
  if (thrownValue === SuspenseException) {
    // 处理 Suspense 相关的错误
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

  // 获取失败的值
  workInProgressThrownValue = thrownValue;
}

// 处理在循环（work loop）中遇到的异常情况
function throwAndUnwindWorkLoop(
  root: FiberRootNode,
  unitOfWork: FiberNode,
  thrownValue: any,
  lane: Lane
) {
  // 1、重置状态（全局变量）
  resetHooksOnUnwind(unitOfWork);

  // 2、处理异常（thenable、Error Boundary）
  // 2.1、标记 ShouldCapture
  // 2.2、收集 root.pingCache = WeakMap<Wakeable, Set<Lane>>
  // 2.3、等待 use 的 thenable 执行完进入 ping 阶段，开始新的 render 阶段
  throwException(root, thrownValue, lane);

  // 3、unwind 阶段，向上找到最近的 Suspense 节点并赋值给 workInProgress
  unwindUnitOfWork(unitOfWork);
}

function unwindUnitOfWork(unitOfWork: FiberNode) {
  let incompleteWork: FiberNode | null = unitOfWork;

  do {
    // 查找最近的 Suspense
    const next = unwindWork(incompleteWork);

    // 找到了
    if (next !== null) {
      next.flags &= HostEffectMask;
      // 赋值给全局的 workInProgress
      workInProgress = next;
      return;
    }

    // 继续向上查找
    const returnFiber = incompleteWork.return as FiberNode;
    if (returnFiber !== null) {
      returnFiber.deletions = null;
    }
    incompleteWork = returnFiber;
    // workInProgress = incompleteWork;
  } while (incompleteWork !== null);

  // 没找到 Suspense
  // 1、没有边界 中止 unwind 流程
  // 2、比如：使用了 use 但是没有使用 Suspense 包裹
  workInProgress = null;
  workInProgressRootExitStatus = RootDidNotComplete;
}
