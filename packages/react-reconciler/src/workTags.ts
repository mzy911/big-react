export type WorkTag =
  | typeof FunctionComponent
  | typeof HostRoot
  | typeof HostComponent
  | typeof HostText
  | typeof Fragment
  | typeof ContextProvider
  | typeof SuspenseComponent
  | typeof OffscreenComponent
  | typeof LazyComponent
  | typeof MemoComponent;

/**
 * FiberNode 类型
 */
// 函数组件类型
export const FunctionComponent = 0;
// 项目挂载的根节点：ReactDOM.render()
export const HostRoot = 3;
// dom节点：<div></div>
export const HostComponent = 5;
// 文本节点：<div>123</div>
export const HostText = 6;
export const Fragment = 7;
export const ContextProvider = 8;

export const SuspenseComponent = 13;
export const OffscreenComponent = 14;

export const LazyComponent = 16;
export const MemoComponent = 15;
