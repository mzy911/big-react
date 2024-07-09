import {
	unstable_ImmediatePriority as ImmediatePriority,
	unstable_UserBlockingPriority as UserBlockingPriority,
	unstable_NormalPriority as NormalPriority,
	unstable_LowPriority as LowPriority,
	unstable_IdlePriority as IdlePriority,
	unstable_scheduleCallback as scheduleCallback,
	unstable_shouldYield as shouldYield,
	CallbackNode,
	unstable_getFirstCallbackNode as getFirstCallbackNode,
	unstable_cancelCallback as cancelCallback
} from 'scheduler';

import './style.css';
const button = document.querySelector('button');
const root = document.querySelector('#root');

// 依据事件类型定义不同的优先级
// 数字越小优先级越高
type Priority =
	| typeof LowPriority // 5
	| typeof IdlePriority // 4
	| typeof NormalPriority // 3
	| typeof UserBlockingPriority // 2
	| typeof ImmediatePriority; // 1

interface Work {
	count: number; // 当前 work render 的次数
	priority: Priority;
}

// 类似任务队列
const workList: Work[] = [];
let prevPriority: Priority = IdlePriority;
let curCallback: CallbackNode | null = null;

[LowPriority, NormalPriority, UserBlockingPriority, ImmediatePriority].forEach(
	(priority) => {
		const btn = document.createElement('button');
		root?.appendChild(btn);
		btn.innerText = [
			'',
			'ImmediatePriority',
			'UserBlockingPriority',
			'NormalPriority',
			'LowPriority'
		][priority];
		btn.onclick = () => {
			// 每个不能的任务 render 100次
			workList.unshift({
				count: 100,
				priority: priority as Priority
			});
			schedule();
		};
	}
);

// 调度任务
function schedule() {
	// 获取当前正在执行的 work
	const cbNode = getFirstCallbackNode();

	// 获取优先级最高的任务（对应数字最小）
	const curWork = workList.sort((w1, w2) => w1.priority - w2.priority)[0];

	// 策略逻辑
	if (!curWork) {
		curCallback = null;
		cbNode && cancelCallback(cbNode);
		return;
	}

	// 工作过程中产生相同优先级的 work 不需要开启新的调度
	const { priority: curPriority } = curWork;
	if (curPriority === prevPriority) {
		return;
	}

	// 走到此处：说明有更高优先级的 work
	// 1、取消当前正在执行的 work
	// 2、继续调度更高优先级的 work
	cbNode && cancelCallback(cbNode);

	// 调度函数的结果还是一个函数（整个流程本身就是递归调度 schedule）
	// 1、使用 scheduleCallback 进行调用
	// 2、工作中仅有一个work的优化策略
	//   调度函数 perform 返回一个函数，则会继续调度返回的函数
	curCallback = scheduleCallback(curPriority, perform.bind(null, curWork));
}

// didTimeout：是否过期了，产生了饥饿问题
function perform(work: Work, didTimeout?: boolean) {
	const needSync = work.priority === ImmediatePriority || didTimeout;

	// 此处为真正执行红任务的地方
	/**
	 * 1. work.priority：同步任务
	 * 2. 饥饿问题
	 * 3. 时间切片
	 */
	while ((needSync || !shouldYield()) && work.count) {
		work.count--;
		insertSpan(work.priority + '');
	}

	// *** 走到此处：中断执行 || 执行完成

	// 保存当前任务的优先级
	prevPriority = work.priority;

	// 当前 work 的任务执行完成，从 workList 中移除当前的 work
	if (!work.count) {
		const workIndex = workList.indexOf(work);
		workList.splice(workIndex, 1);
		// 重置优先级
		prevPriority = IdlePriority;
	}

	const prevCallback = curCallback;
	// 继续调度：schedule 内部有判断 curPriority === prevPriority
	schedule();
	const newCallback = curCallback;

	if (newCallback && prevCallback === newCallback) {
		// 向外返回一个函数
		return perform.bind(null, work);
	}
}

function insertSpan(content) {
	const span = document.createElement('span');
	span.innerText = content;
	span.className = `pri-${content}`;
	doSomeBuzyWork(10000000);
	root?.appendChild(span);
}

function doSomeBuzyWork(len: number) {
	let result = 0;
	while (len--) {
		result += len;
	}
}
