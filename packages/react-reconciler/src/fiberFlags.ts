export type Flags = number;

export const NoFlags = 0b0000000;
export const Placement = 0b0000001;
export const Update = 0b0000010;
export const ChildDeletion = 0b0000100;

// 当前 Fiber 上是否存在 useEffect 的副作用
// 1、mount 时一定存在
// 2、update 时 deps 发生变化时存在
export const PassiveEffect = 0b0001000;

export const MutationMask = Placement | Update | ChildDeletion;

// 是否要触发 useEffect 的副作用
export const PassiveMask = PassiveEffect | ChildDeletion;
