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

	// 返回 render 方法
	return {
		render(element: ReactElementType) {
			initEvent(container, 'click');
			return updateContainer(element, root);
		}
	};
}
