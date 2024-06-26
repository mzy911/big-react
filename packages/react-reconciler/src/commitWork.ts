import {
  appendChildToContainer,
  commitUpdate,
  Container,
  hideInstance,
  hideTextInstance,
  insertChildToContainer,
  Instance,
  removeChild,
  unHideInstance,
  unHideTextInstance
} from 'hostConfig';

import { FiberNode, FiberRootNode, PendingPassiveEffects } from './fiber';
import {
  ChildDeletion,
  Flags,
  LayoutMask,
  MutationMask,
  NoFlags,
  PassiveEffect,
  PassiveMask,
  Placement,
  Update,
  Ref,
  Visibility
} from './fiberFlags';
import { Effect, FCUpdateQueue } from './fiberHooks';
import { HookHasEffect } from './hookEffectTags';
import {
  FunctionComponent,
  HostComponent,
  HostRoot,
  HostText,
  OffscreenComponent,
  SuspenseComponent
} from './workTags';

let nextEffect: FiberNode | null = null;

export const commitEffects = (
  phrase: 'mutation' | 'layout',
  mask: Flags,
  callback: (fiber: FiberNode, root: FiberRootNode) => void
) => {
  return (finishedWork: FiberNode, root: FiberRootNode) => {
    nextEffect = finishedWork;
    while (nextEffect !== null) {
      // 向下遍历
      const child: FiberNode | null = nextEffect.child;

      if ((nextEffect.subtreeFlags & mask) !== NoFlags && child !== null) {
        nextEffect = child;
      } else {
        // 向上遍历 DFS
        up: while (nextEffect !== null) {
          callback(nextEffect, root);
          const sibling: FiberNode | null = nextEffect.sibling;

          if (sibling !== null) {
            nextEffect = sibling;
            break up;
          }
          nextEffect = nextEffect.return;
        }
      }
    }
  };
};

// 找到存在 Effect 节点的元素，执行对应操作
const commitMutationEffectsOnFiber = (
  finishedWork: FiberNode,
  root: FiberRootNode
) => {
  const { flags, tag } = finishedWork;

  // 插入节点
  if ((flags & Placement) !== NoFlags) {
    commitPlacement(finishedWork);
    finishedWork.flags &= ~Placement;
  }

  // 更新节点
  if ((flags & Update) !== NoFlags) {
    commitUpdate(finishedWork);
    finishedWork.flags &= ~Update;
  }

  // 删除节点
  if ((flags & ChildDeletion) !== NoFlags) {
    const deletions = finishedWork.deletions;
    if (deletions !== null) {
      deletions.forEach((childToDelete) => {
        commitDeletion(childToDelete, root);
      });
    }
    finishedWork.flags &= ~ChildDeletion;
  }

  // 收集：useEffect 的回调函数
  if ((flags & PassiveEffect) !== NoFlags) {
    // 收集回调
    commitPassiveEffect(finishedWork, root, 'update');
    finishedWork.flags &= ~PassiveEffect;
  }

  if ((flags & Ref) !== NoFlags && tag === HostComponent) {
    safelyDetachRef(finishedWork);
  }
  if ((flags & Visibility) !== NoFlags && tag === OffscreenComponent) {
    const isHidden = finishedWork.pendingProps.mode === 'hidden';
    hideOrUnhideAllChildren(finishedWork, isHidden);
    finishedWork.flags &= ~Visibility;
  }
};

// 寻找根host节点，考虑到Fragment，可能存在多个
function findHostSubtreeRoot(
  finishedWork: FiberNode,
  callback: (hostSubtreeRoot: FiberNode) => void
) {
  let hostSubtreeRoot = null;
  let node = finishedWork;
  while (true) {
    if (node.tag === HostComponent) {
      if (hostSubtreeRoot === null) {
        // 还未发现 root，当前就是
        hostSubtreeRoot = node;
        callback(node);
      }
    } else if (node.tag === HostText) {
      if (hostSubtreeRoot === null) {
        // 还未发现 root，text可以是顶层节点
        callback(node);
      }
    } else if (
      node.tag === OffscreenComponent &&
      node.pendingProps.mode === 'hidden' &&
      node !== finishedWork
    ) {
      // 隐藏的OffscreenComponent跳过
    } else if (node.child !== null) {
      node.child.return = node;
      node = node.child;
      continue;
    }

    if (node === finishedWork) {
      return;
    }

    while (node.sibling === null) {
      if (node.return === null || node.return === finishedWork) {
        return;
      }

      if (hostSubtreeRoot === node) {
        hostSubtreeRoot = null;
      }

      node = node.return;
    }

    // 去兄弟节点寻找，此时当前子树的host root可以移除了
    if (hostSubtreeRoot === node) {
      hostSubtreeRoot = null;
    }

    node.sibling.return = node.return;
    node = node.sibling;
  }
}

