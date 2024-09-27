import { Wakeable } from 'shared/ReactTypes';
import { FiberNode, FiberRootNode } from './fiber';
import { ShouldCapture } from './fiberFlags';
import { Lane, markRootPinged } from './fiberLanes';
import { ensureRootIsScheduled, markRootUpdated } from './workLoop';
import { getSuspenseHandler } from './suspenseContext';

function attachPingListener(
  root: FiberRootNode,
  wakeable: Wakeable<any>,
  lane: Lane
) {
  // 利用缓存，避免重复处理
  let pingCache = root.pingCache;
  let threadIDs: Set<Lane> | undefined;

  if (pingCache === null) {
    threadIDs = new Set<Lane>();
    pingCache = root.pingCache = new WeakMap<Wakeable<any>, Set<Lane>>();
    pingCache.set(wakeable, threadIDs);
  } else {
    threadIDs = pingCache.get(wakeable);
    if (threadIDs === undefined) {
      threadIDs = new Set<Lane>();
      pingCache.set(wakeable, threadIDs);
    }
  }

  if (!threadIDs.has(lane)) {
    // 第一次进入
    threadIDs.add(lane);

    // eslint-disable-next-line no-inner-declarations
    function ping() {
      if (pingCache !== null) {
        pingCache.delete(wakeable);
      }
      // ping 的时候 root 上标记 pendingLanes
      markRootUpdated(root, lane);

      // ping 的时候 root 上标记 pingedLanes
      markRootPinged(root, lane);

      // 触发新的更新
      ensureRootIsScheduled(root);
    }

    // 1、等 use() 函数内的 thenable 函数执行完毕，会触发 ping 函数
    // 2、ping 函数内会重新调度更新
    wakeable.then(ping, ping);
  }
}

// 处理异常情况
export function throwException(root: FiberRootNode, value: any, lane: Lane) {
  // 1、处理 thenable 的错误
  if (
    value !== null &&
    typeof value === 'object' &&
    typeof value.then === 'function'
  ) {
    const weakable: Wakeable<any> = value;

    // 标记 ShouldCapture
    const suspenseBoundary = getSuspenseHandler();
    if (suspenseBoundary) {
      suspenseBoundary.flags |= ShouldCapture;
    }

    attachPingListener(root, weakable, lane);
  }

  // 2、处理 Error Boundary 的错误
}
