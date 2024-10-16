import { Dispatch } from 'react/src/currentDispatcher';
import { Action } from 'shared/ReactTypes';
import { isSubsetOfLanes, Lane, mergeLanes, NoLane } from './fiberLanes';
import { FiberNode } from './fiber';

// update 对象
export interface Update<State> {
  action: Action<State>;
  lane: Lane;
  next: Update<any> | null;
  hasEagerState: boolean;
  eagerState: State | null;
}

// update 对象队列
export interface UpdateQueue<State> {
  shared: {
    pending: Update<State> | null;
  };
  // 用来保存 hook 的 dispatch
  dispatch: Dispatch<State> | null;
}

// 创建 update 对象
export const createUpdate = <State>(
  action: Action<State>,
  lane: Lane,
  hasEagerState = false,
  eagerState = null as State | null
): Update<State> => {
  return {
    action,
    lane,
    next: null,
    hasEagerState,
    eagerState
  };
};

// 创建 update 对象队列
export const createUpdateQueue = <State>() => {
  return {
    shared: {
      pending: null
    },
    dispatch: null
  } as UpdateQueue<State>;
};

// 向 UpdateQueue 中添加 Update
export const enqueueUpdate = <State>(
  updateQueue: UpdateQueue<State>,
  update: Update<State>,
  fiber: FiberNode,
  lane: Lane
) => {
  const pending = updateQueue.shared.pending;
  if (pending === null) {
    // pending = a -> a
    update.next = update;
  } else {
    // 每次追加 update 最终都会形成环状链表
    // pending = b -> a -> b
    // pending = c -> a -> b -> c
    update.next = pending.next;
    pending.next = update;
  }

  updateQueue.shared.pending = update;

  fiber.lanes = mergeLanes(fiber.lanes, lane);
  const alternate = fiber.alternate;
  if (alternate !== null) {
    alternate.lanes = mergeLanes(alternate.lanes, lane);
  }
};

// 返回 action 中的值
export function basicStateReducer<State>(
  state: State,
  action: Action<State>
): State {
  if (action instanceof Function) {
    // baseState 1 update (x) => 4x -> memoizedState 4
    return action(state);
  } else {
    // baseState 1 update 2 -> memoizedState 2
    return action;
  }
}

// "消费"(执行) Update 的方法
export const processUpdateQueue = <State>(
  baseState: State, // 初始状态
  pendingUpdate: Update<State> | null, // 要执行的 update 链表
  renderLane: Lane,
  onSkipUpdate?: <State>(update: Update<State>) => void
): {
  memoizedState: State; // 计算后的值
  baseState: State; // 最后一个不被跳过的值
  baseQueue: Update<State> | null;
} => {
  const result: ReturnType<typeof processUpdateQueue<State>> = {
    memoizedState: baseState,
    baseState,
    baseQueue: null
  };

  // 如果此处有三个任务：pending c a b c
  if (pendingUpdate !== null) {
    // 获取到链表中的第一个 update 对象
    const first = pendingUpdate.next;
    let pending = pendingUpdate.next as Update<any>;

    let newState = baseState;
    let newBaseState = baseState;
    let newBaseQueueFirst: Update<State> | null = null;
    let newBaseQueueLast: Update<State> | null = null;

    do {
      const updateLane = pending.lane;
      if (!isSubsetOfLanes(renderLane, updateLane)) {
        // 优先级不够 被跳过
        const clone = createUpdate(pending.action, pending.lane);

        onSkipUpdate?.(clone);

        // 是不是第一个被跳过的
        if (newBaseQueueFirst === null) {
          // first u0 last = u0
          newBaseQueueFirst = clone;
          newBaseQueueLast = clone;
          newBaseState = newState;
        } else {
          // first u0 -> u1 -> u2
          // last u2
          (newBaseQueueLast as Update<State>).next = clone;
          newBaseQueueLast = clone;
        }
      } else {
        // 优先级足够，创建 update 对象
        if (newBaseQueueLast !== null) {
          const clone = createUpdate(pending.action, NoLane);
          newBaseQueueLast.next = clone;
          newBaseQueueLast = clone;
        }

        // 执行 update
        const action = pending.action;
        if (pending.hasEagerState) {
          newState = pending.eagerState;
        } else {
          newState = basicStateReducer(baseState, action);
        }
      }
      pending = pending.next as Update<any>;
    } while (pending !== first);

    if (newBaseQueueLast === null) {
      // 本次计算没有update被跳过
      newBaseState = newState;
    } else {
      newBaseQueueLast.next = newBaseQueueFirst;
    }

    result.memoizedState = newState;
    result.baseState = newBaseState;
    result.baseQueue = newBaseQueueLast;
  }
  return result;
};
