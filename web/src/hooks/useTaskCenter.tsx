import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import { notification, Progress, Button } from 'antd';
import { Loader2, CheckCircle2, XCircle, AlertCircle, Clock } from 'lucide-react';
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

    // --- 自定义通知内容渲染 ---
    const renderNotification = (task: Task) => {
      const getIcon = () => {
        switch (task.status) {
          case 'Running': return <Loader2 size={16} className="animate-spin" style={{ color: '#3b82f6' }} />;
          case 'Completed': return <CheckCircle2 size={16} style={{ color: '#22c55e' }} />;
          case 'Failed': return <XCircle size={16} style={{ color: '#ef4444' }} />;
          case 'Timeout': return <AlertCircle size={16} style={{ color: '#f59e0b' }} />;
          default: return <Clock size={16} style={{ color: '#94a3b8' }} />;
        }
      };

      const getStatusText = () => {
        if (task.module === 'system' && task.action === 'upgrade' && task.status === 'Completed') {
          return "核心文件已替换，请点击重启生效";
        }
        switch (task.status) {
          case 'Running': return t('common.waitingGateway');
          case 'Completed': return t('common.success');
          case 'Failed': return t('common.error');
          case 'Timeout': return t('common.timeout');
          default: return '';
        }
      };

      return (
        <div className="notification-content-layout">
          <div className="notification-status-line">
            {getIcon()}
            <span style={{ color: task.status === 'Running' ? '#3b82f6' : 'inherit' }}>
              {getStatusText()}
            </span>
          </div>
          {task.status === 'Running' && (
            <Progress 
              percent={task.progress} 
              size="small" 
              showInfo={false} 
              className="notification-progress-mini"
              strokeColor="#3b82f6"
            />
          )}
          {(task.status === 'Failed' || task.status === 'Timeout') && task.error && (
            <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4, opacity: 0.8 }}>
              {task.error}
            </div>
          )}
        </div>
      );
    };

    const notifyConfig = { 
      placement: 'bottomRight' as const, 
      duration: updatedTask.status === 'Running' ? 8 : 4.5,
      className: `premium-notification premium-notification-${updatedTask.status.toLowerCase()}`,
      style: { width: 340 },
      // 针对克隆并重启这类重型任务，如果已完成，提供一个手动刷新的按钮作为兜底
      btn: (updatedTask.status === 'Completed' && updatedTask.action === 'clone-expert') ? (
        <Button 
          type="primary" 
          size="small" 
          onClick={() => window.location.reload()}
          style={{ background: '#2563eb' }}
        >
          立即刷新
        </Button>
      ) : undefined
    };

    // --- 逻辑：决定是否需要弹窗 ---
    if (!skipNotify) {
      if (isNew) {
        // 只有真正的全新任务才弹出一个通知
        const icon = updatedTask.status === 'Running' ? 'info' : updatedTask.status === 'Completed' ? 'success' : 'error';
        (notification as any)[updatedTask.status === 'Running' ? 'info' : icon]({
          ...notifyConfig,
          message: <span style={{ fontWeight: 600 }}>{taskDisplayName}</span>,
          description: renderNotification(updatedTask),
          key: updatedTask.id // 保持 key 一致，支持后续更新同一条通知
        });
      } else {
        // 对于已有任务，只有状态发生实质改变时才更新通知
        const effectiveOldTask = oldTask || handoverPendingTask;
        if (effectiveOldTask && effectiveOldTask.status !== updatedTask.status) {
          const type = updatedTask.status === 'Completed' ? 'success' : (updatedTask.status === 'Failed' || updatedTask.status === 'Timeout') ? 'error' : 'info';
          (notification as any)[type]({
            ...notifyConfig,
            message: <span style={{ fontWeight: 600 }}>{taskDisplayName}</span>,
            description: renderNotification(updatedTask),
            key: updatedTask.id
          });
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
