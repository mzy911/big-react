import { useState } from 'react';
import { Dispatch } from 'react/src/currentDispatcher';
import { Dispatcher } from 'react/src/currentDispatcher';
import internals from 'shared/internals';
import { Action } from 'shared/ReactTypes';
import { FiberNode } from './fiber';
import { Flags, PassiveEffect } from './fiberFlags';
import { Lane, NoLane, requestUpdateLane } from './fiberLanes';
import { HookHasEffect, Passive } from './hookEffectTags';
import {
	createUpdate,
	createUpdateQueue,
	enqueueUpdate,
	processUpdateQueue,
	Update,
	UpdateQueue
} from './updateQueue';
import { scheduleUpdateOnFiber } from './workLoop';

// 当前函数组件的 Fiber
let currentlyRenderingFiber: FiberNode | null = null;
// 当前正在执行的 hook
let workInProgressHook: Hook | null = null;
// 更新时当前正在执行的 nextCurrentHook
let currentHook: Hook | null = null;
let renderLane: Lane = NoLane;

const { currentDispatcher } = internals;
interface Hook {
	memoizedState: any; // 1、useState：返回计算后的值 // 2、useEffect：存储 effect 的链表
	updateQueue: unknown; // 存储 useSate 的 update 链表
	next: Hook | null;
	baseState: any; // 最后一个没有被跳过的计算结果
	baseQueue: Update<any> | null; // 存储跳过及后续的 update
}

export interface Effect {
	tag: Flags;
	create: EffectCallback | void;
	destroy: EffectCallback | void;
	deps: EffectDeps;
	next: Effect | null;
}

// 函数组建 update 队列、扩展 lastEffect 属性
export interface FCUpdateQueue<State> extends UpdateQueue<State> {
	lastEffect: Effect | null;
}

type EffectCallback = () => void;
type EffectDeps = any[] | null;

export function renderWithHooks(wip: FiberNode, lane: Lane) {
	// 赋值操作
	currentlyRenderingFiber = wip;
	// 重置 hooks链表
	wip.memoizedState = null;
	// 重置 effect链表
	wip.updateQueue = null;
	renderLane = lane;

	const current = wip.alternate;

	if (current !== null) {
		// update
		currentDispatcher.current = HooksDispatcherOnUpdate;
	} else {
		// mount
		currentDispatcher.current = HooksDispatcherOnMount;
	}

	const Component = wip.type;
	const props = wip.pendingProps;
	// FC render
	const children = Component(props);

	// 重置操作
	currentlyRenderingFiber = null;
	workInProgressHook = null;
	currentHook = null;
	renderLane = NoLane;
	return children;
}

const HooksDispatcherOnMount: Dispatcher = {
	useState: mountState,
	useEffect: mountEffect
};

const HooksDispatcherOnUpdate: Dispatcher = {
	useState: updateState,
	useEffect: updateEffect
};

function mountState<State>(
	initialState: (() => State) | State
): [State, Dispatch<State>] {
	// 一个 useState 产生一个 hook 最后形成 hoos 链表
	const hook = mountWorkInProgresHook();

	// 获取初始值
	let memoizedState;
	if (initialState instanceof Function) {
		memoizedState = initialState();
	} else {
		memoizedState = initialState;
	}
	hook.memoizedState = memoizedState;

	// 创建 update 链表，保存在 hook.updateQueue 上
	const queue = createUpdateQueue<State>();
	hook.updateQueue = queue;

	// @ts-ignore
	const dispatch = dispatchSetState.bind(null, currentlyRenderingFiber, queue);
	queue.dispatch = dispatch;
	return [memoizedState, dispatch];
}

