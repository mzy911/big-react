import { REACT_ELEMENT_TYPE, REACT_FRAGMENT_TYPE } from 'shared/ReactSymbols';
import { Key, Props, ReactElementType } from 'shared/ReactTypes';
import {
	createFiberFromElement,
	createFiberFromFragment,
	createWorkInProgress,
	FiberNode
} from './fiber';
import { ChildDeletion, Placement } from './fiberFlags';
import { Fragment, HostText } from './workTags';

type ExistingChildren = Map<string | number, FiberNode>;

function ChildReconciler(shouldTrackEffects: boolean) {
	// 在 returnFiber.deletions 中收集要删除的 childToDelete
	function deleteChild(returnFiber: FiberNode, childToDelete: FiberNode) {
		if (!shouldTrackEffects) {
			return;
		}
		const deletions = returnFiber.deletions;
		if (deletions === null) {
			returnFiber.deletions = [childToDelete];
			returnFiber.flags |= ChildDeletion;
		} else {
			deletions.push(childToDelete);
		}
	}

	// 删除兄弟节点，最终调用 ChildReconciler
	function deleteRemainingChildren(
		returnFiber: FiberNode,
		currentFirstChild: FiberNode | null
	) {
		if (!shouldTrackEffects) {
			return;
		}
		let childToDelete = currentFirstChild;
		while (childToDelete !== null) {
			deleteChild(returnFiber, childToDelete);
			childToDelete = childToDelete.sibling;
		}
	}

	// 调度子节点为单一节点的情况
	function reconcileSingleElement(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		element: ReactElementType
	) {
		const key = element.key;

		// update 更新阶段
		while (currentFiber !== null) {
			// key相同
			if (currentFiber.key === key) {
				if (element.$$typeof === REACT_ELEMENT_TYPE) {
					// type相同
					if (currentFiber.type === element.type) {
						let props = element.props;
						if (element.type === REACT_FRAGMENT_TYPE) {
							props = element.props.children;
						}
						const existing = useFiber(currentFiber, props);
						existing.return = returnFiber;

						// 当前节点可复用，标记剩下的节点删除(删除原来可能存在的兄弟节点)
						deleteRemainingChildren(returnFiber, currentFiber.sibling);
						return existing;
					}

					// key相同，type不同 删掉所有旧的
					deleteRemainingChildren(returnFiber, currentFiber);
					break;
				} else {
					if (__DEV__) {
						console.warn('还未实现的react类型', element);
						break;
					}
				}
			} else {
				// key不同，删掉旧的
				deleteChild(returnFiber, currentFiber);
				currentFiber = currentFiber.sibling;
			}
		}

		// mount 阶段：创建 Fragment、Element 节点的 Fiber
		let fiber;
		if (element.type === REACT_FRAGMENT_TYPE) {
			fiber = createFiberFromFragment(element.props.children, key);
		} else {
			fiber = createFiberFromElement(element);
		}
		fiber.return = returnFiber;
		return fiber;
	}

	// 调度文本节点
	function reconcileSingleTextNode(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		content: string | number
	) {
		while (currentFiber !== null) {
			// update
			if (currentFiber.tag === HostText) {
				// 类型没变，可以复用
				const existing = useFiber(currentFiber, { content });
				existing.return = returnFiber;
				deleteRemainingChildren(returnFiber, currentFiber.sibling);
				return existing;
			}
			deleteChild(returnFiber, currentFiber);
			currentFiber = currentFiber.sibling;
		}
		const fiber = new FiberNode(HostText, { content }, null);
		fiber.return = returnFiber;
		return fiber;
	}

	// 标记当前 Fiber 是否插入
	function placeSingleChild(fiber: FiberNode) {
		if (shouldTrackEffects && fiber.alternate === null) {
			fiber.flags |= Placement;
		}
		return fiber;
	}

	// 调度子节点为数组的情况
	function reconcileChildrenArray(
		returnFiber: FiberNode,
		currentFirstChild: FiberNode | null,
		newChild: any[]
	) {
		// 最后一个可复用fiber在current中的index
		let lastPlacedIndex = 0;
		// 创建的最后一个fiber
		let lastNewFiber: FiberNode | null = null;
		// 创建的第一个fiber
		let firstNewFiber: FiberNode | null = null;

		// 1.将current保存在map中
		const existingChildren: ExistingChildren = new Map();
		let current = currentFirstChild;
		while (current !== null) {
			const keyToUse = current.key !== null ? current.key : current.index;
			existingChildren.set(keyToUse, current);
			current = current.sibling;
		}

		for (let i = 0; i < newChild.length; i++) {
			const after = newChild[i];

			// 2.遍历newChild，寻找是否可复用（可复用直接复用、不可复用创建新的Fiber）
			const newFiber = updateFromMap(returnFiber, existingChildren, i, after);

			if (newFiber === null) {
				continue;
			}

			// 3. 标记移动还是插入
			newFiber.index = i;
			newFiber.return = returnFiber;

			if (lastNewFiber === null) {
				lastNewFiber = newFiber;
				firstNewFiber = newFiber;
			} else {
				lastNewFiber.sibling = newFiber;
				lastNewFiber = lastNewFiber.sibling;
			}

			if (!shouldTrackEffects) {
				continue;
			}

			// 1、便利新的子节点、对比旧节点的 index
			// 2、单 current.index 对比 上一次的 current.index（即 lastPlacedIndex）
			// 3、标记 ‘d, e, f’
			//    a, b, c, d, e, f, 'g', x, y, z 旧
			//    0  1  2  3  4  5   6   7  8  9
			//
			//    a, b, c, 'g', d, e, f, x, y, z 新
			//    0  1  2   3   4  5  6  7  8  9
			const current = newFiber.alternate;
			if (current !== null) {
				const oldIndex = current.index;
				if (lastPlacedIndex > oldIndex) {
					// 移动
					newFiber.flags |= Placement;
					continue;
				} else {
					// 不移动
					lastPlacedIndex = oldIndex;
				}
			} else {
				// mount
				newFiber.flags |= Placement;
			}
		}

		// 4. 将Map中剩下的标记为删除：returnFiber.
		existingChildren.forEach((fiber) => {
			deleteChild(returnFiber, fiber);
		});

		// 返回多个子节点的链表
		return firstNewFiber;
	}

	// 根据旧的 FiberMap 返回新的 Fiber
	function updateFromMap(
		returnFiber: FiberNode, // 父节点
		existingChildren: ExistingChildren, // 旧 Fiber map
		index: number,
		element: any // 新的 Element
	): FiberNode | null {
		const keyToUse = element.key !== null ? element.key : index;
		const before = existingChildren.get(keyToUse);

		// 新的节点为 HostText
		if (typeof element === 'string' || typeof element === 'number') {
			if (before) {
				if (before.tag === HostText) {
					// existingChildren 中移除 keyToUse
					existingChildren.delete(keyToUse);
					// 复用旧节点
					return useFiber(before, { content: element + '' });
				}
			}
			// before 不存在，直接创建新的节点
			return new FiberNode(HostText, { content: element + '' }, null);
		}

		// 新的节点为 ReactElement
		if (typeof element === 'object' && element !== null) {
			switch (element.$$typeof) {
				case REACT_ELEMENT_TYPE:
					// type 为 REACT_FRAGMENT_TYPE 单独处理
					if (element.type === REACT_FRAGMENT_TYPE) {
						return updateFragment(
							returnFiber,
							before,
							element,
							keyToUse,
							existingChildren
						);
					}

					// key 相同
					if (before) {
						// type 相同
						if (before.type === element.type) {
							// existingChildren 中移除 keyToUse
							existingChildren.delete(keyToUse);
							// 复用旧节点
							return useFiber(before, element.props);
						}
					}
					// 根据 Element 创建 Fiber
					return createFiberFromElement(element);
			}

			// TODO 数组类型
			// 新的节点为 Array
			// <ul>
			//     <li/>
			//     <li/>
			//     子组件为数组
			//     {[<li/>,<li/>]}
			// </ul>
			if (Array.isArray(element) && __DEV__) {
				console.warn('还未实现数组类型的child');
			}
		}

		// 新的节点为 Array
		// <ul>
		//     <li/>
		//     <li/>
		//     子组件为数组
		//     <>
		//         <li/>
		//         <li/>
		//     </>
		// </ul>
		if (Array.isArray(element)) {
			return updateFragment(
				returnFiber,
				before,
				element,
				keyToUse,
				existingChildren
			);
		}
		return null;
	}

	// 调度 ChildFibers
	return function reconcileChildFibers(
		returnFiber: FiberNode,
		currentFiber: FiberNode | null,
		newChild?: any
	) {
		const isUnkeyedTopLevelFragment =
			typeof newChild === 'object' &&
			newChild !== null &&
			newChild.type === REACT_FRAGMENT_TYPE &&
			newChild.key === null;

		// 子节点为 Fragment
		if (isUnkeyedTopLevelFragment) {
			newChild = newChild.props.children;
		}

		// 子节点为 Array、REACT_ELEMENT_TYPE
		if (typeof newChild === 'object' && newChild !== null) {
			// 多节点的情况 ul> li*3
			if (Array.isArray(newChild)) {
				return reconcileChildrenArray(returnFiber, currentFiber, newChild);
			}

			switch (newChild.$$typeof) {
				case REACT_ELEMENT_TYPE:
					return placeSingleChild(
						reconcileSingleElement(returnFiber, currentFiber, newChild)
					);
				default:
					if (__DEV__) {
						console.warn('未实现的reconcile类型', newChild);
					}
					break;
			}
		}

		// 子节点为 HostText
		if (typeof newChild === 'string' || typeof newChild === 'number') {
			return placeSingleChild(
				reconcileSingleTextNode(returnFiber, currentFiber, newChild)
			);
		}

		if (currentFiber !== null) {
			// 兜底删除
			deleteRemainingChildren(returnFiber, currentFiber);
		}

		if (__DEV__) {
			console.warn('未实现的reconcile类型', newChild);
		}
		return null;
	};
}

// 克隆 Fiber
function useFiber(fiber: FiberNode, pendingProps: Props): FiberNode {
	const clone = createWorkInProgress(fiber, pendingProps);
	clone.index = 0;
	clone.sibling = null;
	return clone;
}

// 处理 element 为 Fragment 的情况
function updateFragment(
	returnFiber: FiberNode,
	current: FiberNode | undefined,
	elements: any[],
	key: Key,
	existingChildren: ExistingChildren
) {
	let fiber;

	if (!current || current.tag !== Fragment) {
		// 1、before 不存在 或 tag 不是 Fragment
		// 2、创建新的 fiber
		fiber = createFiberFromFragment(elements, key);
	} else {
		// existingChildren 中移除 key
		existingChildren.delete(key);
		// 复用旧节点
		fiber = useFiber(current, elements);
	}
	fiber.return = returnFiber;
	return fiber;
}

// 打标记：新增、删除
export const reconcileChildFibers = ChildReconciler(true);
export const mountChildFibers = ChildReconciler(false);
