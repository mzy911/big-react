import { Dispatch } from 'react/src/currentDispatcher';
import { Dispatcher } from 'react/src/currentDispatcher';
import internals from 'shared/internals';
import { Action, ReactContext, Thenable, Usable } from 'shared/ReactTypes';
import { FiberNode } from './fiber';
import { Flags, PassiveEffect } from './fiberFlags';
import {
  Lane,
  NoLane,
  NoLanes,
  mergeLanes,
  removeLanes,
  requestUpdateLane
} from './fiberLanes';
import { HookHasEffect, Passive } from './hookEffectTags';
import {
  basicStateReducer,
  createUpdate,
  createUpdateQueue,
  enqueueUpdate,
  processUpdateQueue,
  Update,
  UpdateQueue
} from './updateQueue';
import { scheduleUpdateOnFiber } from './workLoop';
import { trackUsedThenable } from './thenable';
import { REACT_CONTEXT_TYPE } from 'shared/ReactSymbols';
import { markWipReceivedUpdate } from './beginWork';
import { readContext as readContextOrigin } from './fiberContext';

// FC 的 Fiber
let currentlyRenderingFiber: FiberNode | null = null;

// FC 的 Hooks 链表 (mount、update 时都会产生)
let workInProgressHook: Hook | null = null;

// FC current 的 Hook (update 时产生)
let currentHook: Hook | null = null;

let renderLane: Lane = NoLane;

const { currentDispatcher, currentBatchConfig } = internals;

interface Hook {
  // 计算前的 state 值
  baseState: any;

  // 1、useState：计算后的 state 值
  // 2、useEfffect： 存储 Effects 链表
  // 3、useRef：存储 Ref 对象
  // ...
  memoizedState: any;

  // 记录当前正在执行的 Hook 上的 update 链表
  baseQueue: Update<any> | null;

  // useState：记录 update 链表
  updateQueue: unknown;

  next: Hook | null;
}

export interface Effect {
  tag: Flags;
  create: EffectCallback | void;
  destroy: EffectCallback | void;
  deps: HookDeps;
  next: Effect | null; // hooks 本身就有 next，但是 effect 中也包含 next 指向下一个 effect
}

// 继承 UpdateQueue 扩展 lastEffect、lastRenderedState 属性
export interface FCUpdateQueue<State> extends UpdateQueue<State> {
  lastEffect: Effect | null; // 记录 effect 链表
  lastRenderedState: State; // 记录上次 useState 计算后的值，用于 eager 策略对比
}

type EffectCallback = () => void;
export type HookDeps = any[] | null;

export function renderWithHooks(
  wip: FiberNode,
  Component: FiberNode['type'],
  lane: Lane
) {
  // 执行 FucntionComponent 的时候，重新赋值当前正在运行的Fiber
  currentlyRenderingFiber = wip;
  wip.memoizedState = null;
  wip.updateQueue = null;
  renderLane = lane;

  const current = wip.alternate;

  if (current !== null) {
    // update
    currentDispatcher.current = HooksDispatcherOnUpdate;
  } else {
    // mount
    currentDispatcher.current = HooksDispatcherOnMount;
  }

  const props = wip.pendingProps;
  // FC render
  const children = Component(props);

  // 重置操作
  currentlyRenderingFiber = null;
  workInProgressHook = null;
  currentHook = null;
  renderLane = NoLane;
  return children;
}

// mount 时 Hooks 集合
const HooksDispatcherOnMount: Dispatcher = {
  useState: mountState,
  useEffect: mountEffect,
  useTransition: mountTransition,
  useRef: mountRef,
  useContext: readContext,
  use,
  useMemo: mountMemo,
  useCallback: mountCallback
};

// update 时 Hooks 集合
const HooksDispatcherOnUpdate: Dispatcher = {
  useState: updateState,
  useEffect: updateEffect,
  useTransition: updateTransition,
  useRef: updateRef,
  useContext: readContext,
  use,
  useMemo: updateMemo,
  useCallback: updateCallback
};

// mount 和 update 阶段都执行次函数
function readContext<Value>(context: ReactContext<Value>): Value {
  const consumer = currentlyRenderingFiber as FiberNode;
  return readContextOrigin(consumer, context);
}