function updateState<State>(): [State, Dispatch<State>] {
	// 找到当前useState对应的hook数据
	const hook = updateWorkInProgresHook();

	// 计算新 state 的逻辑
	const queue = hook.updateQueue as UpdateQueue<State>;
	const baseState = hook.baseState;

	const pending = queue.shared.pending;
	const current = currentHook as Hook;
	let baseQueue = current.baseQueue;

	if (pending !== null) {
		// baseQueue 由于优先级较低跳过或以后的update
		if (baseQueue !== null) {
			// baseQueue b2 -> b0 -> b1 -> b2
			// pendingQueue p2 -> p0 -> p1 -> p2
			// b0
			const baseFirst = baseQueue.next;
			// p0
			const pendingFirst = pending.next;
			// b2 -> p0
			baseQueue.next = pendingFirst;
			// p2 -> b0
			pending.next = baseFirst;
			// p2 -> b0 -> b1 -> b2 -> p0 -> p1 -> p2
		}
		baseQueue = pending;

		// 保存在current中
		current.baseQueue = pending;
		queue.shared.pending = null;

		if (baseQueue !== null) {
			// 消费 update
			const {
				memoizedState,
				baseQueue: newBaseQueue,
				baseState: newBaseState
			} = processUpdateQueue(baseState, baseQueue, renderLane);

			hook.memoizedState = memoizedState;
			hook.baseState = newBaseState;
			hook.baseQueue = newBaseQueue;
		}
	}

	return [hook.memoizedState, queue.dispatch as Dispatch<State>];
}

function mountEffect(create: EffectCallback | void, deps: EffectDeps | void) {
	// 一个 useEffect 产生一个 hook
	const hook = mountWorkInProgresHook();
	const nextDeps = deps === undefined ? null : deps;
	(currentlyRenderingFiber as FiberNode).flags |= PassiveEffect;

	hook.memoizedState = pushEffect(
		Passive | HookHasEffect,
		create,
		undefined,
		nextDeps
	);
}

function updateEffect(create: EffectCallback | void, deps: EffectDeps | void) {
	// workInProgressHook
	const hook = updateWorkInProgresHook();
	const nextDeps = deps === undefined ? null : deps;
	let destroy: EffectCallback | void;

	if (currentHook !== null) {
		const prevEffect = currentHook.memoizedState as Effect;
		destroy = prevEffect.destroy;

		// 有依赖的时候，依赖变化才会
		if (nextDeps !== null) {
			// 浅比较依赖
			const prevDeps = prevEffect.deps;
			if (areHookInputsEqual(nextDeps, prevDeps)) {
				hook.memoizedState = pushEffect(Passive, create, destroy, nextDeps);
				return;
			}
		}

		// 浅比较、不相等
		(currentlyRenderingFiber as FiberNode).flags |= PassiveEffect;
		hook.memoizedState = pushEffect(
			Passive | HookHasEffect,
			create,
			destroy,
			nextDeps
		);
	}
}

// Deps 浅比较
function areHookInputsEqual(nextDeps: EffectDeps, prevDeps: EffectDeps) {
	if (prevDeps === null || nextDeps === null) {
		return false;
	}
	for (let i = 0; i < prevDeps.length && i < nextDeps.length; i++) {
		if (Object.is(prevDeps[i], nextDeps[i])) {
			continue;
		}
		return false;
	}
	return true;
}

// 生成 effect 的环状链表
function pushEffect(
	hookFlags: Flags,
	create: EffectCallback | void,
	destroy: EffectCallback | void,
	deps: EffectDeps
): Effect {
	const effect: Effect = {
		tag: hookFlags,
		create,
		destroy,
		deps,
		next: null
	};
	const fiber = currentlyRenderingFiber as FiberNode;
	const updateQueue = fiber.updateQueue as FCUpdateQueue<any>;
	if (updateQueue === null) {
		// 创建函数组件 useEffct 的 update 队列
		const updateQueue = createFCUpdateQueue();
		// 绑定到 fiber 上
		fiber.updateQueue = updateQueue;
		// 形成环状链表
		effect.next = effect;
		// 记录 lastEffect
		updateQueue.lastEffect = effect;
	} else {
		// 插入effect
		const lastEffect = updateQueue.lastEffect;
		if (lastEffect === null) {
			effect.next = effect;
			updateQueue.lastEffect = effect;
		} else {
			const firstEffect = lastEffect.next;
			lastEffect.next = effect;
			effect.next = firstEffect;
			updateQueue.lastEffect = effect;
		}
	}
	return effect;
}

