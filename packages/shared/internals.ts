import * as React from 'react';

// 内部数据共享层：Reconciler中调用Hooks <===>  内部数据共享  <===> React
// 1、属性一 currentDispatcher：当前正在执行的线程的 Dispatcher
// 2、属性二 currentBatchConfig ：用来跟踪当前批的配置
const internals = React.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;

export default internals;
