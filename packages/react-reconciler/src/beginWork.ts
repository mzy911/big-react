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

// 是否能命中 bailout 优化策略
let didReceiveUpdate = false;

export function markWipReceivedUpdate() {
  didReceiveUpdate = true;
}

/**
 * 递归中的递阶段
 * 1、生成子 FiberNode
 * 2、标记副作用 flag
 */
export const beginWork = (wip: FiberNode, renderLane: Lane) => {
  // 重制 bailout 策略状态
  didReceiveUpdate = false;

  const current = wip.alternate;

  // update 时
  if (current !== null) {
    const oldProps = current.memoizedProps;
    const newProps = wip.pendingProps;

    // 四要素：props、type 变化
    if (oldProps !== newProps || current.type !== wip.type) {
      didReceiveUpdate = true;
    } else {
      // state context
      const hasScheduledStateOrContext = checkScheduledUpdateOrContext(
        current,
        renderLane
      );

      // 四要素：state context 没变化
      if (!hasScheduledStateOrContext) {
        // 命中 bailout
        didReceiveUpdate = false;

        switch (wip.tag) {
          // 处理 <Context.provider>
          case ContextProvider:
            const newValue = wip.memoizedProps.value;
            const context = wip.type._context;
            pushProvider(context, newValue);
            break;
          // TODO Suspense
        }

        // 进入 bailout 优化策略
        return bailoutOnAlreadyFinishedWork(wip, renderLane);
      }
    }
  }

  wip.lanes = NoLanes;

  switch (wip.tag) {
    // 根节点
    case HostRoot:
      // 1、计算状态的最新值
      // 2、创建子 FiberNode
      return updateHostRoot(wip, renderLane);
    // 元素节点
    case HostComponent:
      // 1、不能触发更新
      // 2、只能创建子 FiberNode
      return updateHostComponent(wip);
    // 文本节点
    case HostText:
      // 1、没有子节点
      // 2、递的阶段到了叶子节点，直接返回 null
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
    case LazyComponent:
      return mountLazyComponent(wip, renderLane);
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
  // 考虑RootDidNotComplete的情况，需要复用memoizedState
  if (current !== null) {
    if (!current.memoizedState) {
      current.memoizedState = memoizedState;
    }
  }

  // 获取子 reactElement
  const nextChildren = wip.memoizedState;
  if (prevChildren === nextChildren) {
    return bailoutOnAlreadyFinishedWork(wip, renderLane);
  }
  // diff 过程
  reconcileChildren(wip, nextChildren);

  // 2、返回子 FiberNode
  return wip.child;
}

function updateHostComponent(wip: FiberNode) {
  // 例如：创建 div 下的 span 节点 <div><span>...</span></div>
  const nextProps = wip.pendingProps;
  const nextChildren = nextProps.children;
  markRef(wip.alternate, wip);
  reconcileChildren(wip, nextChildren);
  return wip.child;
}

function updateFunctionComponent(
  wip: FiberNode,
  Component: FiberNode['type'],
  renderLane: Lane
) {
  prepareToReadContext(wip, renderLane);
  // render 函数组件
  const nextChildren = renderWithHooks(wip, Component, renderLane);

  const current = wip.alternate;
  if (current !== null && !didReceiveUpdate) {
    bailoutHook(wip, renderLane);
    return bailoutOnAlreadyFinishedWork(wip, renderLane);
  }

  reconcileChildren(wip, nextChildren);
  return wip.child;
}

function updateFragment(wip: FiberNode) {
  const nextChildren = wip.pendingProps;
  reconcileChildren(wip, nextChildren);
  return wip.child;
}

function updateContextProvider(wip: FiberNode, renderLane: Lane) {
  const providerType = wip.type;
  const context = providerType._context;
  const newProps = wip.pendingProps;
  const oldProps = wip.memoizedProps;
  const newValue = newProps.value;

  pushProvider(context, newValue);

  if (oldProps !== null) {
    const oldValue = oldProps.value;

    if (
      Object.is(oldValue, newValue) &&
      oldProps.children === newProps.children
    ) {
      return bailoutOnAlreadyFinishedWork(wip, renderLane);
    } else {
      propagateContextChange(wip, context, renderLane);
    }
  }

  const nextChildren = newProps.children;
  reconcileChildren(wip, nextChildren);
  return wip.child;
}

function updateSuspenseComponent(workInProgress: FiberNode) {
  const current = workInProgress.alternate;
  const nextProps = workInProgress.pendingProps;

  let showFallback = false;
  const didSuspend = (workInProgress.flags & DidCapture) !== NoFlags;

  if (didSuspend) {
    showFallback = true;
    workInProgress.flags &= ~DidCapture;
  }
  const nextPrimaryChildren = nextProps.children;
  const nextFallbackChildren = nextProps.fallback;
  pushSuspenseHandler(workInProgress);

  if (current === null) {
    if (showFallback) {
      return mountSuspenseFallbackChildren(
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren
      );
    } else {
      return mountSuspensePrimaryChildren(workInProgress, nextPrimaryChildren);
    }
  } else {
    if (showFallback) {
      return updateSuspenseFallbackChildren(
        workInProgress,
        nextPrimaryChildren,
        nextFallbackChildren
      );
    } else {
      return updateSuspensePrimaryChildren(workInProgress, nextPrimaryChildren);
    }
  }
}

function updateOffscreenComponent(workInProgress: FiberNode) {
  const nextProps = workInProgress.pendingProps;
  const nextChildren = nextProps.children;
  reconcileChildren(workInProgress, nextChildren);
  return workInProgress.child;
}

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

function bailoutOnAlreadyFinishedWork(wip: FiberNode, renderLane: Lane) {
  // childLanes 中不存在 renderLane 优先级
  if (!includeSomeLanes(wip.childLanes, renderLane)) {
    if (__DEV__) {
      console.warn('bailout整棵子树', wip);
    }
    return null;
  }

  if (__DEV__) {
    console.warn('bailout一个fiber', wip);
  }

  // 继续调度
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

function markRef(current: FiberNode | null, workInProgress: FiberNode) {
  const ref = workInProgress.ref;

  if (
    (current === null && ref !== null) ||
    (current !== null && current.ref !== ref)
  ) {
    workInProgress.flags |= Ref;
  }
}

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
  // 父组件Suspense已经mount，所以需要fallback标记Placement
  fallbackChildFragment.flags |= Placement;

  primaryChildFragment.return = workInProgress;
  fallbackChildFragment.return = workInProgress;
  primaryChildFragment.sibling = fallbackChildFragment;
  workInProgress.child = primaryChildFragment;

  return fallbackChildFragment;
}

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
