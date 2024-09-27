import { Container } from 'hostConfig';
import {
  unstable_ImmediatePriority,
  unstable_runWithPriority
} from 'scheduler';
import { ReactElementType } from 'shared/ReactTypes';
import { FiberNode, FiberRootNode } from './fiber';
import { requestUpdateLane } from './fiberLanes';
import {
  createUpdate,
  createUpdateQueue,
  enqueueUpdate,
  UpdateQueue
} from './updateQueue';
import { scheduleUpdateOnFiber } from './workLoop';
import { HostRoot } from './workTags';

/**
 * mount时调用 API： ReactDOM.createRoot().render
 */

// 首次执行：ReactDOM.createRoot()
export function createContainer(container: Container) {
  const hostRootFiber = new FiberNode(HostRoot, {}, null);
  const root = new FiberRootNode(container, hostRootFiber);

  // hostRootFiber 上添加 updateQueue 属性
  hostRootFiber.updateQueue = createUpdateQueue();

  // 最终向外返回 FiberRootNode
  return root;
}

// 更新时执行：ReactDOM.createRoot().render
export function updateContainer(
  element: ReactElementType | null,
  root: FiberRootNode
) {
  // 根结点使用 ImmediatePriority
  unstable_runWithPriority(unstable_ImmediatePriority, () => {
    const hostRootFiber = root.current;

    const lane = requestUpdateLane();

    // 创建 update 对象并追加到 enqueueUpdate 队列中
    const update = createUpdate<ReactElementType | null>(element, lane);
    enqueueUpdate(
      hostRootFiber.updateQueue as UpdateQueue<ReactElementType | null>,
      update,
      hostRootFiber,
      lane
    );

    // 开始调度任务
    scheduleUpdateOnFiber(hostRootFiber, lane);
  });
  return element;
}
