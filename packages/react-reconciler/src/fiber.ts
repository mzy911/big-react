import { Props, Key, Ref, ReactElementType, Wakeable } from 'shared/ReactTypes';
import {
  ContextProvider,
  Fragment,
  FunctionComponent,
  HostComponent,
  WorkTag,
  SuspenseComponent,
  OffscreenComponent,
  LazyComponent,
  MemoComponent
} from './workTags';
import { Flags, NoFlags } from './fiberFlags';
import { Container } from 'hostConfig';
import { Lane, Lanes, NoLane, NoLanes } from './fiberLanes';
import { Effect } from './fiberHooks';
import { CallbackNode } from 'scheduler';
import {
  REACT_MEMO_TYPE,
  REACT_PROVIDER_TYPE,
  REACT_LAZY_TYPE,
  REACT_SUSPENSE_TYPE
} from 'shared/ReactSymbols';
import { ContextItem } from './fiberContext';

interface FiberDependencies<Value> {
  firstContext: ContextItem<Value> | null;
  lanes: Lanes; // 函数组件内 useContext 的 lanes
}

export class FiberNode {
  // 基础属性
  tag: WorkTag; // 节点类型（每个类型对应一个数字）
  ref: Ref | null;
  stateNode: any; // 表示当前FiberNode对应的element组件实例
  /**
   * 用于标识该节点所代表的React元素或组件的类型
   * 1、当 FiberNode 对应于一个 React 组件时，type 字段将存储对该组件构造函数或函数组件 "本身的引用"
   * 2、如果 FiberNode 表示一个原生的 DOM 元素（如、等），type 字段将包含一个字符串，该字符串对应于该DOM元素的标签名。例如，对于一个``元素，type值将是 "div"。
   */
  type: any;
  key: Key;

  // 构成树状结构
  return: FiberNode | null; // 父节点
  sibling: FiberNode | null; // 兄弟节点
  child: FiberNode | null; // 子节点
  index: number;

  // 作为工作单元
  pendingProps: Props; // 当前处理过程中的组件props对象
  memoizedProps: Props | null; // 上一次渲染完成之后的props
  memoizedState: any; // 上一次渲染的时候的 state 以链表的形式保存 Hooks：useState--> useEffect--> useState....
  updateQueue: unknown; // 该 Fiber 对应的组件产生的Update会存放在这个队列里面
  alternate: FiberNode | null; // fiber的版本池，即记录fiber更新过程，便于恢复

  // 副作用
  flags: Flags;
  subtreeFlags: Flags;
  deletions: FiberNode[] | null;
  dependencies: FiberDependencies<any> | null; // 函数组件内多个 useContext 的链表

  // 优先级
  lanes: Lanes; // bailout 机制中收集的的 lanes
  childLanes: Lanes; // 收集的子节点的 lanes

  constructor(tag: WorkTag, pendingProps: Props, key: Key) {
    // 实例
    this.tag = tag;
    this.key = key || null;
    this.stateNode = null;
    this.type = null;
    this.ref = null;

    // 构成树状结构
    this.return = null;
    this.sibling = null;
    this.child = null;
    this.index = 0;

    // 作为工作单元
    this.pendingProps = pendingProps;
    this.memoizedProps = null;
    this.memoizedState = null;
    this.updateQueue = null;
    this.alternate = null;

    // 副作用
    this.flags = NoFlags;
    this.subtreeFlags = NoFlags;
    this.deletions = null;
    this.dependencies = null;

    this.lanes = NoLanes;
    this.childLanes = NoLanes;
  }
}

export interface PendingPassiveEffects {
  unmount: Effect[];
  update: Effect[];
}

/**
 * 最顶层的 Fiber 在 hostRootFiber(跟节点Fiber) 之上
 * 1、fiberRootNode.current = hostRootFiber
 * 2、hostRootFiber.stateNode = fiberRootNode
 */
export class FiberRootNode {
  container: Container; // 容器"根节点"，不一定为DOM
  current: FiberNode; // 指向 hostRootFiber
  finishedWork: FiberNode | null; // 指向更新完成之后的 hostRootFiber
  pendingLanes: Lanes; // 未被消费的 lane 集合
  suspendedLanes: Lanes; // 挂起的 lane
  pingedLanes: Lanes; // ping 时的 lane
  finishedLane: Lane; // 本次更新消费的 lane
  pendingPassiveEffects: PendingPassiveEffects; // 收集依赖的回调，卸载和更新时执行

