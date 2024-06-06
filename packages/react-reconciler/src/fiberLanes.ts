import { FiberRootNode } from './fiber';

export type Lane = number;
export type Lanes = number;

export const SyncLane = 0b0001;
export const NoLane = 0b0000;
export const NoLanes = 0b0000;

// 合并 lane
export function mergeLanes(laneA: Lane, laneB: Lane): Lanes {
	return laneA | laneB;
}

// 根据不同的触发场景，返回不同的优先级（此时只有一种，可扩展）
// 1、app render() 时调用
// 2、dispatch 处调用
export function requestUpdateLane() {
	return SyncLane;
}

// 获取优先级最高的 lane
export function getHighestPriorityLane(lanes: Lanes): Lane {
	return lanes & -lanes;
}

// 去掉 lane
export function markRootFinished(root: FiberRootNode, lane: Lane) {
	root.pendingLanes &= ~lane;
}
