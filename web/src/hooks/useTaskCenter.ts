import { useState, useEffect, useCallback, useRef } from 'react';
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
  const tasksRef = useRef<Task[]>(tasks);

  // 始终保持 Ref 与 State 同步，用于在不触发依赖循环的情况下进行逻辑对比
  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const updateTask = useCallback((updatedTask: Task, skipNotify = false) => {
    const currentTasks = tasksRef.current;
    const oldTask = currentTasks.find(t => t.id === updatedTask.id);
    let isNew = !oldTask;
    let handoverPendingTask: Task | undefined;

    // --- 逻辑：检测是否为乐观任务的“接力” ---
    if (isNew && !updatedTask.id.startsWith('pending-')) {
      handoverPendingTask = currentTasks.find(t => 
        t.id.startsWith('pending-') && 
        t.module === updatedTask.module && 
        t.target === updatedTask.target &&
        t.action === updatedTask.action
      );
      if (handoverPendingTask) {
        isNew = false; // 视为已有任务的演变，不触发“新任务”通知
      }
    }

    const notifyConfig = { placement: 'bottomRight' as const, duration: 4.5 };

    // --- 逻辑：决定是否需要弹窗 ---
    if (!skipNotify) {
      if (isNew) {
      // 只有真正的全新任务才弹出一个“已开始”通知
      if (updatedTask.status === 'Running') {
        notification.info({ ...notifyConfig, message: updatedTask.name, description: t('common.waitingGateway') });
      } else if (updatedTask.status === 'Completed') {
        notification.success({ ...notifyConfig, message: updatedTask.name, description: t('common.success') });
      } else if (updatedTask.status === 'Failed' || updatedTask.status === 'Timeout') {
        notification.error({ ...notifyConfig, message: updatedTask.name, description: `${t('common.error')}: ${updatedTask.error || 'Unknown Error'}` });
      }
    } else {
      // 对于已有任务（或接力任务），只有状态发生实质改变时才弹窗
      const effectiveOldTask = oldTask || handoverPendingTask;
      if (effectiveOldTask && effectiveOldTask.status !== updatedTask.status) {
        if (updatedTask.status === 'Completed') {
          notification.success({ ...notifyConfig, message: updatedTask.name, description: t('common.success') });
        } else if (updatedTask.status === 'Failed' || updatedTask.status === 'Timeout') {
          notification.error({ ...notifyConfig, message: updatedTask.name, description: `${t('common.error')}: ${updatedTask.error || 'Unknown Error'}` });
        }
      }
    }
  }

    setTasks(prev => {
      const index = prev.findIndex(t => t.id === updatedTask.id);
      const isNewInner = index === -1;

      // --- 核心更新：执行接力替换 ---
      if (isNewInner && !updatedTask.id.startsWith('pending-')) {
        const pendingIndex = prev.findIndex(t => 
          t.id.startsWith('pending-') && 
          t.module === updatedTask.module && 
          t.target === updatedTask.target &&
          t.action === updatedTask.action
        );
        if (pendingIndex > -1) {
          const pendingTask = prev[pendingIndex];
          const newTasks = [...prev];
          // 接力时：优先保持前端已翻译的名称（并去掉“加载中”后缀），防止后端直出的英文名称造成文字跳变
          const cleanedName = pendingTask.name.split(' (')[0];
          const mergedTask = { ...updatedTask, name: cleanedName || updatedTask.name };
          newTasks.splice(pendingIndex, 1, mergedTask);
          return newTasks;
        }
      }

      if (isNewInner) return [updatedTask, ...prev];
      const newTasks = [...prev];
      newTasks[index] = updatedTask;
      return newTasks;
    });
  }, [t]); // 移除 tasks 依赖，解除无限循环

  const fetchActiveTasks = useCallback(async (isSilent = false, skipNotify = false) => {
    if (!isSilent) setLoading(true);
    try {
      const res = await api.get('/v1/tasks/status');
      const latestTasks = res.data.data || res.data || [];
      latestTasks.forEach((task: Task) => updateTask(task, skipNotify));
    } catch (err) {
      console.error('Failed to fetch tasks:', err);
    } finally {
      if (!isSilent) setLoading(false);
    }
  }, [updateTask]);

  useEffect(() => {
    fetchActiveTasks(false, true); // 首次加载静默同步，不弹窗
  }, [fetchActiveTasks]);

  return { tasks, loading, fetchActiveTasks, updateTask };
};
