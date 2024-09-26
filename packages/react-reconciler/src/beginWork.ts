import { ReactElementType } from 'shared/ReactTypes';
import { mountChildFibers, reconcileChildFibers } from './childFibers';
import {
  FiberNode,
  createFiberFromFragment,
  createWorkInProgress,
  createFiberFromOffscreen,
  OffscreenProps
} from './fiber';
import { bailoutHook, renderWithHooks } from './fiberHooks';
import { Lane, NoLanes, includeSomeLanes } from './fiberLanes';
import { processUpdateQueue, UpdateQueue } from './updateQueue';
import {
  ContextProvider,
  Fragment,
  FunctionComponent,
  HostComponent,
  HostRoot,
  HostText,
  MemoComponent,
  OffscreenComponent,
  SuspenseComponent,
  LazyComponent
} from './workTags';
import {
  Ref,
  NoFlags,
  DidCapture,
  Placement,
  ChildDeletion
} from './fiberFlags';
import {
  prepareToReadContext,
  propagateContextChange,
  pushProvider
} from './fiberContext';
import { pushSuspenseHandler } from './suspenseContext';
import { cloneChildFibers } from './childFibers';
import { shallowEqual } from 'shared/shallowEquals';

// 是否能命中 bailout 优化策略（默认命中）
let didReceiveUpdate = false;

// 标记 wip 更新，没命中 bailout 优化策略
export function markWipReceivedUpdate() {
  didReceiveUpdate = true;
}

/**
 * 递归中的递阶段
 * 1、生成子 FiberNode
 * 2、标记副作用 flag (新增或删除)
 */
export const beginWork = (wip: FiberNode, renderLane: Lane) => {
  // 重置 bailout 策略状态
  didReceiveUpdate = false;

  // 获取 current fiber 树
  const current = wip.alternate;

  // update 时
  if (current !== null) {
    const oldProps = current.memoizedProps;
    const newProps = wip.pendingProps;

    // 四要素：props、type 变化
    if (oldProps !== newProps || current.type !== wip.type) {
      didReceiveUpdate = true;
    } else {
      // TODO: current.lanes 和 renderLane 为什么可以判断 state、context 变化
      // 四要素：state context
      const hasScheduledStateOrContext = checkScheduledUpdateOrContext(
        current,
        renderLane
      );

      // 四要素：state context
      if (!hasScheduledStateOrContext) {
        //没变化 命中 bailout
        didReceiveUpdate = false;

        switch (wip.tag) {
          // 处理 ContextProvider 节点的情况
          case ContextProvider:
            const newValue = wip.memoizedProps.value;
            const context = wip.type._context;

            // 为了保证 context 的连续性
            pushProvider(context, newValue);
            break;

          // TODO Suspense
        }

        // 进入 bailout 优化策略，目的返回复用的 fiber
        return bailoutOnAlreadyFinishedWork(wip, renderLane);
      }
    }
  }

  wip.lanes = NoLanes;

  switch (wip.tag) {
    // 根节点
    case HostRoot:
      return updateHostRoot(wip, renderLane);

    // 元素节点
    case HostComponent:
      return updateHostComponent(wip);

    // 文本节点：没有子节点，直接返回null
    case HostText:
      return null;

    // 函数节点
    case FunctionComponent:
      return updateFunctionComponent(wip, wip.type, renderLane);

    // <></> 节点
    case Fragment:
      return updateFragment(wip);

    // context.provider
    case ContextProvider:
      return updateContextProvider(wip, renderLane);

    // suspense
    case SuspenseComponent:
      return updateSuspenseComponent(wip);

    case OffscreenComponent:
      return updateOffscreenComponent(wip);

    // lazy
    case LazyComponent:
      return mountLazyComponent(wip, renderLane);

    // memo
    case MemoComponent:
      return updateMemoComponent(wip, renderLane);

    default:
      if (__DEV__) {
        console.warn('beginWork未实现的类型');
      }
      break;
  }
  return null;
};

// Root
function updateHostRoot(wip: FiberNode, renderLane: Lane) {
  const baseState = wip.memoizedState;
  const updateQueue = wip.updateQueue as UpdateQueue<Element>;
  const pending = updateQueue.shared.pending;
  updateQueue.shared.pending = null;

  const prevChildren = wip.memoizedState;

  // 1、计算状态的最新值：此处的 memoizedState 为 Element
  const { memoizedState } = processUpdateQueue(baseState, pending, renderLane);
  wip.memoizedState = memoizedState;

  const current = wip.alternate;

  // RootDidNotComplete 不进入 commit 阶段，所以要复用 memoizedState
  if (current !== null) {
    if (!current.memoizedState) {
      current.memoizedState = memoizedState;
    }
  }

  // 子节点不变，直接进入 bailout
  const nextChildren = wip.memoizedState;
  if (prevChildren === nextChildren) {
    return bailoutOnAlreadyFinishedWork(wip, renderLane);
  }

  // diff 过程
  reconcileChildren(wip, nextChildren);

  // 2、返回子 FiberNode
  return wip.child;
}

