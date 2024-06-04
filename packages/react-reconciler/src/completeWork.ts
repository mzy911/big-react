import {
	appendInitialChild,
	Container,
	createInstance,
	createTextInstance
} from 'hostConfig';
import { updateFiberProps } from 'react-dom/src/SyntheticEvent';
import { FiberNode } from './fiber';
import { NoFlags, Update } from './fiberFlags';
import {
	HostRoot,
	HostText,
	HostComponent,
	FunctionComponent,
	Fragment
} from './workTags';

function markUpdate(fiber: FiberNode) {
	fiber.flags |= Update;
}

// 1、mount 阶段：
//     创建梨形 DOM 树
//     挂载属性 wip.stateNode = instance
//   update 阶段：
//     更新 props
// 2、向上收集 Flags
export const completeWork = (wip: FiberNode) => {
	// 递归中的归
	const newProps = wip.pendingProps;
	const current = wip.alternate;

	switch (wip.tag) {
		// 元素节点
		case HostComponent:
			if (current !== null && wip.stateNode) {
				// update 阶段
				// 1. props 属性：{onClick: xx} {onClick: xxx}
				// 2. Update 的 flag
				// className style
				updateFiberProps(wip.stateNode, newProps);
			} else {
				// mount 阶段
				// 1. 构建 DOM
				const instance = createInstance(wip.type, newProps);
				// 2. 将 wip.child 插入到 instance
				appendAllChildren(instance, wip);
				wip.stateNode = instance;
			}

			bubbleProperties(wip);
			return null;

		// 文本节点
		case HostText:
			if (current !== null && wip.stateNode) {
				// update 阶段
				const oldText = current.memoizedProps?.content;
				const newText = newProps.content;
				if (oldText !== newText) {
					markUpdate(wip);
				}
			} else {
				// mount 阶段
				// 1. 构建DOM
				const instance = createTextInstance(newProps.content);
				wip.stateNode = instance;
			}

			bubbleProperties(wip);
			return null;

		// 根节点、函数组件、Fragment
		case HostRoot:
		case FunctionComponent:
		case Fragment:
			bubbleProperties(wip);
			return null;
		default:
			if (__DEV__) {
				console.warn('未处理的completeWork情况', wip);
			}
			break;
	}
};

// parent 依次插入多个子元素
function appendAllChildren(parent: Container, wip: FiberNode) {
	let node = wip.child;

	while (node !== null) {
		if (node.tag === HostComponent || node.tag === HostText) {
			appendInitialChild(parent, node?.stateNode);
		} else if (node.child !== null) {
			// 处理组件嵌套问题
			node.child.return = node;
			node = node.child;
			continue;
		}

		// 等于自己 - 中断
		if (node === wip) {
			return;
		}

		// 最后一个兄弟元素
		while (node.sibling === null) {
			if (node.return === null || node.return === wip) {
				return;
			}

			// 向上返回到父元素
			node = node?.return;
		}

		node.sibling.return = node.return;
		node = node.sibling;
	}
}

// 归的过程中收集 flags
function bubbleProperties(wip: FiberNode) {
	let subtreeFlags = NoFlags;
	let child = wip.child;

	while (child !== null) {
		subtreeFlags |= child.subtreeFlags;
		subtreeFlags |= child.flags;

		child.return = wip;
		child = child.sibling;
	}
	wip.subtreeFlags |= subtreeFlags;
}
