export type Flags = number;

// 副作用函数标记
export const NoFlags = 0b0000000; // 无标记
export const Placement = 0b0000001; // 新增
export const Update = 0b0000010; // 更新
export const ChildDeletion = 0b0000100; // 删除

export const PassiveEffect = 0b0001000; // 当前 fiber 上本次更新，需要触发 useEffect 的情况
export const Ref = 0b0010000;

export const Visibility = 0b0100000;

// 捕获到 something
export const DidCapture = 0b1000000;

// unwind应该捕获、还未捕获到
export const ShouldCapture = 0b1000000000000;

export const MutationMask =
  Placement | Update | ChildDeletion | Ref | Visibility;
export const LayoutMask = Ref;

// 触发 useEffect 的情况
export const PassiveMask = PassiveEffect | ChildDeletion;

export const HostEffectMask =
  MutationMask | LayoutMask | PassiveMask | DidCapture;