function hideOrUnhideAllChildren(finishedWork: FiberNode, isHidden: boolean) {
  findHostSubtreeRoot(finishedWork, (hostRoot) => {
    const instance = hostRoot.stateNode;
    if (hostRoot.tag === HostComponent) {
      isHidden ? hideInstance(instance) : unHideInstance(instance);
    } else if (hostRoot.tag === HostText) {
      isHidden
        ? hideTextInstance(instance)
        : unHideTextInstance(instance, hostRoot.memoizedProps.content);
    }
  });
}

function safelyDetachRef(current: FiberNode) {
  const ref = current.ref;
  if (ref !== null) {
    if (typeof ref === 'function') {
      ref(null);
    } else {
      ref.current = null;
    }
  }
}

const commitLayoutEffectsOnFiber = (
  finishedWork: FiberNode,
  root: FiberRootNode
) => {
  const { flags, tag } = finishedWork;

  if ((flags & Ref) !== NoFlags && tag === HostComponent) {
    // 绑定新的ref
    safelyAttachRef(finishedWork);
    finishedWork.flags &= ~Ref;
  }
};

function safelyAttachRef(fiber: FiberNode) {
  const ref = fiber.ref;
  if (ref !== null) {
    const instance = fiber.stateNode;
    if (typeof ref === 'function') {
      ref(instance);
    } else {
      ref.current = instance;
    }
  }
}

// commit 的 mutation 阶段
export const commitMutationEffects = commitEffects(
  'mutation',
  MutationMask | PassiveMask,
  commitMutationEffectsOnFiber
);

// commit 的 layout 阶段
export const commitLayoutEffects = commitEffects(
  'layout',
  LayoutMask,
  commitLayoutEffectsOnFiber
);

/**
 * 难点在于目标fiber的hostSibling可能并不是他的同级sibling
 * 比如： <A/><B/> 其中：function B() {return <div/>} 所以A的hostSibling实际是B的child
 * 实际情况层级可能更深
 * 同时：一个fiber被标记Placement，那他就是不稳定的（他对应的DOM在本次commit阶段会移动），也不能作为hostSibling
 */
function gethostSibling(fiber: FiberNode) {
  let node: FiberNode = fiber;
  findSibling: while (true) {
    while (node.sibling === null) {
      // 如果当前节点没有sibling，则找他父级sibling
      const parent = node.return;
      if (
        parent === null ||
        parent.tag === HostComponent ||
        parent.tag === HostRoot
      ) {
        // 没找到
        return null;
      }
      node = parent;
    }
    node.sibling.return = node.return;
    // 向同级sibling寻找
    node = node.sibling;

    while (node.tag !== HostText && node.tag !== HostComponent) {
      // 找到一个非Host fiber，向下找，直到找到第一个Host子孙
      if ((node.flags & Placement) !== NoFlags) {
        // 这个fiber不稳定，不能用
        continue findSibling;
      }
      if (node.child === null) {
        continue findSibling;
      } else {
        node.child.return = node;
        node = node.child;
      }
    }

    // 找到最有可能的fiber
    if ((node.flags & Placement) === NoFlags) {
      // 这是稳定的fiber，就他了
      return node.stateNode;
    }
  }
}

// 收集回调;
function commitPassiveEffect(
  fiber: FiberNode,
  root: FiberRootNode,
  type: keyof PendingPassiveEffects
) {
  // update unmount
  if (
    fiber.tag !== FunctionComponent ||
    (type === 'update' && (fiber.flags & PassiveEffect) === NoFlags)
  ) {
    return;
  }

  const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
  if (updateQueue !== null) {
    if (updateQueue.lastEffect === null && __DEV__) {
      console.error('当FC存在PassiveEffect flag时，不应该不存在effect');
    }
    root.pendingPassiveEffects[type].push(updateQueue.lastEffect as Effect);
  }
}

function commitHookEffectList(
  flags: Flags,
  lastEffect: Effect,
  callback: (effect: Effect) => void
) {
  let effect = lastEffect.next as Effect;

  do {
    if ((effect.tag & flags) === flags) {
      callback(effect);
    }
    effect = effect.next as Effect;
  } while (effect !== lastEffect.next);
}

export function commitHookEffectListUnmount(flags: Flags, lastEffect: Effect) {
  commitHookEffectList(flags, lastEffect, (effect) => {
    const destroy = effect.destroy;
    if (typeof destroy === 'function') {
      destroy();
    }
    effect.tag &= ~HookHasEffect;
  });
}

export function commitHookEffectListDestroy(flags: Flags, lastEffect: Effect) {
  commitHookEffectList(flags, lastEffect, (effect) => {
    const destroy = effect.destroy;
    if (typeof destroy === 'function') {
      destroy();
    }
  });
}

export function commitHookEffectListCreate(flags: Flags, lastEffect: Effect) {
  commitHookEffectList(flags, lastEffect, (effect) => {
    const create = effect.create;
    if (typeof create === 'function') {
      effect.destroy = create();
    }
  });
}

