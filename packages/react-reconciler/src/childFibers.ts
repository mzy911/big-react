import { REACT_ELEMENT_TYPE, REACT_FRAGMENT_TYPE } from 'shared/ReactSymbols';
import { Key, Props, ReactElementType } from 'shared/ReactTypes';
import {
  createFiberFromElement,
  createFiberFromFragment,
  createWorkInProgress,
  FiberNode
} from './fiber';
import { ChildDeletion, Placement } from './fiberFlags';
import { Fragment, HostText } from './workTags';

type ExistingChildren = Map<string | number, FiberNode>;

// 1、生成子节点
// 2、标记 flags
function ChildReconciler(shouldTrackEffects: boolean) {
  // 删除子节点
  function deleteChild(returnFiber: FiberNode, childToDelete: FiberNode) {
    if (!shouldTrackEffects) {
      return;
    }
    const deletions = returnFiber.deletions;
    if (deletions === null) {
      // 添加要删除的 childs
      returnFiber.deletions = [childToDelete];
      // 标记 flags
      returnFiber.flags |= ChildDeletion;
    } else {
      // 添加要删除的 childs
      deletions.push(childToDelete);
    }
  }

  function deleteRemainingChildren(
    returnFiber: FiberNode,
    currentFirstChild: FiberNode | null
  ) {
    if (!shouldTrackEffects) {
      return;
    }
    let childToDelete = currentFirstChild;
    while (childToDelete !== null) {
      deleteChild(returnFiber, childToDelete);
      childToDelete = childToDelete.sibling;
    }
  }

  // 协调单一 Element 节点
  function reconcileSingleElement(
    returnFiber: FiberNode,
    currentFiber: FiberNode | null,
    element: ReactElementType
  ) {
    const key = element.key;
    while (currentFiber !== null) {
      // update
      if (currentFiber.key === key) {
        // key相同
        if (element.$$typeof === REACT_ELEMENT_TYPE) {
          if (currentFiber.type === element.type) {
            let props = element.props;

            // 为 fragment 节点
            if (element.type === REACT_FRAGMENT_TYPE) {
              props = element.props.children;
            }

            // type相同：复用
            const existing = useFiber(currentFiber, props);
            existing.return = returnFiber;

            // 当前节点可复用，标记剩下的节点删除(A1B1C1-->A1)
            deleteRemainingChildren(returnFiber, currentFiber.sibling);
            return existing;
          }

          // key相同，type不同 删掉所有旧的
          deleteRemainingChildren(returnFiber, currentFiber);
          break;
        } else {
          if (__DEV__) {
            console.warn('还未实现的react类型', element);
            break;
          }
        }
      } else {
        // key不同，删掉旧的
        deleteChild(returnFiber, currentFiber);
        currentFiber = currentFiber.sibling;
      }
    }

    // 根据element创建fiber
    let fiber;

    // 为 fragment 节点
    if (element.type === REACT_FRAGMENT_TYPE) {
      fiber = createFiberFromFragment(element.props.children, key);
    } else {
      fiber = createFiberFromElement(element);
    }
    fiber.return = returnFiber;
    return fiber;
  }

  // 协调单一 text 节点
  function reconcileSingleTextNode(
    returnFiber: FiberNode,
    currentFiber: FiberNode | null,
    content: string | number
  ) {
    while (currentFiber !== null) {
      // update
      if (currentFiber.tag === HostText) {
        // 类型没变，可以复用
        const existing = useFiber(currentFiber, { content });
        existing.return = returnFiber;
        deleteRemainingChildren(returnFiber, currentFiber.sibling);
        return existing;
      }

      // 否则删除当前节点
      deleteChild(returnFiber, currentFiber);
      currentFiber = currentFiber.sibling;
    }

    // 创建新的 text 节点
    const fiber = new FiberNode(HostText, { content }, null);
    fiber.return = returnFiber;
    return fiber;
  }

  // 插入单一的节点
  function placeSingleChild(fiber: FiberNode) {
    // 1、有副作用、2、首屏渲染：fiber.alternate 为 currentFiber
    if (shouldTrackEffects && fiber.alternate === null) {
      fiber.flags |= Placement;
    }
    return fiber;
  }

  // 协调多节点
  function reconcileChildrenArray(
    returnFiber: FiberNode,
    currentFirstChild: FiberNode | null,
    newChild: any[]
  ) {
    // 最后一个可复用fiber在current中的index
    let lastPlacedIndex = 0;
    // 创建的最后一个fiber
    let lastNewFiber: FiberNode | null = null;
    // 创建的第一个fiber
    let firstNewFiber: FiberNode | null = null;

    // 1.将current保存在map中
    const existingChildren: ExistingChildren = new Map();
    let current = currentFirstChild;
    while (current !== null) {
      const keyToUse = current.key !== null ? current.key : current.index;
      existingChildren.set(keyToUse, current);
      current = current.sibling;
    }

    for (let i = 0; i < newChild.length; i++) {
      // 2.遍历newChild，寻找是否可复用
      const after = newChild[i];
      const newFiber = updateFromMap(returnFiber, existingChildren, i, after);

      if (newFiber === null) {
        continue;
      }

      // 3. 标记移动还是插入

      newFiber.index = i;
      newFiber.return = returnFiber;

      // lastNewFiber 和 lastNewFiber 指向问题
      if (lastNewFiber === null) {
        lastNewFiber = newFiber;
        firstNewFiber = newFiber;
      } else {
        lastNewFiber.sibling = newFiber;
        lastNewFiber = lastNewFiber.sibling;
      }

      if (!shouldTrackEffects) {
        continue;
      }

      // A1 B2 C3 -> B2 C3 A1
      // after：当遍历element时，「当前遍历到的element」一定是「所有已遍历的element」中最靠右那个。
      // 最后一个可复用的fiber在current中的lastPlacedndex
      const current = newFiber.alternate;
      if (current !== null) {
        // 使用 old 的 index 和 lastPlacedIndex 进行比较
        const oldIndex = current.index;
        if (oldIndex < lastPlacedIndex) {
          // 移动：标记插入
          newFiber.flags |= Placement;
          continue;
        } else {
          // 不移动
          lastPlacedIndex = oldIndex;
        }
      } else {
        // mount
        newFiber.flags |= Placement;
      }
    }

    // 4. 将Map中剩下的标记为删除
    existingChildren.forEach((fiber) => {
      deleteChild(returnFiber, fiber);
    });

    // 返回
    return firstNewFiber;
  }

  function getElementKeyToUse(element: any, index?: number): Key {
    if (
      Array.isArray(element) ||
      typeof element === 'string' ||
      typeof element === 'number' ||
      element === undefined ||
      element === null
    ) {
      return index;
    }
    return element.key !== null ? element.key : index;
  }

  function updateFromMap(
    returnFiber: FiberNode,
    existingChildren: ExistingChildren,
    index: number,
    element: any
  ): FiberNode | null {
    // 获取 key
    const keyToUse = getElementKeyToUse(element, index);
    // 是否找到更新之前的节点
    const before = existingChildren.get(keyToUse);

    // HostText
    if (typeof element === 'string' || typeof element === 'number') {
      if (before) {
        // 可复用
        if (before.tag === HostText) {
          // 从 existingChildren 中删除 keyToUse
          existingChildren.delete(keyToUse);
          // 复用旧的 Fiber
          return useFiber(before, { content: element + '' });
        }
      }

      // 创建新的 Fiber
      return new FiberNode(HostText, { content: element + '' }, null);
    }

    // ReactElement
    if (typeof element === 'object' && element !== null) {
      switch (element.$$typeof) {
        // 为 fragment 节点
        case REACT_ELEMENT_TYPE:
          if (element.type === REACT_FRAGMENT_TYPE) {
            return updateFragment(
              returnFiber,
              before,
              element,
              keyToUse,
              existingChildren
            );
          }
          // 可复用
          if (before) {
            if (before.type === element.type) {
              // 从 existingChildren 中删除 keyToUse
              existingChildren.delete(keyToUse);
              // 复用旧的 Fiber
              return useFiber(before, element.props);
            }
          }
          // 创建新的 Fiber
          return createFiberFromElement(element);
      }
    }

    // <ul>
    //     <li/>
    //     <li/>
    // 子组件为数组
    //     <>
    //         <li/>
    //         <li/>
    //     </>
    // </ul>
    if (Array.isArray(element)) {
      return updateFragment(
        returnFiber,
        before,
        element,
        keyToUse,
        existingChildren
      );
    }

    // 其他情况返回 null
    return null;
  }

  /**
   * 单、多节点只是针对 newChild 来说的
   * 此处为闭包函数，向外返回 reconcileChildFibers 函数
   * 1、returnFiber：父节点 FiberNode
   * 2、currentFiber：子节点 FiberNode
   * 3、newChild：子节点 Element
   */
  return function reconcileChildFibers(
    returnFiber: FiberNode,
    currentFiber: FiberNode | null,
    newChild?: any
  ) {
    // 判断Fragment
    const isUnkeyedTopLevelFragment =
      typeof newChild === 'object' &&
      newChild !== null &&
      newChild.type === REACT_FRAGMENT_TYPE &&
      newChild.key === null;
    if (isUnkeyedTopLevelFragment) {
      newChild = newChild.props.children;
    }

    // 判断当前fiber的类型
    if (typeof newChild === 'object' && newChild !== null) {
      // 1、多节点的情况 ul> li*3
      // 2、父节点为 Fragment 时
      if (Array.isArray(newChild)) {
        return reconcileChildrenArray(returnFiber, currentFiber, newChild);
      }

      switch (newChild.$$typeof) {
        case REACT_ELEMENT_TYPE:
          return placeSingleChild(
            reconcileSingleElement(returnFiber, currentFiber, newChild)
          );
        default:
          if (__DEV__) {
            console.warn('未实现的reconcile类型', newChild);
          }
          break;
      }
    }

    // HostText
    if (typeof newChild === 'string' || typeof newChild === 'number') {
      return placeSingleChild(
        reconcileSingleTextNode(returnFiber, currentFiber, newChild)
      );
    }

    if (currentFiber !== null) {
      // 兜底删除
      deleteRemainingChildren(returnFiber, currentFiber);
    }

    if (__DEV__) {
      console.warn('未实现的reconcile类型', newChild);
    }
    return null;
  };
}

