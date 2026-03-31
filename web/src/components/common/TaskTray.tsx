import React from 'react';
import { Popover, Badge, List, Progress, Button, Typography, Space, Drawer } from 'antd';
import { Bell, CheckCircle2, XCircle, Clock, Loader2, AlertCircle, RotateCw } from 'lucide-react';
import type { Task } from '../../hooks/useTaskCenter';
import { useTranslation } from 'react-i18next';
import dayjs from 'dayjs';

interface TaskTrayProps {
  tasks: Task[];
  isMobile?: boolean;
  loading?: boolean;
  onRefresh?: () => void;
}

const TaskTray: React.FC<TaskTrayProps> = ({ tasks, isMobile, loading, onRefresh }) => {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  
  const activeTasks = tasks.filter(t => t.status === 'Running');
  const hasActive = activeTasks.length > 0;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Running': return <Loader2 size={14} className="animate-spin" style={{ color: '#3b82f6' }} />;
      case 'Completed': return <CheckCircle2 size={14} style={{ color: '#22c55e' }} />;
      case 'Failed': return <XCircle size={14} style={{ color: '#ef4444' }} />;
      case 'Timeout': return <AlertCircle size={14} style={{ color: '#f59e0b' }} />;
      default: return <Clock size={14} style={{ color: '#94a3b8' }} />;
    }
  };

  const translateTaskName = (name: string) => {
    if (!name) return '';
    if (name.startsWith('tasks.')) {
      const parts = name.split(':');
      const key = parts[0];
      const id = parts.slice(1).join(':'); // 处理 ID 中可能含有冒号的情况
      return t(key, { id, name: id });
    }
    return name;
  };

  const translateResult = (result: string) => {
    if (!result) return '';
    if (result.startsWith('tasks.')) {
      return t(result);
    }
    return result;
  };

  const listContent = (
    <List
      dataSource={tasks.slice(0, 15)}
      locale={{ emptyText: t('tasks.empty') }}
      renderItem={(item) => (
        <List.Item style={{ padding: isMobile ? '16px' : '12px 16px', display: 'block' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <Space size={8}>
              {getStatusIcon(item.status)}
              <Typography.Text style={{ fontSize: isMobile ? 14 : 13, fontWeight: 500 }}>
                {translateTaskName(item.name)}
              </Typography.Text>
            </Space>
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {dayjs(item.startTime).format('HH:mm:ss')}
            </Typography.Text>
          </div>
          
          {item.status === 'Running' ? (
            <Progress percent={item.progress} size="small" status="active" />
          ) : (
            <Typography.Text type="secondary" style={{ fontSize: 11 }}>
              {item.error || translateResult(item.result || '') || 'Finished'}
            </Typography.Text>
          )}
        </List.Item>
      )}
    />
  );

  if (isMobile) {
    return (
      <>
        <Badge count={activeTasks.length} size="small" offset={[-2, 2]}>
          <Button 
            type="text" 
            icon={<Bell size={20} color={hasActive ? '#2563eb' : '#64748b'} />} 
            onClick={() => setOpen(true)}
          />
        </Badge>
        <Drawer
          title={t('common.monitor_center')}
          placement="bottom"
          onClose={() => setOpen(false)}
          open={open}
          height="70vh"
          styles={{ body: { padding: 0 } }}
        >
          <div style={{ padding: '8px 16px', background: '#f8fafc', fontSize: 12, color: '#64748b', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{hasActive ? `${activeTasks.length} 个任务正在后台处理` : '历史任务轨迹'}</span>
            <Button 
              type="text" 
              size="small" 
              icon={<RotateCw size={14} className={loading ? 'animate-spin' : ''} />} 
              onClick={(e) => { e.stopPropagation(); onRefresh?.(); }}
              style={{ color: '#3b82f6' }}
            />
          </div>
          {listContent}
        </Drawer>
      </>
    );
  }

  return (
    <Popover 
      content={(
        <div style={{ width: 320, maxHeight: 480, overflowY: 'auto' }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Space size={8}>
              <Typography.Text strong>{t('common.monitor_center')}</Typography.Text>
              <Button 
                type="text" 
                size="small" 
                icon={<RotateCw size={14} className={loading ? 'animate-spin' : ''} style={{ color: '#3b82f6' }} />} 
                onClick={(e) => { e.stopPropagation(); onRefresh?.(); }}
              />
            </Space>
            {hasActive && <Badge status="processing" text={`${activeTasks.length} 个进行中`} />}
          </div>
          {listContent}
        </div>
      )} 
      trigger="click" 
      placement="bottomRight" 
      overlayStyle={{ padding: 0 }}
      arrow={false}
    >
      <Badge count={activeTasks.length} size="small" offset={[-2, 2]}>
        <Button 
          type="text" 
          icon={<Bell size={20} color={hasActive ? '#2563eb' : '#64748b'} />} 
          style={{ background: hasActive ? 'rgba(37, 99, 235, 0.05)' : 'transparent' }}
        />
      </Badge>
    </Popover>
  );
};

export default TaskTray;
