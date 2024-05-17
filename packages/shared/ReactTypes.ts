export type Type = any;
export type Key = any;
export type Ref = any;
export type Props = any;
export type ElementType = any;

export interface ReactElementType {
	$$typeof: symbol | number; // REACT_ELEMENT_TYPE ｜ REACT_FRAGMENT_TYPE
	type: ElementType; // 1、值为 string 时是 <div>..</div> 2、值为 function 时是 函数组件
	key: Key;
	props: Props; // Element
	ref: Ref;
	__mark: string;
}

export type Action<State> = State | ((prevState: State) => State);