// div 标签
function updateHostComponent(wip: FiberNode) {
  const nextProps = wip.pendingProps;
  const nextChildren = nextProps.children;

  // 标记 Ref 副作用
  markRef(wip.alternate, wip);
  reconcileChildren(wip, nextChildren);
  return wip.child;
}

// Function
function updateFunctionComponent(
  wip: FiberNode,
  Component: FiberNode['type'],
  renderLane: Lane
) {
  // 重置 Context
  prepareToReadContext(wip, renderLane);

  // 执行函数组件内的 hooks
  const nextChildren = renderWithHooks(wip, Component, renderLane);

  const current = wip.alternate;

  // 命中 bailout 优化策略
  if (current !== null && !didReceiveUpdate) {
    // 标记 flags 的 PassiveEffect
    bailoutHook(wip, renderLane);
    return bailoutOnAlreadyFinishedWork(wip, renderLane);
  }

  reconcileChildren(wip, nextChildren);
  return wip.child;
}

// Fragment
function updateFragment(wip: FiberNode) {
  const nextChildren = wip.pendingProps;
  reconcileChildren(wip, nextChildren);
  return wip.child;
}

// Provider
function updateContextProvider(wip: FiberNode, renderLane: Lane) {
  const providerType = wip.type;
  const context = providerType._context;
  const newProps = wip.pendingProps;
  const oldProps = wip.memoizedProps;
  const newValue = newProps.value;

  // 向栈中存入：context、newValue
  pushProvider(context, newValue);

  if (oldProps !== null) {
    const oldValue = oldProps.value;
    if (
      Object.is(oldValue, newValue) &&
      oldProps.children === newProps.children
    ) {
      // context 的 value 不变，进入 bailout 优化策略
      return bailoutOnAlreadyFinishedWork(wip, renderLane);
    } else {
      // value 发生变化
      propagateContextChange(wip, context, renderLane);
    }
  }

  const nextChildren = newProps.children;
  reconcileChildren(wip, nextChildren);
  return wip.child;
}

// Suspense：对应四个流程
function updateSuspenseComponent(workInProgress: FiberNode) {
  const current = workInProgress.alternate;
  const nextProps = workInProgress.pendingProps;

  // 是否展示 FallBack
  let showFallback = false;
  // 是否刮挂起 (unwind 阶段标记 DidCapture)
  const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags;

  if (didSuspend) {
    showFallback = true;
    workInProgress.flags &= ~DidCapture;
  }

  // 获取 Suspense 下的 children、fallback
  const nextPrimaryChildren = nextProps.children;
  const nextFallbackChildren = nextProps.fallback;

  // beginWork 阶段收集
  pushSuspenseHandler(workInProgress);

  if (current === null) {
    if (showFallback) {
      // mount 阶段：挂起流程
      return mountSuspenseFallbackChildren(
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren
      );
    } else {
      // mount 阶段：正常流程
      return mountSuspensePrimaryChildren(workInProgress, nextPrimaryChildren);
    }
  } else {
    // update 阶段：挂起流程
    if (showFallback) {
      return updateSuspenseFallbackChildren(
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren
      );
    } else {
      // update 阶段：正常流程
      return updateSuspensePrimaryChildren(workInProgress, nextPrimaryChildren);
    }
  }
}

// offScreen
function updateOffscreenComponent(workInProgress: FiberNode) {
  const nextProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;
  reconcileChildren(workInProgress, nextChildren);
  return workInProgress.child;
}

// lazy
function mountLazyComponent(wip: FiberNode, renderLane: Lane) {
  const LazyType = wip.type;
  const payload = LazyType._payload;
  const init = LazyType._init;
  const Component = init(payload);
  wip.type = Component;
  wip.tag = FunctionComponent;
  const child = updateFunctionComponent(wip, Component, renderLane);
  return child;
}

// memo
function updateMemoComponent(wip: FiberNode, renderLane: Lane) {
  // bailout四要素
  // props浅比较
  const current = wip.alternate;
  const nextProps = wip.pendingProps;
  const Component = wip.type.type;

  if (current !== null) {
    const prevProps = current.memoizedProps;

    // state context
    if (!checkScheduledUpdateOrContext(current, renderLane)) {
      // 浅比较props
      if (shallowEqual(prevProps, nextProps) && current.ref === wip.ref) {
        didReceiveUpdate = false;
        wip.pendingProps = prevProps;

        // 满足四要素
        wip.lanes = current.lanes;
        return bailoutOnAlreadyFinishedWork(wip, renderLane);
      }
    }
  }
  return updateFunctionComponent(wip, Component, renderLane);
}

