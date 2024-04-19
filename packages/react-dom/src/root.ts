// ReactDOM.createRoot(root).render(<App/>)

import {
  createContainer,
  updateContainer
} from 'react-reconciler/src/fiberReconciler';
import { ReactElementType } from 'shared/ReactTypes';
import { Container } from './hostConfig';
import { initEvent } from './SyntheticEvent';

export function createRoot(container: Container) {
  //  返回 FiberRootNode;
  const root = createContainer(container);

  // 返回带有 render 方法的对象
  return {
    render(element: ReactElementType) {
      // 初始化 Event
      initEvent(container, 'click');

      return updateContainer(element, root);
    }
  };
}
