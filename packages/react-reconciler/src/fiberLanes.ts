import ReactCurrentBatchConfig from 'react/src/currentBatchConfig';
import {
  unstable_getCurrentPriorityLevel,
  unstable_IdlePriority,
  unstable_ImmediatePriority,
  unstable_NormalPriority,
  unstable_UserBlockingPriority
} from 'scheduler';
import { FiberRootNode } from './fiber';

// 二进制位，代表 update 的优先级
export type Lane = number;
// 二进制位，代表 lane 的集合
export type Lanes = number;

export const SyncLane = 0b00001; // 同步
export const NoLane = 0b00000; // 异步
export const NoLanes = 0b00000; // 没有优先级
export const InputContinuousLane = 0b00010;
export const DefaultLane = 0b00100;
export const TransitionLane = 0b01000;
export const IdleLane = 0b10000;

// 获取两个 lane 的集合
export function mergeLanes(laneA: Lane, laneB: Lane): Lanes {
  return laneA | laneB;
}

// 拿到 update 中的 lane(优先级)
export function requestUpdateLane() {
  const isTransition = ReactCurrentBatchConfig.transition !== null;
  if (isTransition) {
    return TransitionLane;
  }

  // 从上下文环境中获取Scheduler优先级
  const currentSchedulerPriority = unstable_getCurrentPriorityLevel();
  const lane = schedulerPriorityToLane(currentSchedulerPriority);
  return lane;
}

// 获取优先级最高的 lane
export function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes;
}

export function isSubsetOfLanes(set: Lanes, subset: Lane) {
  return (set & subset) === subset;
}

// pendingLanes 中移除，已经消费过的 lane
export function markRootFinished(root: FiberRootNode, lane: Lane) {
  root.pendingLanes &= ~lane;

  root.suspendedLanes = NoLanes;
  root.pingedLanes = NoLanes;
}

export function lanesToSchedulerPriority(lanes: Lanes) {
  const lane = getHighestPriorityLane(lanes);

  if (lane === SyncLane) {
    return unstable_ImmediatePriority;
  }
  if (lane === InputContinuousLane) {
    return unstable_UserBlockingPriority;
  }
  if (lane === DefaultLane) {
    return unstable_NormalPriority;
  }
  return unstable_IdlePriority;
}

export function schedulerPriorityToLane(schedulerPriority: number): Lane {
  if (schedulerPriority === unstable_ImmediatePriority) {
    return SyncLane;
  }
  if (schedulerPriority === unstable_UserBlockingPriority) {
    return InputContinuousLane;
  }
  if (schedulerPriority === unstable_NormalPriority) {
    return DefaultLane;
  }
  return NoLane;
}

export function markRootPinged(root: FiberRootNode, pingedLane: Lane) {
  root.pingedLanes |= root.suspendedLanes & pingedLane;
}

export function markRootSuspended(root: FiberRootNode, suspendedLane: Lane) {
  root.suspendedLanes |= suspendedLane;
  root.pingedLanes &= ~suspendedLane;
}

// 获取下一个有效的、优先级最高的 lane
export function getNextLane(root: FiberRootNode): Lane {
  const pendingLanes = root.pendingLanes;

  if (pendingLanes === NoLanes) {
    return NoLane;
  }
  let nextLane = NoLane;

  // 去掉挂起的lane
  const suspendedLanes = pendingLanes & ~root.suspendedLanes;
  if (suspendedLanes !== NoLanes) {
    nextLane = getHighestPriorityLane(suspendedLanes);
  } else {
    const pingedLanes = pendingLanes & root.pingedLanes;
    if (pingedLanes !== NoLanes) {
      nextLane = getHighestPriorityLane(pingedLanes);
    }
  }

  return nextLane;
}

export function includeSomeLanes(set: Lanes, subset: Lane | Lanes): boolean {
  return (set & subset) !== NoLanes;
}

export function removeLanes(set: Lanes, subet: Lanes | Lane): Lanes {
  return set & ~subet;
}