function useFiber(fiber: FiberNode, pendingProps: Props): FiberNode {
  const clone = createWorkInProgress(fiber, pendingProps);
  clone.index = 0;
  clone.sibling = null;
  return clone;
}

function updateFragment(
  returnFiber: FiberNode,
  current: FiberNode | undefined,
  elements: any[],
  key: Key,
  existingChildren: ExistingChildren
) {
  let fiber;
  if (!current || current.tag !== Fragment) {
    fiber = createFiberFromFragment(elements, key);
  } else {
    existingChildren.delete(key);
    fiber = useFiber(current, elements);
  }
  fiber.return = returnFiber;
  return fiber;
}

// 根据 mound、updte 来区分是否追踪副作用
export const reconcileChildFibers = ChildReconciler(true);
export const mountChildFibers = ChildReconciler(false);

// clone 所有的子节点
export function cloneChildFibers(wip: FiberNode) {
  // child  sibling
  if (wip.child === null) {
    return;
  }
  let currentChild = wip.child;
  let newChild = createWorkInProgress(currentChild, currentChild.pendingProps);
  wip.child = newChild;
  newChild.return = wip;

  // 遍历剩余的兄弟节点
  while (currentChild.sibling !== null) {
    currentChild = currentChild.sibling;
    newChild = newChild.sibling = createWorkInProgress(
      newChild,
      newChild.pendingProps
    );
    newChild.return = wip;
  }
}
