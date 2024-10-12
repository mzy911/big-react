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

// scheduler：调度器中的五种优先级
// ImmediatePriority‌：高优先级，用于执行紧急且重要的任务。
// UserBlockingPriority‌：用户阻塞优先级，用于处理用户交互事件，如点击、滚动等。
// NormalPriority‌：正常优先级，用于执行非紧急且非用户阻塞的任务。
// LowPriority‌：低优先级，用于执行较低重要性的任务。
// IdlePriority‌：空闲优先级，用于在浏览器空闲时执行一些维护任务。
export const NoLane = 0b00000;
export const NoLanes = 0b00000;
export const SyncLane = 0b00001; // 同步优先级
export const InputContinuousLane = 0b00010; // 手动触发的优先级
export const DefaultLane = 0b00100; // 默认优先级
export const TransitionLane = 0b01000; // Transition 优先级
export const IdleLane = 0b10000; // 空闲优先级

// 获取两个 lane 的集合
export function mergeLanes(laneA: Lane, laneB: Lane): Lanes {
  return laneA | laneB;
}

/**
 *  创建 update 对象时，获取上下文环境中的优先级
 *  1、存在 transition 返回 TransitionLane
 *  2、
 *    2.1 从 unstable_getCurrentPriorityLevel 中获取 Scheduler 上下文的优先级
 *    2.2 调用 unstable_runWithPriority 方法，传入一个优先级（重置全局环境变量为传入的优先级）
 *    2.3 启动项目时、点击事件时执行 unstable_runWithPriority 方法
 *  3、将上下文环境 Scheduler 优先级转换为 lane
 */
export function requestUpdateLane() {
  const isTransition = ReactCurrentBatchConfig.transition !== null;
  if (isTransition) {
    return TransitionLane;
  }

  // 从上下文环境中获取 Scheduler 优先级
  const currentSchedulerPriority = unstable_getCurrentPriorityLevel();
  return schedulerPriorityToLane(currentSchedulerPriority);
}

// 获取优先级最高的 lane
export function getHighestPriorityLane(lanes: Lanes): Lane {
  return lanes & -lanes;
}

// lanes 中是否包含当前 lane
export function isSubsetOfLanes(set: Lanes, subset: Lane) {
  return (set & subset) === subset;
}

// 移除已经消费过的 lane
export function markRootFinished(root: FiberRootNode, lane: Lane) {
  root.pendingLanes &= ~lane;
  root.suspendedLanes = NoLanes;
  root.pingedLanes = NoLanes;
}

// lanes 转 SchedulerPriority
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

// SchedulerPriority 转 lanes
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

// ping 时 root 上标记 pingedLanes
export function markRootPinged(root: FiberRootNode, pingedLane: Lane) {
  root.pingedLanes |= root.suspendedLanes & pingedLane;
}

// RootDidNotComplete：使用了 use 但是没有使用 Suspense 包裹
export function markRootSuspended(root: FiberRootNode, suspendedLane: Lane) {
  root.suspendedLanes |= suspendedLane;
  root.pingedLanes &= ~suspendedLane;
}

// 获取优先级最高的 lane（排除被挂起的lane）
export function getNextLane(root: FiberRootNode): Lane {
  const pendingLanes = root.pendingLanes;

  // root 上无 lanes 直接返回 NoLane
  if (pendingLanes === NoLanes) {
    return NoLane;
  }
  let nextLane = NoLane;

  // pendingLanes 中去掉 suspendedLanes
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
