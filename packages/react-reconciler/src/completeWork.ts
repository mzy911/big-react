import {
  appendInitialChild,
  Container,
  createInstance,
  createTextInstance,
  Instance
} from 'hostConfig';
import { FiberNode, OffscreenProps } from './fiber';
import { NoFlags, Ref, Update, Visibility } from './fiberFlags';
import {
  HostRoot,
  HostText,
  HostComponent,
  FunctionComponent,
  Fragment,
  ContextProvider,
  OffscreenComponent,
  SuspenseComponent,
  MemoComponent
} from './workTags';
import { popProvider } from './fiberContext';
import { popSuspenseHandler } from './suspenseContext';
import { mergeLanes, NoLanes } from './fiberLanes';

// 标记 update
function markUpdate(fiber: FiberNode) {
  fiber.flags |= Update;
}

function markRef(fiber: FiberNode) {
  fiber.flags |= Ref;
}

/**
 * 递归中的归阶段
 * 1、构建离屏 DOM 树
 * 2、标记副作用 flags：标记属性相关的如 update
 */
export const completeWork = (wip: FiberNode): void => {
  // 递归中的归
  const newProps = wip.pendingProps;
  const current = wip.alternate;

  switch (wip.tag) {
    case HostComponent:
      if (current !== null && wip.stateNode) {
        // update 阶段
        // props 变化，标记 update
        markUpdate(wip);

        // ref 变化，标记 Ref
        if (current.ref !== wip.ref) {
          markRef(wip);
        }
      } else {
        // mount 阶段
        // 1. 构建 DOM
        const instance = createInstance(wip.type, newProps);
        // 2. 将所有的子树节点挂载到 instance 上
        appendAllChildren(instance, wip);

        wip.stateNode = instance;

        // 标记 Ref
        if (wip.ref !== null) {
          markRef(wip);
        }
      }

      bubbleProperties(wip);
      return null;

    case HostText:
      if (current !== null && wip.stateNode) {
        // update 阶段
        const oldText = current.memoizedProps?.content;
        const newText = newProps.content;

        // 标记 update
        if (oldText !== newText) {
          markUpdate(wip);
        }
      } else {
        // mount 阶段
        // 构建DOM
        const instance = createTextInstance(newProps.content);
        wip.stateNode = instance;
      }
      bubbleProperties(wip);
      return null;

    case HostRoot:
    case FunctionComponent:
    case Fragment:
    case OffscreenComponent:
    case MemoComponent:
      bubbleProperties(wip);
      return null;

    case ContextProvider:
      const context = wip.type._context;

      // pop context
      popProvider(context);

      bubbleProperties(wip);
      return null;

    // 在指定的情况下标记 Visibility
    case SuspenseComponent:
      // pop Suspense
      popSuspenseHandler();

      const offscreenFiber = wip.child as FiberNode;
      const isHidden = offscreenFiber.pendingProps.mode === 'hidden';
      const currentOffscreenFiber = offscreenFiber.alternate;

      if (currentOffscreenFiber !== null) {
        // update 阶段
        const wasHidden = currentOffscreenFiber.pendingProps.mode === 'hidden';

        // 可见性变化，标记 Visibility
        if (isHidden !== wasHidden) {
          offscreenFiber.flags |= Visibility;
          bubbleProperties(offscreenFiber);
        }
      } else if (isHidden) {
        // mount 阶段，直接标记 Visibility
        offscreenFiber.flags |= Visibility;
        bubbleProperties(offscreenFiber);
      }

      bubbleProperties(wip);
      return null;
    default:
      if (__DEV__) {
        console.warn('未处理的completeWork情况', wip);
      }
      break;
  }
};

// 将子节点插入到新创建的父节点中
function appendAllChildren(parent: Container | Instance, wip: FiberNode) {
  let node = wip.child;

  // 递归插入子节点
  while (node !== null) {
    if (node.tag === HostComponent || node.tag === HostText) {
      appendInitialChild(parent, node?.stateNode);
    } else if (node.child !== null) {
      // 一直向下查找
      node.child.return = node;
      node = node.child;
      continue;
    }

    if (node === wip) {
      return;
    }

    // 兄弟节点
    while (node.sibling === null) {
      if (node.return === null || node.return === wip) {
        return;
      }
      node = node?.return;
    }

    // 向上查找
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

// 利用 completeWork 向上遍历的过程，收集子节点的 subtreeFlags、childLanes
function bubbleProperties(wip: FiberNode) {
  // 子树上的 Flags
  let subtreeFlags = NoFlags;
  let newChildLanes = NoLanes;
  let child = wip.child;

  // 利用循环向上遍历
  while (child !== null) {
    subtreeFlags |= child.subtreeFlags;
    subtreeFlags |= child.flags;

    // child.lanes child.childLanes
    newChildLanes = mergeLanes(
      newChildLanes,
      mergeLanes(child.lanes, child.childLanes)
    );

    child.return = wip;
    child = child.sibling;
  }

  // 挂载 subtreeFlags 属性
  wip.subtreeFlags |= subtreeFlags;
  wip.childLanes = newChildLanes;
}
