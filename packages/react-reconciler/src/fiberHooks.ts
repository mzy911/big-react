import { useState } from 'react';
import { Dispatch } from 'react/src/currentDispatcher';
import { Dispatcher } from 'react/src/currentDispatcher';
import internals from 'shared/internals';
import { Action } from 'shared/ReactTypes';
import { FiberNode } from './fiber';
import {
  createUpdate,
  createUpdateQueue,
  enqueueUpdate,
  processUpdateQueue,
  UpdateQueue
} from './updateQueue';
import { scheduleUpdateOnFiber } from './workLoop';

// 正在处理的函数组件 Fiber
let currentlyRenderingFiber: FiberNode | null = null;
// 当前正在处理的 Hook
let workInProgressHook: Hook | null = null;
let currentHook: Hook | null = null;

const { currentDispatcher } = internals;
interface Hook {
  memoizedState: any; // 用于保存 hook 版本的状态值
  updateQueue: unknown; // hook 本身可以触发更新，所以存在 updateQueue
  next: Hook | null;
}

// Fiber 类型为函数组件时
// 1、重置状态
// 2、挂载 update
// 3、返回 children
export function renderWithHooks(wip: FiberNode) {
  // 赋值操作：当前正在渲染的 Fiber
  currentlyRenderingFiber = wip;
  // 函数组件上的 memoizedState 用于保存 hooks 链表
  // wip.memoizedState = useState -> useEffect -> useState
  wip.memoizedState = null;

  const current = wip.alternate;

  if (current !== null) {
    // update
    currentDispatcher.current = HooksDispatcherOnUpdate;
  } else {
    // mount
    currentDispatcher.current = HooksDispatcherOnMount;
  }

  const Component = wip.type;
  const props = wip.pendingProps;
  // FC render
  const children = Component(props);

  // 重置操作
  currentlyRenderingFiber = null;
  workInProgressHook = null;
  currentHook = null;
  return children;
}

const HooksDispatcherOnMount: Dispatcher = {
  useState: mountState
};

const HooksDispatcherOnUpdate: Dispatcher = {
  useState: updateState
};

function mountState<State>(
  initialState: (() => State) | State
): [State, Dispatch<State>] {
  // 找到当前useState对应的hook数据
  const hook = mountWorkInProgresHook();

  // 将 useState 计算后的的值，挂载到 hook.memoizedState 上
  let memoizedState;
  if (initialState instanceof Function) {
    memoizedState = initialState();
  } else {
    memoizedState = initialState;
  }
  hook.memoizedState = memoizedState;

  // 创建 updateQueue
  const queue = createUpdateQueue<State>();
  hook.updateQueue = queue;

  // @ts-ignore：
  const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, queue);
  // 保存 dispatch 方法
  queue.dispatch = dispatch;

  // 返回最新的 state 和 dispatch 方法
  return [memoizedState, dispatch];
}

// mount时：找到当前 useState 对应的 hook 数据
function mountWorkInProgresHook(): Hook {
  const hook: Hook = {
    memoizedState: null,
    updateQueue: null,
    next: null
  };
  if (workInProgressHook === null) {
    // mount时 第一个hook
    if (currentlyRenderingFiber === null) {
      // 不是在函数内调用 hook
      throw new Error('请在函数组件内调用hook');
    } else {
      workInProgressHook = hook;

      // hooks 以链表的形式挂在到 wip.memoizedState 上
      currentlyRenderingFiber.memoizedState = workInProgressHook;
    }
  } else {
    // mount时 后续的hook
    workInProgressHook.next = hook;
    workInProgressHook = hook;
  }
  return workInProgressHook;
}

function updateState<State>(): [State, Dispatch<State>] {
  // 找到当前useState对应的hook数据
  const hook = updateWorkInProgresHook();

  // 计算新state的逻辑
  const queue = hook.updateQueue as UpdateQueue<State>;
  const pending = queue.shared.pending;

  if (pending !== null) {
    const { memoizedState } = processUpdateQueue(hook.memoizedState, pending);
    hook.memoizedState = memoizedState;
  }

  return [hook.memoizedState, queue.dispatch as Dispatch<State>];
}

function updateWorkInProgresHook(): Hook {
  // TODO render阶段触发的更新
  let nextCurrentHook: Hook | null;

  if (currentHook === null) {
    // 这是这个FC update时的第一个hook
    const current = currentlyRenderingFiber?.alternate;
    if (current !== null) {
      nextCurrentHook = current?.memoizedState;
    } else {
      // mount
      nextCurrentHook = null;
    }
  } else {
    // 这个FC update时 后续的hook
    nextCurrentHook = currentHook.next;
  }

  if (nextCurrentHook === null) {
    // mount/update u1 u2 u3
    // update       u1 u2 u3 u4
    throw new Error(
      `组件${currentlyRenderingFiber?.type}本次执行时的Hook比上次执行时多`
    );
  }

  currentHook = nextCurrentHook as Hook;
  const newHook: Hook = {
    memoizedState: currentHook.memoizedState,
    updateQueue: currentHook.updateQueue,
    next: null
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

// 实现 dispatch 方法
function dispatchSetState<State>(
  fiber: FiberNode,
  updateQueue: UpdateQueue<State>,
  action: Action<State>
) {
  // 创建 update 对象
  const update = createUpdate(action);
  enqueueUpdate(updateQueue, update);

  // 开始调用
  scheduleUpdateOnFiber(fiber);
}