// 挂载时 Effect
function mountEffect(create: EffectCallback | void, deps: HookDeps | void) {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  // mount 时要触发 PassiveEffect
  (currentlyRenderingFiber as FiberNode).flags |= PassiveEffect;

  // 存储 effect 链表
  hook.memoizedState = pushEffect(
    Passive | HookHasEffect,
    create,
    undefined,
    nextDeps as HookDeps
  );
}

// 更新时 Effect
function updateEffect(create: EffectCallback | void, deps: HookDeps | void) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  let destroy: EffectCallback | void;

  if (currentHook !== null) {
    const prevEffect = currentHook.memoizedState as Effect;
    destroy = prevEffect.destroy;

    // 浅比较 ---> 不变化：Passive
    if (nextDeps !== null) {
      const prevDeps = prevEffect.deps;
      if (areHookInputsEqual(nextDeps as HookDeps, prevDeps)) {
        hook.memoizedState = pushEffect(
          Passive,
          create,
          destroy,
          nextDeps as HookDeps
        );
        return;
      }
    }

    // 浅比较 ---> 变化：Passive | HookHasEffect
    (currentlyRenderingFiber as FiberNode).flags |= PassiveEffect;
    hook.memoizedState = pushEffect(
      Passive | HookHasEffect,
      create,
      destroy,
      nextDeps as HookDeps
    );
  }
}

// 浅比较
function areHookInputsEqual(nextDeps: HookDeps, prevDeps: HookDeps) {
  if (prevDeps === null || nextDeps === null) {
    return false;
  }
  for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
    if (Object.is(prevDeps[i], nextDeps[i])) {
      continue;
    }
    return false;
  }
  return true;
}

// efftct 之间会使用 next 进行链接
// 1、创建新的 Effect 对象，形成 Effect 链表并返回
// 2、在 fiber.updateQueue.lastEffect 的属性上挂载 Effect 链表
function pushEffect(
  hookFlags: Flags,
  create: EffectCallback | void,
  destroy: EffectCallback | void,
  deps: HookDeps
): Effect {
  const effect: Effect = {
    tag: hookFlags,
    create,
    destroy,
    deps,
    next: null
  };
  const fiber = currentlyRenderingFiber as FiberNode;
  const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
  if (updateQueue === null) {
    const updateQueue = createFCUpdateQueue();
    fiber.updateQueue = updateQueue;
    effect.next = effect;
    updateQueue.lastEffect = effect;
  } else {
    // 插入effect
    const lastEffect = updateQueue.lastEffect;
    if (lastEffect === null) {
      effect.next = effect;
      updateQueue.lastEffect = effect;
    } else {
      const firstEffect = lastEffect.next;
      lastEffect.next = effect;
      effect.next = firstEffect;
      updateQueue.lastEffect = effect;
    }
  }
  return effect;
}

function createFCUpdateQueue<State>() {
  const updateQueue = createUpdateQueue<State>() as FCUpdateQueue<State>;
  updateQueue.lastEffect = null;
  return updateQueue;
}

// useState 的实现
function mountState<State>(
  initialState: (() => State) | State
): [State, Dispatch<State>] {
  // 找到当前useState对应的hook数据
  const hook = mountWorkInProgressHook();

  let memoizedState;
  if (initialState instanceof Function) {
    memoizedState = initialState();
  } else {
    memoizedState = initialState;
  }
  const queue = createFCUpdateQueue<State>();
  hook.updateQueue = queue;
  hook.memoizedState = memoizedState;
  hook.baseState = memoizedState;

  // @ts-ignore
  // 1、mountState 时，创建一个 update 对象
  // 创建 update 对象，在 disaptch 时执行
  const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, queue);
  queue.dispatch = dispatch;
  queue.lastRenderedState = memoizedState;

  return [memoizedState, dispatch];
}

