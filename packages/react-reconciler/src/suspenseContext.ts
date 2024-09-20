import { FiberNode } from './fiber';

// 存储 Suspense 的栈
const suspenseHandlerStack: FiberNode[] = [];

// 获取最近插入的 Suspense
export function getSuspenseHandler() {
  return suspenseHandlerStack[suspenseHandlerStack.length - 1];
}

// 在 beginWork 阶段的 updateSuspenseComponent 中 push
export function pushSuspenseHandler(handler: FiberNode) {
  suspenseHandlerStack.push(handler);
}

// 1、在 complete 阶段的 SuspenseComponent 中 pop
// 2、在 unwind 阶段的 unwindWork 中 pop
export function popSuspenseHandler() {
  suspenseHandlerStack.pop();
}
