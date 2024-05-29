import { Dispatch } from 'react/src/currentDispatcher';
import { Action } from 'shared/ReactTypes';

export interface Update<State> {
  action: Action<State>;
}

export interface UpdateQueue<State> {
  shared: {
    pending: Update<State> | null;
  };
  dispatch: Dispatch<State> | null;
}

// 创建 update 对象，具有一个 action 对象
export const createUpdate = <State>(action: Action<State>): Update<State> => {
  return {
    action
  };
};

// 创建 update 队列
export const createUpdateQueue = <State>() => {
  return {
    shared: {
      pending: null
    },
    dispatch: null
  } as UpdateQueue<State>;
};

// 向 updateQueue 中插入 update 对象
export const enqueueUpdate = <State>(
  updateQueue: UpdateQueue<State>,
  update: Update<State>
) => {
  updateQueue.shared.pending = update;
};

// 消费 update 对象
// 1、返回值为 { memoizedState: baseState }
// 2、根据 action 的类型确定 memoizedState 的值
export const processUpdateQueue = <State>(
  baseState: State,
  pendingUpdate: Update<State> | null
): { memoizedState: State } => {
  const result: ReturnType<typeof processUpdateQueue<State>> = {
    memoizedState: baseState
  };

  if (pendingUpdate !== null) {
    const action = pendingUpdate.action;
    if (action instanceof Function) {
      // action 为的函数
      result.memoizedState = action(baseState);
    } else {
      // 1、设置 useState 为对象时
      // 2、解析 jsx 时 element
      result.memoizedState = action;
    }
  }

  return result;
};
