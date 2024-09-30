import { ReactContext } from 'shared/ReactTypes';
import { FiberNode } from './fiber';
import {
  Lane,
  NoLanes,
  includeSomeLanes,
  isSubsetOfLanes,
  mergeLanes
} from './fiberLanes';
import { markWipReceivedUpdate } from './beginWork';
import { ContextProvider } from './workTags';

export interface ContextItem<Value> {
  context: ReactContext<Value>;
  memoizedState: Value;
  next: ContextItem<Value> | null;
}

let lastContextDep: ContextItem<any> | null = null;

// 保存上一次 Context 的值
let prevContextValue: any = null;
// 用栈保存所有 context 的值
const prevContextValueStack: any[] = [];

// push
// 1、 beginWork 阶段 tag 为 ContextProvider 时执行
// 2、 beginWork 阶段，命中 bailout 时执行
export function pushProvider<T>(context: ReactContext<T>, newValue: T) {
  prevContextValueStack.push(prevContextValue);
  prevContextValue = context._currentValue;
  context._currentValue = newValue;
}

// pop
// 1、completeWork 阶段 tag 为 ContextProvider 时执行
// 2、unwindWork 阶段 tag 为 ContextProvider 时执行
export function popProvider<T>(context: ReactContext<T>) {
  context._currentValue = prevContextValue;
  prevContextValue = prevContextValueStack.pop();
}

// 重置 context 链表
export function prepareToReadContext(wip: FiberNode, renderLane: Lane) {
  lastContextDep = null;

  // 存储 context 链表
  const deps = wip.dependencies;

  if (deps !== null) {
    const firstContext = deps.firstContext;
    if (firstContext !== null) {
      if (includeSomeLanes(deps.lanes, renderLane)) {
        // 没有命中 bailout 优化策略
        markWipReceivedUpdate();
      }
      deps.firstContext = null;
    }
  }
}

// 执行 useContext 方法时调用
// 1、读取 context 的 value
// 2、构建 fiber context 链表
export function readContext<T>(
  consumer: FiberNode | null,
  context: ReactContext<T>
): T {
  if (consumer === null) {
    throw new Error('只能在函数组件中调用useContext');
  }
  const value = context._currentValue;

  // 建立 fiber -> context
  const contextItem: ContextItem<T> = {
    context,
    next: null,
    memoizedState: value
  };

  if (lastContextDep === null) {
    lastContextDep = contextItem;
    consumer.dependencies = {
      firstContext: contextItem,
      lanes: NoLanes
    };
  } else {
    lastContextDep = lastContextDep.next = contextItem;
  }

  return value;
}

// Provider 在 update 阶段 values 值发生变化
// 1、向下查找使用到 context.provider 的 cmp
// 2、找到之后，向上标记 deps.lanes
export function propagateContextChange<T>(
  wip: FiberNode,
  context: ReactContext<T>,
  renderLane: Lane
) {
  let fiber = wip.child;
  if (fiber !== null) {
    fiber.return = wip;
  }

  // 向下查找
  while (fiber !== null) {
    let nextFiber = null;
    const deps = fiber.dependencies;
    if (deps !== null) {
      nextFiber = fiber.child;

      let contextItem = deps.firstContext;
      while (contextItem !== null) {
        // 在 deps 中找到当前的 context
        if (contextItem.context === context) {
          // 找到了
          fiber.lanes = mergeLanes(fiber.lanes, renderLane);

          const alternate = fiber.alternate;
          if (alternate !== null) {
            alternate.lanes = mergeLanes(alternate.lanes, renderLane);
          }

          // 向上标记
          scheduleContextWorkOnParentPath(fiber.return, wip, renderLane);
          deps.lanes = mergeLanes(deps.lanes, renderLane);
          break;
        }
        contextItem = contextItem.next;
      }
    } else if (fiber.tag === ContextProvider) {
      nextFiber = fiber.type === wip.type ? null : fiber.child;
    } else {
      nextFiber = fiber.child;
    }

    // 向下
    if (nextFiber !== null) {
      nextFiber.return = fiber;
    } else {
      // 到了叶子结点
      nextFiber = fiber;
      while (nextFiber !== null) {
        if (nextFiber === wip) {
          nextFiber = null;
          break;
        }
        const sibling = nextFiber.sibling;
        if (sibling !== null) {
          sibling.return = nextFiber.return;
          nextFiber = sibling;
          break;
        }
        nextFiber = nextFiber.return;
      }
    }

    fiber = nextFiber;
  }
}

// 从当前的 context 向上标记 childLanes 中 renderLane
function scheduleContextWorkOnParentPath(
  from: FiberNode | null,
  to: FiberNode,
  renderLane: Lane
) {
  let node = from;

  while (node !== null) {
    const alternate = node.alternate;

    if (!isSubsetOfLanes(node.childLanes, renderLane)) {
      node.childLanes = mergeLanes(node.childLanes, renderLane);
      if (alternate !== null) {
        alternate.childLanes = mergeLanes(alternate.childLanes, renderLane);
      }
    } else if (
      alternate !== null &&
      !isSubsetOfLanes(alternate.childLanes, renderLane)
    ) {
      alternate.childLanes = mergeLanes(alternate.childLanes, renderLane);
    }

    if (node === to) {
      break;
    }
    node = node.return;
  }
}