// 标记 ref 副作用
function markRef(current: FiberNode | null, workInProgress: FiberNode) {
  const ref = workInProgress.ref;

  if (
    (current === null && ref !== null) ||
    (current !== null && current.ref !== ref)
  ) {
    workInProgress.flags |= Ref;
  }
}

// 进入 bailout 优化策略，返回复用的子 fiber
function bailoutOnAlreadyFinishedWork(wip: FiberNode, renderLane: Lane) {
  // childLanes 中不存在 renderLane 优先级，说明子树不用更新
  if (!includeSomeLanes(wip.childLanes, renderLane)) {
    if (__DEV__) {
      console.warn('bailout整棵子树', wip);
    }
    return null;
  }

  if (__DEV__) {
    console.warn('bailout一个fiber', wip);
  }

  // clone 所有的子节点
  cloneChildFibers(wip);
  return wip.child;
}

function checkScheduledUpdateOrContext(
  current: FiberNode,
  renderLane: Lane
): boolean {
  const updateLanes = current.lanes;

  if (includeSomeLanes(updateLanes, renderLane)) {
    return true;
  }
  return false;
}

// 1、diff 过程
// 2、生成新的子 FiberNode ===> wip.child
//    a、进入 A 的 beginWork 时
//    b、通过对比 B 的 current FiberNode 与 reactElement
//    c、生成对应的 wip FiberNode
function reconcileChildren(wip: FiberNode, children?: ReactElementType) {
  const current = wip.alternate;

  if (current !== null) {
    // update
    wip.child = reconcileChildFibers(wip, current?.child, children);
  } else {
    // mount
    wip.child = mountChildFibers(wip, null, children);
  }
}

// mount 阶段：正常流程
function mountSuspensePrimaryChildren(
  workInProgress: FiberNode,
  primaryChildren: any
) {
  const primaryChildProps: OffscreenProps = {
    mode: 'visible',
    children: primaryChildren
  };

  const primaryChildFragment = createFiberFromOffscreen(primaryChildProps);
  workInProgress.child = primaryChildFragment;
  primaryChildFragment.return = workInProgress;
  return primaryChildFragment;
}

// mount 阶段：挂起流程
function mountSuspenseFallbackChildren(
  workInProgress: FiberNode,
  primaryChildren: any,
  fallbackChildren: any
) {
  const primaryChildProps: OffscreenProps = {
    mode: 'hidden',
    children: primaryChildren
  };
  const primaryChildFragment = createFiberFromOffscreen(primaryChildProps);
  const fallbackChildFragment = createFiberFromFragment(fallbackChildren, null);

  // 父组件 Suspense 已经 mount，需要手动标记 Placement
  fallbackChildFragment.flags |= Placement;

  primaryChildFragment.return = workInProgress;
  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;

  return fallbackChildFragment;
}

// update 阶段：正常流程
function updateSuspensePrimaryChildren(
  workInProgress: FiberNode,
  primaryChildren: any
) {
  const current = workInProgress.alternate as FiberNode;
  const currentPrimaryChildFragment = current.child as FiberNode;
  const currentFallbackChildFragment: FiberNode | null =
    currentPrimaryChildFragment.sibling;

  const primaryChildProps: OffscreenProps = {
    mode: 'visible',
    children: primaryChildren
  };

  const primaryChildFragment = createWorkInProgress(
    currentPrimaryChildFragment,
    primaryChildProps
  );
  primaryChildFragment.return = workInProgress;
  primaryChildFragment.sibling = null;
  workInProgress.child = primaryChildFragment;

  if (currentFallbackChildFragment !== null) {
    const deletions = workInProgress.deletions;
    if (deletions === null) {
      workInProgress.deletions = [currentFallbackChildFragment];
      workInProgress.flags |= ChildDeletion;
    } else {
      deletions.push(currentFallbackChildFragment);
    }
  }

  return primaryChildFragment;
}

// update 阶段：挂起流程
function updateSuspenseFallbackChildren(
  workInProgress: FiberNode,
  primaryChildren: any,
  fallbackChildren: any
) {
  const current = workInProgress.alternate as FiberNode;
  const currentPrimaryChildFragment = current.child as FiberNode;
  const currentFallbackChildFragment: FiberNode | null =
    currentPrimaryChildFragment.sibling;

  const primaryChildProps: OffscreenProps = {
    mode: 'hidden',
    children: primaryChildren
  };

  const primaryChildFragment = createWorkInProgress(
    currentPrimaryChildFragment,
    primaryChildProps
  );

  let fallbackChildFragment;

  if (currentFallbackChildFragment !== null) {
    // 可以复用
    fallbackChildFragment = createWorkInProgress(
      currentFallbackChildFragment,
      fallbackChildren
    );
  } else {
    fallbackChildFragment = createFiberFromFragment(fallbackChildren, null);
    fallbackChildFragment.flags |= Placement;
  }

  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;

  return fallbackChildFragment;
}
