import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { notification } from 'antd';
import { useTranslation } from 'react-i18next';

export interface Task {
  id: string;
  name: string;
  module: string;
  action: string;
  target: string;
  status: 'Running' | 'Completed' | 'Failed' | 'Timeout' | 'Interrupted';
  progress: number;
  error?: string;
  result?: string;
  startTime: string;
  endTime?: string;
}

export const useTaskCenter = () => {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchActiveTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/v1/tasks/status');
      setTasks(res.data.data || res.data || []);
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateTask = useCallback((updatedTask: Task) => {
    setTasks(prev => {
      const index = prev.findIndex(t => t.id === updatedTask.id);
      const isNew = index === -1;
      const oldTask = isNew ? null : prev[index];

      // 集中处理通知反馈 (卡片式通知)
      const notifyConfig = {
        placement: 'bottomRight' as const,
        duration: 4.5,
      };

      // 1. 如果是新任务
      if (isNew) {
        if (updatedTask.status === 'Running') {
          notification.info({
            ...notifyConfig,
            message: updatedTask.name,
            description: t('common.waitingGateway'), // 指令已确认，正在等待反馈...
          });
        } else if (updatedTask.status === 'Completed') {
          notification.success({
            ...notifyConfig,
            message: updatedTask.name,
            description: t('common.success'),
          });
        } else if (updatedTask.status === 'Failed' || updatedTask.status === 'Timeout') {
          notification.error({
            ...notifyConfig,
            message: updatedTask.name,
            description: `${t('common.error')}: ${updatedTask.error || 'Unknown Error'}`,
          });
        }
      } 
      // 2. 如果是已知任务的状态变更
      else if (oldTask && oldTask.status !== updatedTask.status) {
        if (updatedTask.status === 'Completed') {
          notification.success({
            ...notifyConfig,
            message: updatedTask.name,
            description: t('common.success'),
          });
        } else if (updatedTask.status === 'Failed' || updatedTask.status === 'Timeout') {
          notification.error({
            ...notifyConfig,
            message: updatedTask.name,
            description: `${t('common.error')}: ${updatedTask.error || 'Unknown Error'}`,
          });
        }
      }

      // 更新状态列表
      if (isNew) {
        return [updatedTask, ...prev];
      }
      const newTasks = [...prev];
      newTasks[index] = updatedTask;
      return newTasks;
    });
  }, [t]);

  useEffect(() => {
    fetchActiveTasks();
  }, [fetchActiveTasks]);

  return { tasks, loading, fetchActiveTasks, updateTask };
};