  callbackNode: CallbackNode | null; // 异步调度的函数集合
  callbackPriority: Lane; // 上次调度的优先级

  pingCache: WeakMap<Wakeable<any>, Set<Lane>> | null;

  constructor(container: Container, hostRootFiber: FiberNode) {
    this.container = container;
    this.current = hostRootFiber;
    hostRootFiber.stateNode = this;
    this.finishedWork = null;
    this.pendingLanes = NoLanes;
    this.suspendedLanes = NoLanes;
    this.pingedLanes = NoLanes;
    this.finishedLane = NoLane;

    this.callbackNode = null;
    this.callbackPriority = NoLane;

    // 收集依赖的回调，卸载和更新时执行
    this.pendingPassiveEffects = {
      unmount: [],
      update: []
    };

    // 缓存
    this.pingCache = null;
  }
}

// 创建 workInProgress：currentProgress <--alternate--> workInProgress
// 1、创建 wip 拿到 currentProgress 上的属性
// 2、与 currentProgress 建立 alternate 关系
export const createWorkInProgress = (
  current: FiberNode,
  pendingProps: Props
): FiberNode => {
  // 向外暴露 wip
  let wip = current.alternate;

  if (wip === null) {
    // mount 阶段
    wip = new FiberNode(current.tag, pendingProps, current.key);
    wip.stateNode = current.stateNode;
    // 反向关联
    wip.alternate = current;
    current.alternate = wip;
  } else {
    // update 阶段
    wip.pendingProps = pendingProps;
    // 先清除副作用，可能是上次遗留下来的
    wip.flags = NoFlags;
    wip.subtreeFlags = NoFlags;
    wip.deletions = null;
  }

  // 获取 current 上的属性
  wip.type = current.type;
  wip.updateQueue = current.updateQueue;
  wip.child = current.child;
  wip.memoizedProps = current.memoizedProps;
  wip.memoizedState = current.memoizedState;
  wip.ref = current.ref;
  wip.lanes = current.lanes;
  wip.childLanes = current.childLanes;

  const currentDeps = current.dependencies;
  wip.dependencies =
    currentDeps === null
      ? null
      : {
          lanes: currentDeps.lanes,
          firstContext: currentDeps.firstContext
        };

  return wip;
};

// 基于 Element 创建 Fiber
export function createFiberFromElement(element: ReactElementType): FiberNode {
  const { type, key, props, ref } = element;
  let fiberTag: WorkTag = FunctionComponent;

  if (typeof type === 'string') {
    // type 为'string'：元素标签名称，例如：div、span、a
    fiberTag = HostComponent;
  } else if (typeof type === 'object') {
    // type 为'object'：代表该组件的构造函数或函数组件本身
    switch (type.$$typeof) {
      case REACT_PROVIDER_TYPE:
        fiberTag = ContextProvider;
        break;
      case REACT_MEMO_TYPE:
        fiberTag = MemoComponent;
        break;
      case REACT_LAZY_TYPE:
        fiberTag = LazyComponent;
        break;
      default:
        console.warn('未定义的type类型', element);
        break;
    }
  } else if (type === REACT_SUSPENSE_TYPE) {
    fiberTag = SuspenseComponent;
  } else if (typeof type !== 'function' && __DEV__) {
    console.warn('为定义的type类型', element);
  }

  // 创建 Fiber 并返回
  const fiber = new FiberNode(fiberTag, props, key);
  fiber.type = type;
  fiber.ref = ref;
  return fiber;
}

export function createFiberFromFragment(elements: any[], key: Key): FiberNode {
  const fiber = new FiberNode(Fragment, elements, key);
  return fiber;
}

export interface OffscreenProps {
  mode: 'visible' | 'hidden';
  children: any;
}

export function createFiberFromOffscreen(pendingProps: OffscreenProps) {
  const fiber = new FiberNode(OffscreenComponent, pendingProps, null);
  // TODO stateNode
  return fiber;
}
