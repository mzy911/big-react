// React.memo(function App() {/** ... */})

import { FiberNode } from 'react-reconciler/src/fiber';
import { REACT_MEMO_TYPE } from 'shared/ReactSymbols';
import { Props } from 'shared/ReactTypes';

// React.memo：包裹组件、优化之组件不比较渲染
export function memo(
  type: FiberNode['type'],
  compare?: (oldProps: Props, newProps: Props) => boolean
) {
  const fiberType = {
    $$typeof: REACT_MEMO_TYPE,
    type,
    compare: compare === undefined ? null : compare
  };

  // memo fiber.type.type
  return fiberType;
}