function createFCUpdateQueue<State>() {
	const updateQueue = createUpdateQueue<State>() as FCUpdateQueue<State>;
	updateQueue.lastEffect = null;
	return updateQueue;
}

// 设置 state 的值，开始调度
function dispatchSetState<State>(
	fiber: FiberNode,
	updateQueue: UpdateQueue<State>,
	action: Action<State>
) {
	// 获取优先级
	const lane = requestUpdateLane();
	// 根据 action 创建 update 对象
	const update = createUpdate(action, lane);
	enqueueUpdate(updateQueue, update);

	// 开始调度
	scheduleUpdateOnFiber(fiber, lane);
}

// useState、useEffect mount 时执行
// 1、生成 Hook 对象
// 2、形成 hooks 链表（workInProgressHook）
// 3、将 workInProgressHook 挂载到 currentlyRenderingFiber.memoizedState 上
function mountWorkInProgresHook(): Hook {
	const hook: Hook = {
		memoizedState: null, // 1、useState：返回计算后的值 // 2、useEffect：存储 effect 的链表
		updateQueue: null, // 存储 useSate 的 update 链表
		next: null,
		baseQueue: null, // 存储跳过及后续的 update
		baseState: null // 最后一个没有被跳过的计算结果
	};
	if (workInProgressHook === null) {
		// mount时 第一个hook
		if (currentlyRenderingFiber === null) {
			throw new Error('请在函数组件内调用hook');
		} else {
			workInProgressHook = hook;
			// 函数组件 hooks(useState、useEffect) 链表
			currentlyRenderingFiber.memoizedState = workInProgressHook;
		}
	} else {
		// mount时 后续的hook
		workInProgressHook.next = hook;
		workInProgressHook = hook;
	}
	return workInProgressHook;
}

// useState、useEffect update 时执行
// 1、获取下一个要执行的 hook、赋值中间变量 currentHook
// 2、根据旧的 hook 创建新的 Hook
// 3、重新赋值 workInProgressHook 或 currentlyRenderingFiber.memoizedState
function updateWorkInProgresHook(): Hook {
	// TODO render阶段触发的更新
	let nextCurrentHook: Hook | null;

	if (currentHook === null) {
		// 这是这个FC update时的第一个hook
		const current = currentlyRenderingFiber?.alternate;
		if (current !== null) {
			nextCurrentHook = current?.memoizedState;
		} else {
			// mount
			nextCurrentHook = null;
		}
	} else {
		// 这个FC update时 后续的hook
		nextCurrentHook = currentHook.next;
	}

	if (nextCurrentHook === null) {
		// mount/update u1 u2 u3
		// update       u1 u2 u3 u4
		throw new Error(
			`组件${currentlyRenderingFiber?.type}本次执行时的Hook比上次执行时多`
		);
	}

	currentHook = nextCurrentHook as Hook;
	const newHook: Hook = {
		memoizedState: currentHook.memoizedState,
		updateQueue: currentHook.updateQueue,
		next: null,
		baseQueue: currentHook.baseQueue,
		baseState: currentHook.baseState
	};

	if (workInProgressHook === null) {
		// mount时 第一个hook
		if (currentlyRenderingFiber === null) {
			throw new Error('请在函数组件内调用hook');
		} else {
			workInProgressHook = newHook;
			// 函数组件记录 hooks(useState、useEffect) 链表
			currentlyRenderingFiber.memoizedState = workInProgressHook;
		}
	} else {
		// mount时 后续的hook
		workInProgressHook.next = newHook;
		workInProgressHook = newHook;
	}
	return workInProgressHook;
}
