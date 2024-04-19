import { Thenable, Wakeable } from 'shared/ReactTypes';
import { REACT_LAZY_TYPE } from 'shared/ReactSymbols';

// lazy 组件的四个状态
const Uninitialized = -1;
const Pending = 0;
const Resolved = 1;
const Rejected = 2;

type UninitializedPayload<T> = {
  _status: typeof Uninitialized;
  _result: () => Thenable<{ default: T }>;
};

type PendingPayload = {
  _status: typeof Pending;
  _result: Wakeable;
};

type ResolvedPayload<T> = {
  _status: typeof Resolved;
  _result: { default: T };
};

type RejectedPayload = {
  _status: typeof Rejected;
  _result: any;
};

type Payload<T> =
  | UninitializedPayload<T>
  | PendingPayload
  | ResolvedPayload<T>
  | RejectedPayload;

export type LazyComponent<T, P> = {
  $$typeof: symbol | number;
  _payload: P;
  _init: (payload: P) => T;
};

function lazyInitializer<T>(payload: Payload<T>): T {
  // 首次加载
  if (payload._status === Uninitialized) {
    const ctor = payload._result;
    const thenable = ctor();

    // 异步
    thenable.then(
      (moduleObject) => {
        // @ts-ignore
        const resolved: ResolvedPayload<T> = payload;
        // 将状态改为 Resolved
        resolved._status = Resolved;
        // _result 赋值加载成功结果
        resolved._result = moduleObject;
      },
      (error) => {
        // @ts-ignore
        const rejected: RejectedPayload = payload;
        // 将状态改为 Rejected
        rejected._status = Rejected;
        // _result 赋值加载失败结果
        rejected._result = error;
      }
    );

    // 同步
    if (payload._status === Uninitialized) {
      // @ts-ignore
      const pending: PendingPayload = payload;
      // 将状态改为 Pending
      pending._status = Pending;
      // _result 赋值为 thenable
      pending._result = thenable;
    }
  }

  if (payload._status === Resolved) {
    // 如果加载成功
    const moduleObject = payload._result;
    return moduleObject.default;
  } else {
    throw payload._result;
  }
}

// 组件懒加载：结合 Suspense 并进行包裹
export function lazy<T>(
  ctor: () => Thenable<{ default: T }>
): LazyComponent<T, Payload<T>> {
  const payload: Payload<T> = {
    _status: Uninitialized,
    _result: ctor
  };

  const lazyType: LazyComponent<T, Payload<T>> = {
    $$typeof: REACT_LAZY_TYPE,
    _payload: payload,
    _init: lazyInitializer
  };

  return lazyType;
}
