import { Dispatcher, resolveDispatcher } from './src/currentDispatcher';
import currentDispatcher from './src/currentDispatcher';
import currentBatchConfig from './src/currentBatchConfig';
import {
  createElement as createElementFn,
  isValidElement as isValidElementFn
} from './src/jsx';
export { REACT_FRAGMENT_TYPE as Fragment } from 'shared/ReactSymbols';
export { createContext } from './src/context';
export { lazy } from './src/lazy';
export { REACT_SUSPENSE_TYPE as Suspense } from 'shared/ReactSymbols';
export { memo } from './src/memo';

/**
 * react包：宿主环境无关的公用方法
 */

export const useState: Dispatcher['useState'] = (initialState) => {
  const dispatcher = resolveDispatcher();
  return dispatcher.useState(initialState);
};

export const useEffect: Dispatcher['useEffect'] = (create, deps) => {
  const dispatcher = resolveDispatcher();
  return dispatcher.useEffect(create, deps);
};

export const useTransition: Dispatcher['useTransition'] = () => {
  const dispatcher = resolveDispatcher();
  return dispatcher.useTransition();
};

export const useRef: Dispatcher['useRef'] = (initialValue) => {
  const dispatcher = resolveDispatcher() as Dispatcher;
  return dispatcher.useRef(initialValue);
};

export const useContext: Dispatcher['useContext'] = (context) => {
  const dispatcher = resolveDispatcher() as Dispatcher;
  return dispatcher.useContext(context);
};

export const use: Dispatcher['use'] = (usable) => {
  const dispatcher = resolveDispatcher() as Dispatcher;
  return dispatcher.use(usable);
};

export const useMemo: Dispatcher['useMemo'] = (nextCreate, deps) => {
  const dispatcher = resolveDispatcher() as Dispatcher;
  return dispatcher.useMemo(nextCreate, deps);
};

export const useCallback: Dispatcher['useCallback'] = (callback, deps) => {
  const dispatcher = resolveDispatcher() as Dispatcher;
  return dispatcher.useCallback(callback, deps);
};

// 内部数据共享
// 1、内部数据共享层：Reconciler中调用Hooks <===>  内部数据共享  <===> React
// 2、外部通过 React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED 获取，并且保存在 internals 中
// 3、通过 internals.currentDispatcher 在不同的时期，进行赋值
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = {
  currentDispatcher,
  currentBatchConfig
};

export const version = '0.0.0';

// TODO 根据环境区分使用jsx/jsxDEV
export const createElement = createElementFn;
export const isValidElement = isValidElementFn;
