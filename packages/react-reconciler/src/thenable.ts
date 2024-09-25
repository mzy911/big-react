import {
  FulfilledThenable,
  PendingThenable,
  RejectedThenable,
  Thenable
} from 'shared/ReactTypes';

export const SuspenseException = new Error(
  '这不是个真实的错误，而是Suspense工作的一部分。如果你捕获到这个错误，请将它继续抛出去'
);

// 挂起的 Thenable 对象
let suspendedThenable: Thenable<any> | null = null;

// 获取 thenable
export function getSuspenseThenable(): Thenable<any> {
  if (suspendedThenable === null) {
    throw new Error('应该存在suspendedThenable，这是个bug');
  }
  const thenable = suspendedThenable;
  suspendedThenable = null;
  return thenable;
}

// 1、包装、处理 thenable 对象
// 2、手动抛出一个错误，打断正常的 render 流程
export function trackUsedThenable<T>(thenable: Thenable<T>) {
  switch (thenable.status) {
    // 需要自己定义
    case 'fulfilled':
      return thenable.value;

    // 需要自己定义
    case 'rejected':
      throw thenable.reason;

    default:
      if (typeof thenable.status === 'string') {
        // tracked（此处什么都不干）
        thenable.then(noop, noop);
      } else {
        // untracked
        const pending = thenable as unknown as PendingThenable<T, void, any>;

        // 先设置为 pending 状态
        pending.status = 'pending';

        pending.then(
          (val) => {
            if (pending.status === 'pending') {
              // @ts-ignore
              const fulfilled: FulfilledThenable<T, void, any> = pending;
              fulfilled.status = 'fulfilled';
              fulfilled.value = val;
            }
          },
          (err) => {
            if (pending.status === 'pending') {
              // @ts-ignore
              const rejected: RejectedThenable<T, void, any> = pending;
              rejected.reason = err;
              rejected.status = 'rejected';
            }
          }
        );
      }
  }
  suspendedThenable = thenable;

  // use 手动抛出一个错误，打断正常的 render 流程
  throw SuspenseException;
}

// eslint-disable-next-line @typescript-eslint/no-empty-function
function noop() {}
