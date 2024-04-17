let syncQueue: ((...args: any) => void)[] | null = null;
// 判断是否正在执行任务
let isFlushingSyncQueue = false;

// 调度同步任务（向同步任务队列中插入任务）
export function scheduleSyncCallback(callback: (...args: any) => void) {
  if (syncQueue === null) {
    syncQueue = [callback];
  } else {
    syncQueue.push(callback);
  }
}

// 执行同步任务队列
export function flushSyncCallbacks() {
  if (!isFlushingSyncQueue && syncQueue) {
    isFlushingSyncQueue = true;
    try {
      syncQueue.forEach((callback) => callback());
    } catch (e) {
      if (__DEV__) {
        console.error('flushSyncCallbacks报错', e);
      }
    } finally {
      isFlushingSyncQueue = false;
      syncQueue = null;
    }
  }
}