function recordHostChildrenToDelete(
  childrenToDelete: FiberNode[],
  unmountFiber: FiberNode
) {
  // 1. 找到第一个root host节点
  const lastOne = childrenToDelete[childrenToDelete.length - 1];

  if (!lastOne) {
    childrenToDelete.push(unmountFiber);
  } else {
    let node = lastOne.sibling;
    while (node !== null) {
      if (unmountFiber === node) {
        childrenToDelete.push(unmountFiber);
      }
      node = node.sibling;
    }
  }

  // 2. 每找到一个 host节点，判断下这个节点是不是 1 找到那个节点的兄弟节点
}

// commit 删除
function commitDeletion(childToDelete: FiberNode, root: FiberRootNode) {
  const rootChildrenToDelete: FiberNode[] = [];

  // 递归子树
  commitNestedComponent(childToDelete, (unmountFiber) => {
    switch (unmountFiber.tag) {
      case HostComponent:
        recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
        // 解绑 Ref
        safelyDetachRef(unmountFiber);
        return;
      case HostText:
        recordHostChildrenToDelete(rootChildrenToDelete, unmountFiber);
        return;
      case FunctionComponent:
        commitPassiveEffect(unmountFiber, root, 'unmount');
        return;
      default:
        if (__DEV__) {
          console.warn('未处理的unmount类型', unmountFiber);
        }
    }
  });

  // 移除rootHostComponent的DOM
  if (rootChildrenToDelete.length) {
    const hostParent = getHostParent(childToDelete);
    if (hostParent !== null) {
      rootChildrenToDelete.forEach((node) => {
        removeChild(node.stateNode, hostParent);
      });
    }
  }
  childToDelete.return = null;
  childToDelete.child = null;
}

function commitNestedComponent(
  root: FiberNode,
  onCommitUnmount: (fiber: FiberNode) => void
) {
  let node = root;
  while (true) {
    onCommitUnmount(node);

    if (node.child !== null) {
      // 向下遍历
      node.child.return = node;
      node = node.child;
      continue;
    }
    if (node === root) {
      // 终止条件
      return;
    }
    while (node.sibling === null) {
      if (node.return === null || node.return === root) {
        return;
      }
      // 向上归
      node = node.return;
    }
    node.sibling.return = node.return;
    node = node.sibling;
  }
}

const commitPlacement = (finishedWork: FiberNode) => {
  if (__DEV__) {
    console.warn('执行Placement操作', finishedWork);
  }
  // 获取父级 DOM
  const hostParent = getHostParent(finishedWork);

  // 获取兄弟节点
  const sibling = getHostSibling(finishedWork);

  // 将当前 wip 对应的 DOM 插入到 父级 DOM 中
  // finishedWork ~~ DOM append parent DOM
  if (hostParent !== null) {
    insertOrAppendPlacementNodeIntoContainer(finishedWork, hostParent, sibling);
  }
};

// 查找"有效的兄弟节点"，组件包裹时查找兄弟节点比较麻烦
function getHostSibling(fiber: FiberNode) {
  let node: FiberNode = fiber;

  findSibling: while (true) {
    // 子节点和兄弟节点没找到，需要向上找
    while (node.sibling === null) {
      const parent = node.return;

      // 终止条件，没找到
      if (
        parent === null ||
        parent.tag === HostComponent ||
        parent.tag === HostRoot
      ) {
        return null;
      }

      node = parent;
    }

    // 遍历同级兄弟节点
    node.sibling.return = node.return;
    node = node.sibling;

    // 向下遍历
    // 非 HostText、HostComponent 节点
    while (node.tag !== HostText && node.tag !== HostComponent) {
      // 不稳定节点，将要做移动
      if ((node.flags & Placement) !== NoFlags) {
        continue findSibling;
      }

      // 到底，无 child
      if (node.child === null) {
        continue findSibling;
      } else {
        // 向下
        node.child.return = node;
        node = node.child;
      }
    }

    // 找到节点
    if ((node.flags & Placement) === NoFlags) {
      return node.stateNode;
    }
  }
}

function getHostParent(fiber: FiberNode): Container | null {
  let parent = fiber.return;

  while (parent) {
    const parentTag = parent.tag;
    // HostComponent HostRoot
    if (parentTag === HostComponent) {
      return parent.stateNode as Container;
    }
    if (parentTag === HostRoot) {
      return (parent.stateNode as FiberRootNode).container;
    }
    parent = parent.return;
  }
  if (__DEV__) {
    console.warn('未找到host parent');
  }
  return null;
}

// 将当前节点插入到 container 中
function insertOrAppendPlacementNodeIntoContainer(
  finishedWork: FiberNode,
  hostParent: Container,
  before?: Instance
) {
  // host 的 fiber 类型
  if (finishedWork.tag === HostComponent || finishedWork.tag === HostText) {
    if (before) {
      insertChildToContainer(finishedWork.stateNode, hostParent, before);
    } else {
      appendChildToContainer(hostParent, finishedWork.stateNode);
    }

    return;
  }

  // 递归向下
  const child = finishedWork.child;
  if (child !== null) {
    insertOrAppendPlacementNodeIntoContainer(child, hostParent);
    let sibling = child.sibling;

    while (sibling !== null) {
      insertOrAppendPlacementNodeIntoContainer(sibling, hostParent);
      sibling = sibling.sibling;
    }
  }
}
