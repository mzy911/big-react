// Effect 副作用类型

// useEffect 对应的 Effect
export const Passive = 0b0010;

// useLayoutEffect 对应的 Effect
export const Layout = 0b01010;

// 本次更新是否存在副作用（是否包含：deps），会在 fiberNode 上挂载 PassiveEffect
export const HookHasEffect = 0b0001;
