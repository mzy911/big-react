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

// 给 DOM 绑定 props
// dom[xxx] = reactElemnt props
export function updateFiberProps(node: DOMElement, props: Props) {
  node[elementPropsKey] = props;
}

// 初始化(绑定)事件监听
export function initEvent(container: Container, eventType: string) {
  if (!validEventTypeList.includes(eventType)) {
    console.warn('当前不支持', eventType, '事件');
    return;
  }

  if (__DEV__) {
    console.log('初始化事件：', eventType);
  }

  // 对根节点绑定事件，然后利用冒泡、捕获出发事件
  container.addEventListener(eventType, (e) => {
    dispatchEvent(container, eventType, e);
  });
}

// 合成事件
function createSyntheticEvent(e: Event) {
  const syntheticEvent = e as SyntheticEvent;
  syntheticEvent.__stopPropagation = false;

  const originStopPropagation = e.stopPropagation;

  // syntheticEvent 上挂在 stopPropagation 方法
  syntheticEvent.stopPropagation = () => {
    // 1、如果事件里使用 e.stopPropagation();
    // 2、手动调用执行
    syntheticEvent.__stopPropagation = true;
    if (originStopPropagation) {
      originStopPropagation();
    }
  };
  return syntheticEvent;
}

// 事件触发的过程
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

  // 2. 构造合成事件（处理了 stopPropagation）
  const se = createSyntheticEvent(e);

  // 3. 遍历captue（捕获事件）
  triggerEventFlow(capture, se);

  // 4. 遍历 bubble（不阻止冒泡会执行）
  if (!se.__stopPropagation) {
    triggerEventFlow(bubble, se);
  }
}

function triggerEventFlow(paths: EventCallback[], se: SyntheticEvent) {
  for (let i = 0; i < paths.length; i++) {
    const callback = paths[i];

    // 根据优先级执行事件
    unstable_runWithPriority(eventTypeToSchdulerPriority(se.type), () => {
      callback.call(null, se);
    });

    if (se.__stopPropagation) {
      break;
    }
  }
}

// 将源生事件转为 React 内部对应的合成事件
function getEventCallbackNameFromEventType(
  eventType: string
): string[] | undefined {
  return {
    click: ['onClickCapture', 'onClick']
    // ...
  }[eventType];
}

// 收集沿途的事件
function collectPaths(
  targetElement: DOMElement, // 触发事件的元素
  container: Container, // app 的根节点
  eventType: string // 事件类型，此处特指 'click'
) {
  // 保存事件
  const paths: Paths = {
    capture: [],
    bubble: []
  };

  // 从 targetElement 到 container 向上收集事件
  while (targetElement && targetElement !== container) {
    // 当前 element 上的所有 props 属性
    const elementProps = targetElement[elementPropsKey];

    if (elementProps) {
      // click -> [onClick onClickCapture]
      const callbackNameList = getEventCallbackNameFromEventType(eventType);

      if (callbackNameList) {
        callbackNameList.forEach((callbackName, i) => {
          // reactEvent 例如：onClick
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

    // 向上 👆
    targetElement = targetElement.parentNode as DOMElement;
  }
  return paths;
}

// 根据原生事件，映射 scheduler 中对应的优先级
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
