import { REACT_ELEMENT_TYPE, REACT_FRAGMENT_TYPE } from 'shared/ReactSymbols';
import {
  Type,
  Key,
  Ref,
  Props,
  ReactElementType,
  ElementType
} from 'shared/ReactTypes';

/**
 * React创建元素有两种方式
 * 1、jsx 方式
 * 2、React.createElement 方式
 * 3、作为 babel 方法的调用进行转换
 */

// ReactElement
const ReactElement = function (
  type: Type,
  key: Key,
  ref: Ref | null,
  props: Props
): ReactElementType {
  const element = {
    $$typeof: REACT_ELEMENT_TYPE,
    type,
    key,
    ref,
    props,
    __mark: 'mfr'
  };
  return element;
};

// 判断是否为 React.element
export function isValidElement(object: any) {
  return (
    typeof object === 'object' &&
    object !== null &&
    object.$$typeof === REACT_ELEMENT_TYPE
  );
}

// 通过 createElement 创建 React.element
export const createElement = (
  type: ElementType,
  config: any,
  ...maybeChildren: any
) => {
  let key: Key = null;
  let ref: Ref | null = null;
  const props: Props = {};

  for (const prop in config) {
    const val = config[prop];

    // 将 'key' 对应的 val 转为字符串存储
    if (prop === 'key') {
      if (val !== undefined) {
        key = '' + val;
      }
      continue;
    }
    if (prop === 'ref') {
      if (val !== undefined) {
        ref = val;
      }
      continue;
    }
    if ({}.hasOwnProperty.call(config, prop)) {
      props[prop] = val;
    }
  }
  const maybeChildrenLength = maybeChildren.length;
  if (maybeChildrenLength) {
    if (maybeChildrenLength === 1) {
      props.children = maybeChildren[0];
    } else {
      props.children = maybeChildren;
    }
  }
  return ReactElement(type, key, ref, props);
};

export const Fragment = REACT_FRAGMENT_TYPE;

// 通过 jsx 创建 React.element
export const jsx = (type: ElementType, config: any, maybeKey: any) => {
  let key: Key = null;
  let ref: Ref | null = null;
  const props: Props = {};

  if (maybeKey !== undefined) {
    key = '' + maybeKey;
  }

  for (const prop in config) {
    const val = config[prop];
    if (prop === 'key') {
      if (val !== undefined) {
        key = '' + val;
      }
      continue;
    }
    if (prop === 'ref') {
      if (val !== undefined) {
        ref = val;
      }
      continue;
    }
    if ({}.hasOwnProperty.call(config, prop)) {
      props[prop] = val;
    }
  }

  return ReactElement(type, key, ref, props);
};

export const jsxDEV = jsx;
