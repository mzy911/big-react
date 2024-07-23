import { scheduleMicroTask } from 'hostConfig';
import { beginWork } from './beginWork';
import {
	commitHookEffectListCreate,
	commitHookEffectListDestroy,
	commitHookEffectListUnmount,
	commitMutationEffects
} from './commitWork';
import { completeWork } from './completeWork';
import {
	createWorkInProgress,
	FiberNode,
	FiberRootNode,
	PendingPassiveEffects
} from './fiber';
import { MutationMask, NoFlags, PassiveMask } from './fiberFlags';
import {
	getHighestPriorityLane,
	Lane,
	lanesToSchedulerPriority,
	markRootFinished,
	mergeLanes,
	NoLane,
	SyncLane
} from './fiberLanes';
import { flushSyncCallbacks, scheduleSyncCallback } from './syncTaskQueue';
import { HostRoot } from './workTags';
import {
	unstable_scheduleCallback as scheduleCallback,
	unstable_NormalPriority as NormalPriority,
	unstable_shouldYield,
	unstable_cancelCallback
} from 'scheduler';
import { HookHasEffect, Passive } from './hookEffectTags';
import { useEffect } from 'react';

let workInProgress: FiberNode | null = null;
let wipRootRenderLane: Lane = NoLane;
let rootDoesHasPassiveEffects = false;

type RootExitStatus = number;
const RootInComplete = 1; // 任务被打断
const RootCompleted = 2; // 任务执行完
// TODO 执行过程中报错了

// renderRoot 前的准备
function prepareFreshStack(root: FiberRootNode, lane: Lane) {
	root.finishedLane = NoLane; // 正在执行 work 的 lane
	root.finishedWork = null; // 正在执行的 work
	workInProgress = createWorkInProgress(root.current, {}); // 根据 current 克隆 workInProgress
	wipRootRenderLane = lane;
}

// 调度更新的总入口
export function scheduleUpdateOnFiber(fiber: FiberNode, lane: Lane) {
	// 向上找到更节点
	const root = markUpdateFromFiberToRoot(fiber);

	// 合并当前优先级，存放在 root.pendingLanes 中
	markRootUpdated(root, lane);

	// 开始调度
	ensureRootIsScheduled(root);
}

// 开始调度
function ensureRootIsScheduled(root: FiberRootNode) {
	// 获取优先级最高的 lane
	const updateLane = getHighestPriorityLane(root.pendingLanes);
	const existingCallback = root.callbackNode;

	// NoLane 时，取消遗留的 existingCallback
	if (updateLane === NoLane) {
		if (existingCallback !== null) {
			unstable_cancelCallback(existingCallback);
		}

		// 重置 callbackNode、callbackPriority 状态
		root.callbackNode = null;
		root.callbackPriority = NoLane;
		return;
	}

	const curPriority = updateLane;
	const prevPriority = root.callbackPriority;

	// 执行过程中，新增相同优先级的任务。去执行 existingCallback
	if (curPriority === prevPriority) {
		return;
	}

	// 存在更高优先级的任务，取消当前任务
	if (existingCallback !== null) {
		unstable_cancelCallback(existingCallback);
	}

	let newCallbackNode = null;

	console.log('优先级');

	if (updateLane === SyncLane) {
		// 同步优先级，使用微任务调度
		if (__DEV__) {
			console.log('在微任务中调度，优先级：', updateLane);
		}
		scheduleSyncCallback(performSyncWorkOnRoot.bind(null, root));
		scheduleMicroTask(flushSyncCallbacks);
	} else {
		// 其他优先级，用宏任务调度
		const schedulerPriority = lanesToSchedulerPriority(updateLane);

		// 宏任务使用 schedule 进行调度，所以使用 schedulerPriority
		newCallbackNode = scheduleCallback(
			schedulerPriority,
			// @ts-ignore
			performConcurrentWorkOnRoot.bind(null, root)
		);
	}

	// 保存 callbackNode、callbackPriority
	root.callbackNode = newCallbackNode;
	root.callbackPriority = curPriority;
}

