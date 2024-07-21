import {
  unstable_getCurrentPriorityLevel,
  unstable_IdlePriority,
  unstable_ImmediatePriority,
  unstable_NormalPriority,
  unstable_UserBlockingPriority
} from 'scheduler';
import { FiberRootNode } from './fiber';

export type Lane = number;
export type Lanes = number;

// 数值越低优先级越高
export const NoLane = 0b0000;
export const NoLanes = 0b0000;
export const SyncLane = 0b0001; // 同步优先级
export const InputContinuousLane = 0b0010; // 输入优先级
export const DefaultLane = 0b0100; // 默认优先级
export const IdleLane = 0b1000; // 空闲优先级

export function mergeLanes(laneA: Lane, laneB: Lane): Lanes {
  return laneA | laneB;
}

// 获取优先级
// 1、包含两种优先级 Scheduler、lane
//    Scheduler： 是与 react 结偶的第三方包，有自己的优先级
//    lane：react 采用 lane 模型，属于自己的优先级
// 2、调度过程中，需要进行 Scheduler、lane 两种优先级转换
export function requestUpdateLane() {
  // 1、获取 Scheduler 中全局上下文的优先级（自定义事件可以影响到事件优先级）
  const currentSchedulerPriority = unstable_getCurrentPriorityLevel();

  // 2、将 schedule(调度器) 的优先级转为 react(lane) 的优先级
  const lane = schedulerPriorityToLane(currentSchedulerPriority);
  return lane;
}

export function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes;
}

export function isSubsetOfLanes(set: Lanes, subset: Lane) {
  return (set & subset) === subset;
}

export function markRootFinished(root: FiberRootNode, lane: Lane) {
  root.pendingLanes &= ~lane;
}

// 将 react(lane) 的优先级转为 schedule(调度器) 的优先级
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

// 将 schedule(调度器) 的优先级转为 react(lane) 的优先级
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
