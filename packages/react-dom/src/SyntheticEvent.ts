import { Container } from 'hostConfig';
import {
  unstable_ImmediatePriority,
  unstable_NormalPriority,
  unstable_runWithPriority,
  unstable_UserBlockingPriority
} from 'scheduler';
import { Props } from 'shared/ReactTypes';

export const elementPropsKey = '__props';
const validEventTypeList = ['click'];

type EventCallback = (e: Event) => void;

interface SyntheticEvent extends Event {
  __stopPropagation: boolean;
}

interface Paths {
  capture: EventCallback[];
  bubble: EventCallback[];
}

export interface DOMElement extends Element {
  [elementPropsKey]: Props;
}

// 给 DOM 绑定 事件
// dom[xxx] = reactElemnt props
export function updateFiberProps(node: DOMElement, props: Props) {
  node[elementPropsKey] = props;
}

export function initEvent(container: Container, eventType: string) {
  if (!validEventTypeList.includes(eventType)) {
    console.warn('当前不支持', eventType, '事件');
    return;
  }
  if (__DEV__) {
    console.log('初始化事件：', eventType);
  }
  container.addEventListener(eventType, (e) => {
    dispatchEvent(container, eventType, e);
  });
}

// 合成事件
function createSyntheticEvent(e: Event) {
  const syntheticEvent = e as SyntheticEvent;
  syntheticEvent.__stopPropagation = false;
  const originStopPropagation = e.stopPropagation;

  syntheticEvent.stopPropagation = () => {
    syntheticEvent.__stopPropagation = true;
    if (originStopPropagation) {
      originStopPropagation();
    }
  };
  return syntheticEvent;
}

function dispatchEvent(container: Container, eventType: string, e: Event) {
  const targetElement = e.target;

  if (targetElement === null) {
    console.warn('事件不存在target', e);
    return;
  }

  // 1. 收集沿途的事件
  const { bubble, capture } = collectPaths(
    targetElement as DOMElement,
    container,
    eventType
  );
  // 2. 构造合成事件
  const se = createSyntheticEvent(e);

  // 3. 遍历captue
  triggerEventFlow(capture, se);

  if (!se.__stopPropagation) {
    // 4. 遍历bubble
    triggerEventFlow(bubble, se);
  }
}

function triggerEventFlow(paths: EventCallback[], se: SyntheticEvent) {
  for (let i = 0; i < paths.length; i++) {
    const callback = paths[i];
    unstable_runWithPriority(eventTypeToSchdulerPriority(se.type), () => {
      callback.call(null, se);
    });

    if (se.__stopPropagation) {
      break;
    }
  }
}

function getEventCallbackNameFromEventType(
  eventType: string
): string[] | undefined {
  return {
    click: ['onClickCapture', 'onClick']
  }[eventType];
}

// 模拟实现：事件的捕获、冒泡
function collectPaths(
  targetElement: DOMElement,
  container: Container,
  eventType: string
) {
  const paths: Paths = {
    capture: [],
    bubble: []
  };

  while (targetElement && targetElement !== container) {
    // 收集
    const elementProps = targetElement[elementPropsKey];
    if (elementProps) {
      // click -> onClick onClickCapture
      const callbackNameList = getEventCallbackNameFromEventType(eventType);
      if (callbackNameList) {
        callbackNameList.forEach((callbackName, i) => {
          const eventCallback = elementProps[callbackName];
          if (eventCallback) {
            if (i === 0) {
              // 捕获从前插入
              paths.capture.unshift(eventCallback);
            } else {
              // 冒泡从后插入
              paths.bubble.push(eventCallback);
            }
          }
        });
      }
    }
    targetElement = targetElement.parentNode as DOMElement;
  }
  return paths;
}

function eventTypeToSchdulerPriority(eventType: string) {
  switch (eventType) {
    case 'click':
    case 'keydown':
    case 'keyup':
      return unstable_ImmediatePriority;
    case 'scroll':
      return unstable_UserBlockingPriority;
    default:
      return unstable_NormalPriority;
  }
}