function markRootUpdated(root: FiberRootNode, lane: Lane) {
	root.pendingLanes = mergeLanes(root.pendingLanes, lane);
}

// 从当前节点向上找到根节点
function markUpdateFromFiberToRoot(fiber: FiberNode) {
	let node = fiber;
	let parent = node.return;
	while (parent !== null) {
		node = parent;
		parent = node.return;
	}
	if (node.tag === HostRoot) {
		return node.stateNode;
	}
	return null;
}

// 并发更新
function performConcurrentWorkOnRoot(
	root: FiberRootNode,
	didTimeout: boolean
): any {
	// 保证 useEffect 回调执行完成
	const curCallback = root.callbackNode;
	// 说明：useEffect 调用时又触发了更高优先级的任务
	const didFlushPassiveEffect = flushPassiveEffects(root.pendingPassiveEffects);
	// 是否存在正在执行的回调
	if (didFlushPassiveEffect) {
		// 有更高优先级的任务，取消当前任务
		if (root.callbackNode !== curCallback) {
			return null;
		}
	}

	const lane = getHighestPriorityLane(root.pendingLanes);
	const curCallbackNode = root.callbackNode;

	// lane 为 NoLane 直接退出
	if (lane === NoLane) {
		return null;
	}

	// 调用异步任务中产生了新的同步任务
	const needSync = lane === SyncLane || didTimeout;

	// render阶段
	const exitStatus = renderRoot(root, lane, !needSync);

	// 继续调度
	ensureRootIsScheduled(root);

	// 中断任务
	if (exitStatus === RootInComplete) {
		// 不是同一个 callBack 直接 return
		if (root.callbackNode !== curCallbackNode) {
			return null;
		}
		// 是同一个 callBack 继续执行
		return performConcurrentWorkOnRoot.bind(null, root);
	}

	// 完成任务，进入 commit 阶段
	if (exitStatus === RootCompleted) {
		const finishedWork = root.current.alternate;
		root.finishedWork = finishedWork;
		root.finishedLane = lane;
		wipRootRenderLane = NoLane;
		commitRoot(root);
	} else if (__DEV__) {
		console.error('还未实现的并发更新结束状态');
	}
}

// 同步任务
function performSyncWorkOnRoot(root: FiberRootNode) {
	// 获取当前优先级最高的 lane
	const nextLane = getHighestPriorityLane(root.pendingLanes);

	// 发现新的非同步任务，开始新的调度
	// 1、执行同步任务的时候，触发了新的异步任务
	// 2、继续调度
	if (nextLane !== SyncLane) {
		ensureRootIsScheduled(root);
		return;
	}

	const exitStatus = renderRoot(root, nextLane, false);

	// 1、同步任务进入完成状态
	// 2、重置状态值、进入 commit 阶段
	if (exitStatus === RootCompleted) {
		const finishedWork = root.current.alternate;
		root.finishedWork = finishedWork;
		root.finishedLane = nextLane;
		wipRootRenderLane = NoLane;

		// wip fiberNode树 树中的flags
		commitRoot(root);
	} else if (__DEV__) {
		console.error('还未实现的同步更新结束状态');
	}
}

