import { Container } from 'hostConfig';
import { ReactElementType } from 'shared/ReactTypes';
import { FiberNode, FiberRootNode } from './fiber';
import {
  createUpdate,
  createUpdateQueue,
  enqueueUpdate,
  UpdateQueue
} from './updateQueue';
import { scheduleUpdateOnFiber } from './workLoop';
import { HostRoot } from './workTags';

export function createContainer(container: Container) {
  // 创建根 Fiber
  const hostRootFiber = new FiberNode(HostRoot, {}, null);
  // RootNode
  const root = new FiberRootNode(container, hostRootFiber);
  hostRootFiber.updateQueue = createUpdateQueue();
  return root;
}

export function updateContainer(
  element: ReactElementType | null,
  root: FiberRootNode
) {
  const hostRootFiber = root.current;
  // 创建 update 对象，当前的 action 为 Element
  const update = createUpdate<ReactElementType | null>(element);
  // 创建 update 队列
  enqueueUpdate(
    hostRootFiber.updateQueue as UpdateQueue<ReactElementType | null>,
    update
  );
  // 开始调度
  scheduleUpdateOnFiber(hostRootFiber);
  return element;
}
