import React, { useState, useEffect, useMemo, forwardRef, useImperativeHandle, Ref } from 'react';
import intl from ':common/intl';
import { cloneDeep } from 'lodash';
import uuid from 'uuid';

import Checkbox from ':common/rc/checkbox/x-checkbox';
import Icon from ':common/rc/icon-to-merge/x-icon';
import Input from ':common/rc/input/x-input';
import Button from ':common/rc/button/x-button';

import useDebouncedCallback from ':common/hooks/useDebouncedCallback';
import { FIELD_NAME, ICachePathItem, STRATEGIES } from '../../_common';
import './index.scss';

export interface IAcceleratorRef {
  changeCacheStrategies: () => void;
  checkError: () => boolean;
}

// 获取数组中重复的key元素
const getRepeatItem = (data: string[]): string[] => {
  const statisticsNum: {[prop: string]: number;} = {};
  const res: string[] = [];

  data.forEach(item => {
    if (statisticsNum[item]){
      statisticsNum[item] += 1;
    } else {
      statisticsNum[item] = 1;
    }
  });
  Object.entries(statisticsNum).forEach(([key, val]) => {
    if (val > 1){
      res.push(key);
    }
  });

  return res;
};

interface IProps {
  field: any;
  onChange: (props: ICachePathItem[]) => void;
  value: ICachePathItem[];
}

const Accelerator = ({ field, onChange, value }: IProps, ref: Ref<IAcceleratorRef | undefined>) => {
  const [paths, setPaths] = useState<ICachePathItem[]>([]);
  const [wholePaths, setWholePaths] = useState<ICachePathItem>({ name: '', cachePolicy: false });
  const [resetCachePaths, setResetCachePaths] = useState('');
  const repeatData = useMemo(() => {
    return getRepeatItem(paths.map(item => item.name).filter(Boolean));
  }, [paths]);

  // 判断是否为自定义加速路径
  const isCustom = field.getValue(FIELD_NAME.ACCELERATOR_STRATEGIES) === STRATEGIES.ATTACH_PATH;

  // 向父组件暴露事件
  useImperativeHandle(ref, () => ({

    // 更改加速策略时触发
    changeCacheStrategies: () => {
      setResetCachePaths(`${Date.now()}`);
    },

    // 加速路径、规则检验失败时触发
    checkError: () => {
      if (isCustom){
        return !paths?.[0] || paths.some(item => {
          return !item.name || item.name.startsWith('/') || item.name.startsWith('\\') || repeatData.includes(item.name);
        });
      }

      return false;
    }
  }));

  // 更改 path、checkbox 时触发
  const changeValue = (data: ICachePathItem[], type: string, id: string) => (val: string | boolean) => {
    const newData = cloneDeep(data);

    setPaths(newData.map(item => {
      if (item.id === id) {
        if (type === 'input') {
          item.name = val as string;
        }

        if (type === 'checkbox') {
          item.cachePolicy = val as boolean;
        }
      }

      return item;
    }));
    setResetCachePaths(`${Date.now()}`);
  };

  // 删除当前条 path 时触发
  const del = (id: string) => () => {
    const newPaths = cloneDeep(paths);

    setPaths(newPaths.filter(item => {
      if (item.id === id){
        return false;
      }

      return true;
    }));
    setResetCachePaths(`${Date.now()}`);
  };

  // 更改加速策略、重新赋值加速路径
  useDebouncedCallback(() => {
    if (resetCachePaths){
      if (isCustom){
        onChange(paths);
      } else {
        onChange([wholePaths]);
      }
    }
  }, 600, [resetCachePaths]);

  useEffect(() => {
    if (isCustom){
      field.setValue(FIELD_NAME.ACCELERATOR_PATHS, paths);
    } else {
      field.setValue(FIELD_NAME.ACCELERATOR_PATHS_ALL, wholePaths);
    }
  }, [paths, wholePaths, isCustom]);

  useEffect(() => {
    // 初始化加速策略
    setPaths(isCustom
      ? value.map(item => {
        item.id = uuid.v4();

        return item;
      })
      : field.getValue(FIELD_NAME.ACCELERATOR_PATHS) || []);

    setWholePaths(!isCustom
      ? value[0]
      : field.getValue(FIELD_NAME.ACCELERATOR_PATHS_ALL) || { name: field.getValue(FIELD_NAME.ACCELERATOR_PATHS) });
  }, []);

  return <div className="accelerator-strategies">
    {
      isCustom
        ? paths.map(item => {
          return <div key={item.id}>
            <div className="strategies-item" >
              <Input className="strategies-item-input" {...{
                value: item.name,
                onChange: changeValue(paths, 'input', item.id as string),
                state: repeatData.includes(item.name) || item.name.startsWith('/') || item.name.startsWith('\\') ? 'error' : null
              }} />
              <Checkbox className="strategies-item-checkbox" {...{
                label: intl('cache_accelerator.sync.warm_up'),
                checked: item.cachePolicy,
                onChange: changeValue(paths, 'checkbox', item.id as string)
              }} />
              <Button {...{
                spm: 'delete',
                label: <Icon className="strategies-item-icon" type="delete" />,
                text: true,
                onClick: del(item.id as string),
                style: {
                  width: 'auto',
                  height: '28px'
                }
              }} />
            </div>
            {/* 错误提示 */}
            <div className="error">
              {
                item.name.startsWith('/') || item.name.startsWith('\\')
                  ? intl('file.message.validation_end_slash!html')
                  : repeatData.includes(item.name)
                    ? intl('cache-accelerator.message.same_paths_error{path}', { path: item.name })
                    : ''
              }
            </div>
          </div>;
        })
        : <div className="strategies-item" >
          <Input className="strategies-item-input" {...{
            value: wholePaths.name,
            disabled: true
          }} />
          <Checkbox className="strategies-item-checkbox" {...{
            label: intl('cache_accelerator.sync.warm_up'),
            checked: wholePaths.cachePolicy,
            onChange: val => {
              setWholePaths({
                ...wholePaths,
                cachePolicy: val
              });
              setResetCachePaths(`${Date.now()}`);
            }
          }} />
        </div>
    }
    {
      isCustom
        ? <Button {...{
          label: <div><Icon type="add" /> {intl('accelerator.add.appoint.path')} {paths.length}/10 </div>,
          spm: 'accelerator.add.appoint.path',
          type: 'normal',
          text: true,
          disabled: paths.some(item => !item.name) || paths.length > 9,
          onClick: () => {
            setPaths([
              ...paths,
              {
                name: '',
                cachePolicy: false,
                id: uuid.v4()
              }
            ]);
            setResetCachePaths(`${Date.now()}`);
          }
        }} />
        : null
    }
  </div>;
};

export default forwardRef(Accelerator);
