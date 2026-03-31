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

    const translateTaskName = (name: string) => {
      if (!name) return '';
      if (name.startsWith('tasks.')) {
        const parts = name.split(':');
        const key = parts[0];
        const id = parts.slice(1).join(':');
        return t(key, { id, name: id });
      }
      return name;
    };

    const taskDisplayName = translateTaskName(updatedTask.name);

    const notifyConfig = { placement: 'bottomRight' as const, duration: 4.5 };

    // --- 逻辑：决定是否需要弹窗 ---
    if (!skipNotify) {
      if (isNew) {
        // 只有真正的全新任务才弹出一个“已开始”通知
        if (updatedTask.status === 'Running') {
          notification.info({ ...notifyConfig, message: taskDisplayName, description: t('common.waitingGateway') });
        } else if (updatedTask.status === 'Completed') {
          notification.success({ ...notifyConfig, message: taskDisplayName, description: t('common.success') });
        } else if (updatedTask.status === 'Failed' || updatedTask.status === 'Timeout') {
          notification.error({ ...notifyConfig, message: taskDisplayName, description: `${t('common.error')}: ${updatedTask.error || 'Unknown Error'}` });
        }
      } else {
        // 对于已有任务（或接力任务），只有状态发生实质改变时才弹窗
        const effectiveOldTask = oldTask || handoverPendingTask;
        if (effectiveOldTask && effectiveOldTask.status !== updatedTask.status) {
          if (updatedTask.status === 'Completed') {
            notification.success({ ...notifyConfig, message: taskDisplayName, description: t('common.success') });
          } else if (updatedTask.status === 'Failed' || updatedTask.status === 'Timeout') {
            notification.error({ ...notifyConfig, message: taskDisplayName, description: `${t('common.error')}: ${updatedTask.error || 'Unknown Error'}` });
          }
        }
      }
    }

    setTasks(prev => {
      const taskMap = new Map<string, Task>();
      prev.forEach(t => taskMap.set(t.id, t));

      // 处理接力替换
      const index = prev.findIndex(t => t.id === updatedTask.id);
      if (index === -1 && !updatedTask.id.startsWith('pending-')) {
        const pendingIndex = prev.findIndex(t => 
          t.id.startsWith('pending-') && 
          t.module === updatedTask.module && 
          t.target === updatedTask.target &&
          t.action === updatedTask.action
        );
        if (pendingIndex > -1) {
          const pendingTask = prev[pendingIndex];
          taskMap.delete(pendingTask.id);
          const cleanedName = pendingTask.name.split(' (')[0];
          taskMap.set(updatedTask.id, { ...updatedTask, name: cleanedName || updatedTask.name });
        } else {
          taskMap.set(updatedTask.id, updatedTask);
        }
      } else {
        taskMap.set(updatedTask.id, updatedTask);
      }

      // 始终按开始时间倒序排列
      return Array.from(taskMap.values()).sort((a, b) => 
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
      );
    });
  }, [t]); 

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
    fetchActiveTasks(false, true); // 首次加载同步，不弹窗
    
    // --- 逻辑：自动巡检兜底 (Auto-Sync Polling) ---
    // 每 8 秒静默检查一次后端任务状态，防止 WS 丢包导致的 UI 卡死
    const poller = setInterval(() => {
      fetchActiveTasks(true, false); // 静默加载，但允许状态变更触发 UI 成功的通知
    }, 8000);

    return () => clearInterval(poller);
  }, [fetchActiveTasks]);

  return { tasks, loading, fetchActiveTasks, updateTask };
};
