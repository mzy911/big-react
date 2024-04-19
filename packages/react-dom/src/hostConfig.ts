import { FiberNode } from 'react-reconciler/src/fiber';
import { HostComponent, HostText } from 'react-reconciler/src/workTags';
import { Props } from 'shared/ReactTypes';
import { updateFiberProps, DOMElement } from './SyntheticEvent';

export type Container = Element;
export type Instance = Element;
export type TextInstance = Text;

/**
 * hostConfig：操作 DOM 节点
 */

// 创建 'type' 类型的 DOM 节点
export const createInstance = (type: string, props: Props): Instance => {
  const element = document.createElement(type) as unknown;

  // 设置 eleemnt.__props = props;
  updateFiberProps(element as DOMElement, props);
  return element as DOMElement;
};

// 创建文本节点
export const createTextInstance = (content: string) => {
  return document.createTextNode(content);
};

// 向父元素中插入子元素
export const appendInitialChild = (
  parent: Instance | Container,
  child: Instance
) => {
  parent.appendChild(child);
};

export const appendChildToContainer = appendInitialChild;

// commit 阶段更新 udpata
export const commitUpdate = (fiber: FiberNode) => {
  switch (fiber.tag) {
    // 文本节点
    case HostText:
      const text = fiber.memoizedProps?.content;
      return commitTextUpdate(fiber.stateNode, text);
    // 元素节点
    case HostComponent:
      return updateFiberProps(fiber.stateNode, fiber.memoizedProps);
    default:
      if (__DEV__) {
        console.warn('未实现的Update类型', fiber);
      }
      break;
  }
};

// commit 阶段更新文本节点
export const commitTextUpdate = (
  textInstance: TextInstance,
  content: string
) => {
  textInstance.textContent = content;
};

// father 元素删除指定的 child 元素
export const removeChild = (
  child: Instance | TextInstance,
  container: Container
) => {
  container.removeChild(child);
};

// father 元素内在某元素之前插入新的 child
export const insertChildToContainer = (
  child: Instance,
  container: Container,
  before: Instance
) => {
  container.insertBefore(child, before);
};

// 判断环境中是否支持微任务，支持使用 Promise 否则使用 setTimeout
export const scheduleMicroTask =
  typeof queueMicrotask === 'function'
    ? queueMicrotask
    : typeof Promise === 'function'
    ? (callback: (...args: any) => void) => Promise.resolve(null).then(callback)
    : setTimeout;

// 设置 DOM 节点 display
export const hideInstance = (instance: Instance) => {
  const style = (instance as HTMLElement).style;
  style.setProperty('display', 'none', 'important');
};

// 移除 DOM 节点 display
export const unHideInstance = (instance: Instance) => {
  const style = (instance as HTMLElement).style;
  style.display = '';
};

// 隐藏 文本 节点
export const hideTextInstance = (textInstance: TextInstance) => {
  textInstance.nodeValue = '';
};

// 显示 文本 节点
export const unHideTextInstance = (
  textInstance: TextInstance,
  text: string
) => {
  textInstance.nodeValue = text;
};
