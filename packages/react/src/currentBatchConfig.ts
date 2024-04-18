interface BatchConfig {
  transition: number | null;
}

// 用来跟踪当前批的配置
const ReactCurrentBatchConfig: BatchConfig = {
  transition: null
};

export default ReactCurrentBatchConfig;