// 1、在 workLoop 中进入 render、commit 阶段
// 2、返回 RootInComplete 或 RootCompleted 状态
function renderRoot(root: FiberRootNode, lane: Lane, shouldTimeSlice: boolean) {
	if (__DEV__) {
		// console.log(`开始${shouldTimeSlice ? '并发' : '同步'}更新`, root);
	}

	// 初始化 或 具有更高优先级任务的时候才会进入
	if (wipRootRenderLane !== lane) {
		// 初始化时执行
		prepareFreshStack(root, lane);
	}

	do {
		try {
			// workLoop：进入 render、commit 阶段
			shouldTimeSlice ? workLoopConcurrent() : workLoopSync();
			break;
		} catch (e) {
			if (__DEV__) {
				console.warn('workLoop发生错误', e);
			}
			workInProgress = null;
		}
	} while (true);

	// 中断执行
	if (shouldTimeSlice && workInProgress !== null) {
		return RootInComplete;
	}

	// render阶段执行完
	if (!shouldTimeSlice && workInProgress !== null && __DEV__) {
		console.error(`render阶段结束时wip不应该不是null`);
	}

	// TODO 报错
	return RootCompleted;
}

function commitRoot(root: FiberRootNode) {
	const finishedWork = root.finishedWork;

	if (finishedWork === null) {
		return;
	}

	if (__DEV__) {
		console.warn('commit阶段开始', finishedWork);
	}
	const lane = root.finishedLane;

	if (lane === NoLane && __DEV__) {
		console.error('commit阶段finishedLane不应该是NoLane');
	}

	// 重置
	root.finishedWork = null;
	root.finishedLane = NoLane;

	markRootFinished(root, lane);

	if (
		(finishedWork.flags & PassiveMask) !== NoFlags ||
		(finishedWork.subtreeFlags & PassiveMask) !== NoFlags
	) {
		if (!rootDoesHasPassiveEffects) {
			rootDoesHasPassiveEffects = true;
			// 调度副作用
			scheduleCallback(NormalPriority, () => {
				// 执行副作用
				flushPassiveEffects(root.pendingPassiveEffects);
				return;
			});
		}
	}

	// 判断是否存在3个子阶段需要执行的操作
	// root flags root subtreeFlags
	const subtreeHasEffect =
		(finishedWork.subtreeFlags & MutationMask) !== NoFlags;
	const rootHasEffect = (finishedWork.flags & MutationMask) !== NoFlags;

	if (subtreeHasEffect || rootHasEffect) {
		// beforeMutation
		// mutation Placement
		commitMutationEffects(finishedWork, root);

		root.current = finishedWork;

		// layout
	} else {
		root.current = finishedWork;
	}

	rootDoesHasPassiveEffects = false;
	ensureRootIsScheduled(root);
}

function flushPassiveEffects(pendingPassiveEffects: PendingPassiveEffects) {
	let didFlushPassiveEffect = false;
	pendingPassiveEffects.unmount.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListUnmount(Passive, effect);
	});
	pendingPassiveEffects.unmount = [];

	pendingPassiveEffects.update.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListDestroy(Passive | HookHasEffect, effect);
	});
	pendingPassiveEffects.update.forEach((effect) => {
		didFlushPassiveEffect = true;
		commitHookEffectListCreate(Passive | HookHasEffect, effect);
	});
	pendingPassiveEffects.update = [];
	flushSyncCallbacks();
	return didFlushPassiveEffect;
}

// 同步 Loop
function workLoopSync() {
	while (workInProgress !== null) {
		performUnitOfWork(workInProgress);
	}
}
// 批量异步 Loop
function workLoopConcurrent() {
	while (workInProgress !== null && !unstable_shouldYield()) {
		performUnitOfWork(workInProgress);
	}
}

// 进入 beginWork 阶段
function performUnitOfWork(fiber: FiberNode) {
	const next = beginWork(fiber, wipRootRenderLane);
	fiber.memoizedProps = fiber.pendingProps;

	if (next === null) {
		completeUnitOfWork(fiber);
	} else {
		workInProgress = next;
	}
}

// 进入 completeWork 阶段
function completeUnitOfWork(fiber: FiberNode) {
	let node: FiberNode | null = fiber;

	do {
		completeWork(node);
		const sibling = node.sibling;

		if (sibling !== null) {
			workInProgress = sibling;
			return;
		}
		node = node.return;
		workInProgress = node;
	} while (node !== null);
}
