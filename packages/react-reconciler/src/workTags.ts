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
export const FunctionComponent = 0; // 函数组件
export const HostRoot = 3; // 项目根节点：ReactDOM.render()
export const HostComponent = 5; // 元素：<div></div>
export const HostText = 6; // 文本节点：'abc'
export const Fragment = 7; // 占位符：<></>
export const ContextProvider = 8; // <Context.provider></Context.provider>

export const SuspenseComponent = 13; // <Suspense></Suspense>
export const OffscreenComponent = 14; // 功能类似Vue中的keep-alive，用来在组件「失活」时在后台保存组件状态

export const LazyComponent = 16; // 包裹懒加载的组件
export const MemoComponent = 15; // <React.memo></React.memo>
