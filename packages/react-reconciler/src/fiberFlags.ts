export type Flags = number;

// DOM 节点相关的副作用
export const NoFlags = 0b0000000;
export const Placement = 0b0000001;
export const Update = 0b0000010;
export const ChildDeletion = 0b0000100;

// useEffect 副作用
export const PassiveEffect = 0b0001000;

// ref
export const Ref = 0b0010000;

// 是否可见
export const Visibility = 0b0100000;

// 捕获到 something 继续调度
export const DidCapture = 0b1000000;

// unwind 应该捕获、还未捕获到
export const ShouldCapture = 0b1000000000000;

export const MutationMask =
  Placement | Update | ChildDeletion | Ref | Visibility;

export const LayoutMask = Ref;

// 触发 useEffect 的情况
export const PassiveMask = PassiveEffect | ChildDeletion;

export const HostEffectMask =
  MutationMask | LayoutMask | PassiveMask | DidCapture;
