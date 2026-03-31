import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import { message } from 'antd';

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
      if (index === -1) {
        return [updatedTask, ...prev];
      }
      const newTasks = [...prev];
      newTasks[index] = updatedTask;
      return newTasks;
    });

    if (updatedTask.status === 'Completed') {
      message.success(`${updatedTask.name} 已完成`);
    } else if (updatedTask.status === 'Failed' || updatedTask.status === 'Timeout') {
      message.error(`${updatedTask.name} 执行失败: ${updatedTask.error || '未知错误'}`);
    }
  }, []);

  useEffect(() => {
    fetchActiveTasks();
  }, [fetchActiveTasks]);

  return { tasks, loading, fetchActiveTasks, updateTask };
};