function updateState<State>(): [State, Dispatch<State>] {
  // 找到当前useState对应的hook数据：为 currentHook 赋值
  const hook = updateWorkInProgressHook();

  const baseState = hook.baseState;

  // 当前 Hook 上存储的 update 链表
  const queue = hook.updateQueue as FCUpdateQueue<State>;
  const pending = queue.shared.pending;

  const current = currentHook as Hook;
  let baseQueue = current.baseQueue;

  // 将 pending update 链表合并到 baseQueue 上
  if (pending !== null) {
    if (baseQueue !== null) {
      // baseQueue b2 -> b0 -> b1 -> b2
      // pendingQueue p2 -> p0 -> p1 -> p2
      // b0
      const baseFirst = baseQueue.next;
      // p0
      const pendingFirst = pending.next;
      // b2 -> p0
      baseQueue.next = pendingFirst;
      // p2 -> b0
      pending.next = baseFirst;
      // p2 -> b0 -> b1 -> b2 -> p0 -> p1 -> p2
    }

    baseQueue = pending;

    // 保存在current中
    current.baseQueue = pending;

    queue.shared.pending = null;
  }

  // 消费队列
  if (baseQueue !== null) {
    const prevState = hook.memoizedState;
    const {
      memoizedState,
      baseQueue: newBaseQueue,
      baseState: newBaseState
    } = processUpdateQueue(baseState, baseQueue, renderLane, (update) => {
      const skippedLane = update.lane;
      const fiber = currentlyRenderingFiber as FiberNode;

      // NoLanes
      fiber.lanes = mergeLanes(fiber.lanes, skippedLane);
    });

    // NaN === NaN // false
    // Object.is true

    // +0 === -0 // true
    // Object.is false
    if (!Object.is(prevState, memoizedState)) {
      markWipReceivedUpdate();
    }

    hook.baseState = newBaseState;
    hook.memoizedState = memoizedState;
    hook.baseQueue = newBaseQueue;
    queue.lastRenderedState = memoizedState;
  }

  return [hook.memoizedState, queue.dispatch as Dispatch<State>];
}

// 创建 useState 的 dispatch 方法
function dispatchSetState<State>(
  fiber: FiberNode,
  updateQueue: FCUpdateQueue<State>,
  action: Action<State> // 调用 dispathState 时传入的 action
) {
  const lane = requestUpdateLane();
  // 根据 action 创建 update
  const update = createUpdate(action, lane);

  // eager策略
  const current = fiber.alternate;
  if (
    fiber.lanes === NoLanes &&
    (current === null || current.lanes === NoLanes)
  ) {
    // 当前产生的update是这个fiber的第一个update
    // 1. 更新前的状态
    // 2. 计算状态的方法
    const currentState = updateQueue.lastRenderedState;
    const eagerState = basicStateReducer(currentState, action);
    update.hasEagerState = true;
    update.eagerState = eagerState;

    if (Object.is(currentState, eagerState)) {
      // 将 update 插入到队列中
      enqueueUpdate(updateQueue, update, fiber, NoLane);
      // 命中eagerState
      if (__DEV__) {
        console.warn('命中eagerState', fiber);
      }
      return;
    }
  }

  // 将 update 插入到队列中
  enqueueUpdate(updateQueue, update, fiber, lane);

  // 开始调度任务
  scheduleUpdateOnFiber(fiber, lane);
}

/**
 * Transition
 */
function mountTransition(): [boolean, (callback: () => void) => void] {
  const [isPending, setPending] = mountState(false);
  const hook = mountWorkInProgressHook();
  const start = startTransition.bind(null, setPending);
  hook.memoizedState = start;
  return [isPending, start];
}

function updateTransition(): [boolean, (callback: () => void) => void] {
  const [isPending] = updateState();
  const hook = updateWorkInProgressHook();
  const start = hook.memoizedState;
  return [isPending as boolean, start];
}

function startTransition(setPending: Dispatch<boolean>, callback: () => void) {
  setPending(true);
  const prevTransition = currentBatchConfig.transition;
  currentBatchConfig.transition = 1;

  callback();
  setPending(false);

  currentBatchConfig.transition = prevTransition;
}

/**
 * Ref
 */
function mountRef<T>(initialValue: T): { current: T } {
  const hook = mountWorkInProgressHook();
  const ref = { current: initialValue };
  hook.memoizedState = ref;
  return ref;
}

function updateRef<T>(initialValue: T): { current: T } {
  const hook = updateWorkInProgressHook();
  return hook.memoizedState;
}

/**
 * use
 */
function use<T>(usable: Usable<T>): T {
  if (usable !== null && typeof usable === 'object') {
    if (typeof (usable as Thenable<T>).then === 'function') {
      const thenable = usable as Thenable<T>;

      // 1、包装、处理 thenable 对象
      // 2、手动抛出一个错误，打断正常的 render 流程
      return trackUsedThenable(thenable);
    } else if ((usable as ReactContext<T>).$$typeof === REACT_CONTEXT_TYPE) {
      // REACT_CONTEXT_TYPE 类型
      const context = usable as ReactContext<T>;
      return readContext(context);
    }
  }
  throw new Error('不支持的use参数 ' + usable);
}

/**
 * Callback
 */
function mountCallback<T>(callback: T, deps: HookDeps | undefined) {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  hook.memoizedState = [callback, nextDeps];
  return callback;
}

function updateCallback<T>(callback: T, deps: HookDeps | undefined) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;

  if (nextDeps !== null) {
    const prevDeps = prevState[1];
    if (areHookInputsEqual(nextDeps, prevDeps)) {
      return prevState[0];
    }
  }
  hook.memoizedState = [callback, nextDeps];
  return callback;
}

/**
 * Memo
 */
function mountMemo<T>(nextCreate: () => T, deps: HookDeps | undefined) {
  const hook = mountWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const nextValue = nextCreate();
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

function updateMemo<T>(nextCreate: () => T, deps: HookDeps | undefined) {
  const hook = updateWorkInProgressHook();
  const nextDeps = deps === undefined ? null : deps;
  const prevState = hook.memoizedState;

  if (nextDeps !== null) {
    const prevDeps = prevState[1];
    if (areHookInputsEqual(nextDeps, prevDeps)) {
      return prevState[0];
    }
  }
  const nextValue = nextCreate();
  hook.memoizedState = [nextValue, nextDeps];
  return nextValue;
}

// 获取当前 Hook 对应的状态
function mountWorkInProgressHook(): Hook {
  const hook: Hook = {
    baseState: null,
    memoizedState: null,
    baseQueue: null,
    updateQueue: null,
    next: null
  };
  if (workInProgressHook === null) {
    // mount时 第一个hook
    if (currentlyRenderingFiber === null) {
      throw new Error('请在函数组件内调用hook');
    } else {
      workInProgressHook = hook;
      // 在 Fiber.memoizedState 上记录 Hooks 链表
      currentlyRenderingFiber.memoizedState = workInProgressHook;
    }
  } else {
    // mount时 后续的hook（使用 next 进行连接）
    workInProgressHook.next = hook;
    workInProgressHook = hook;
  }
  return workInProgressHook;
}

function updateWorkInProgressHook(): Hook {
  // TODO render阶段触发的更新
  let nextCurrentHook: Hook | null;

  if (currentHook === null) {
    // FC update 时的第一个hook
    const current = (currentlyRenderingFiber as FiberNode).alternate;
    if (current !== null) {
      nextCurrentHook = current.memoizedState;
    } else {
      // mount
      nextCurrentHook = null;
    }
  } else {
    // FC update时 后续的 hook
    nextCurrentHook = currentHook.next;
  }

  // 判断语句中使用了Hooks：if(...)( useState() )
  if (nextCurrentHook === null) {
    // mount/update u1 u2 u3
    // update       u1 u2 u3 u4
    throw new Error(
      `组件 ${currentlyRenderingFiber?.type.name} 本次执行时的Hook比上次执行时多`
    );
  }

  // FC 更新时的 Hook 赋值给 currentHook
  currentHook = nextCurrentHook as Hook;

  const newHook: Hook = {
    memoizedState: currentHook.memoizedState,
    updateQueue: currentHook.updateQueue,
    next: null,
    baseQueue: currentHook.baseQueue,
    baseState: currentHook.baseState
  };

  if (workInProgressHook === null) {
    // mount时 第一个hook
    if (currentlyRenderingFiber === null) {
      throw new Error('请在函数组件内调用hook');
    } else {
      workInProgressHook = newHook;
      currentlyRenderingFiber.memoizedState = workInProgressHook;
    }
  } else {
    // mount时 后续的hook
    workInProgressHook.next = newHook;
    workInProgressHook = newHook;
  }
  return workInProgressHook;
}

// unWind 阶段，重置状态
export function resetHooksOnUnwind(wip: FiberNode) {
  currentlyRenderingFiber = null;
  currentHook = null;
  workInProgressHook = null;
}

export function bailoutHook(wip: FiberNode, renderLane: Lane) {
  const current = wip.alternate as FiberNode;
  wip.updateQueue = current.updateQueue;
  wip.flags &= ~PassiveEffect;

  current.lanes = removeLanes(current.lanes, renderLane);
}
