import React, { useState } from 'react';
import { RefreshCw, Search, Zap, CheckCircle2, XCircle, AlertCircle, Info, ShieldCheck, Globe, ChevronDown, ChevronUp, Trash2, ArrowUpCircle, Settings2 } from 'lucide-react';
import { Card, Table, Tag, Button, Input, Tooltip, Typography, Segmented, message, Popconfirm, Switch } from 'antd';
import { useTranslation } from 'react-i18next';
import api from '../api';

import type { Task } from '../hooks/useTaskCenter';

interface Plugin {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  status: string;
  origin: string;
  rootDir: string;
  source: string;
  error?: string;
  channelIds: string[];
  providerIds: string[];
  _processing?: boolean;
}

interface PluginManagementProps {
  isMobile?: boolean;
  plugins: Plugin[];
  loading: boolean;
  onRefresh: (force?: boolean) => void;
  updatedAt?: string;
  onTaskUpdate?: (task: Task) => void;
  activeTasks?: Task[];
  isRunning?: boolean;
  onNavigateToDashboard?: () => void;
}

const PluginManagement: React.FC<PluginManagementProps> = ({ 
  isMobile, plugins: globalPlugins, loading, onRefresh, updatedAt, onTaskUpdate, 
  activeTasks = []
}) => {
  const { t } = useTranslation();
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | number>('all');
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [updating, setUpdating] = useState(false);
  const [reloading, setReloading] = useState(false);
  
  // 同步引用，用于立即锁定，防止 React 异步状态导致的重复点击
  const processingRef = React.useRef(new Set<string>());
  const lastActionTimeRef = React.useRef<Record<string, number>>({});
  
  // 本地插件状态列表，用于支持乐观更新
  const [localPlugins, setLocalPlugins] = useState<Plugin[]>(globalPlugins);

  // 检查是否有相同的任务正在进行中
  const hasActiveTask = (id: string, action?: string) => {
    return activeTasks.some(task => 
      task.module === 'plugins' && 
      task.target === id && 
      (action ? task.action === action : true) &&
      task.status === 'Running'
    );
  };

  // 当后端数据真正刷新时（updatedAt 或 globalPlugins 变化），同步本地状态并清除所有进行中的锁
  const lastUpdateRef = React.useRef(updatedAt);
  React.useEffect(() => {
    setLocalPlugins(globalPlugins);
    // 严格锁定：只有当同步时间戳真正发生变化时（意味着后端已完成同步并返回新数据），才释放锁定
    if (updatedAt && updatedAt !== lastUpdateRef.current) {
      setProcessingIds(new Set());
      processingRef.current.clear();
      lastUpdateRef.current = updatedAt;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [globalPlugins, updatedAt]);

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleAction = async (id: string, action: 'enable' | 'disable' | 'uninstall', e?: React.BaseSyntheticEvent) => {
    // 立即停止传播
    if (e) e.stopPropagation();

    const now = Date.now();
    const lastTime = lastActionTimeRef.current[id] || 0;
    
    // 同步哨兵拦截：由于 Ref 是同步的，这里能秒级拦截重复点击
    if (processingRef.current.has(id) || now - lastTime < 1000 || hasActiveTask(id, action)) {
      message.warning(t('common.taskAlreadyRunning') || '已有相同任务正在进行中，请耐心等待');
      return;
    }

    // 锁定 ID
    lastActionTimeRef.current[id] = now;
    processingRef.current.add(id);
    setProcessingIds(new Set(processingRef.current));

    try {
      if (!onTaskUpdate) {
        // 降级逻辑：走旧的同步流程
        try {
          const url = action === 'uninstall' ? `/v1/openclaw/plugins/${id}` : `/v1/openclaw/plugins/${action}`;
          if (action === 'uninstall') {
            await api.delete(url);
          } else {
            await api.post(url, { id });
          }
          message.success(t(`plugins.${action}Success`));
          onRefresh(true);
        } catch (err: any) {
          message.error(err.message || t('common.error'));
          // 失败时解锁
          processingRef.current.delete(id);
          setProcessingIds(new Set(processingRef.current));
        }
        return;
      }

      // --- 1. [乐观更新] ---
      const pendingId = `pending-plugins-${action}-${id}-${Date.now()}`;
      if (action === 'uninstall') {
        setLocalPlugins(prev => prev.filter(p => p.id !== id));
      } else {
        setLocalPlugins(prev => prev.map(p => 
          p.id === id ? { ...p, enabled: action === 'enable' } : p
        ));
      }

      // --- 2. [任务注册] ---
      const pendingTask: Task = {
        id: pendingId,
        name: t(`plugins.${action}`) + `: ${id}`,
        module: 'plugins',
        action: action,
        target: id,
        status: 'Running',
        progress: 10,
        startTime: new Date().toISOString()
      };
      onTaskUpdate(pendingTask);

      try {
        const url = action === 'uninstall' ? `/v1/openclaw/plugins/${id}` : `/v1/openclaw/plugins/${action}`;
        let response;
        if (action === 'uninstall') {
          response = await api.delete(url);
        } else {
          response = await api.post(url, { id });
        }

        const realTaskId = response.data.taskId || response.data.data?.taskId;
        if (realTaskId) {
          onTaskUpdate({ ...pendingTask, id: realTaskId, progress: 20 });
          message.info(t('chat.waitingGatewaySync'));
        } else {
          onTaskUpdate({ ...pendingTask, status: 'Completed', progress: 100 });
          onRefresh(true);
        }
      } catch (err: any) {
        setLocalPlugins(globalPlugins);
        processingRef.current.delete(id);
        setProcessingIds(new Set(processingRef.current));
        onTaskUpdate({ 
          ...pendingTask, 
          status: 'Failed', 
          error: err.response?.data?.error || err.message 
        });
      }
    } catch {
      processingRef.current.delete(id);
      setProcessingIds(new Set(processingRef.current));
    }
  };

  const handleUpdate = async () => {
    setUpdating(true);
    const pendingId = `pending-plugins-update-${Date.now()}`;
    const pendingTask: Task = {
      id: pendingId,
      name: t('plugins.update'),
      module: 'plugins',
      action: 'update',
      target: 'all',
      status: 'Running',
      progress: 5,
      startTime: new Date().toISOString()
    };

    if (onTaskUpdate) onTaskUpdate(pendingTask);

    try {
      const response = await api.post('/v1/openclaw/plugins/update');
      const realTaskId = response.data.taskId || response.data.data?.taskId;
      
      if (realTaskId && onTaskUpdate) {
        onTaskUpdate({ ...pendingTask, id: realTaskId, progress: 10 });
        message.info(t('plugins.updateStarted'));
      } else {
        message.success(t('plugins.updateSuccess') || 'Update completed');
        onRefresh(true);
      }
    } catch (err: any) {
      message.error(err.message || t('common.error'));
      if (onTaskUpdate) {
        onTaskUpdate({ ...pendingTask, status: 'Failed', error: err.message });
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleReload = async () => {
    if (reloading) return;
    setReloading(true);
    try {
      await api.post('/v1/openclaw/plugins/reload');
      message.success(t('plugins.syncSuccess'));
      onRefresh(true);
    } catch (err: any) {
      message.error(err.message || t('common.error'));
    } finally {
      setReloading(false);
    }
  };

  const filteredPlugins = localPlugins.filter((plugin: Plugin) => {
    const matchesSearch = (plugin.name + plugin.id + plugin.description).toLowerCase().includes(searchText.toLowerCase());
    
    let matchesStatus = true;
    if (statusFilter === 'loaded') {
      matchesStatus = plugin.status === 'loaded' || (plugin.enabled && !plugin.error);
    } else if (statusFilter === 'error') {
      matchesStatus = !!plugin.error || plugin.status === 'error';
    } else if (statusFilter === 'disabled') {
      matchesStatus = plugin.status === 'disabled' || !plugin.enabled;
    }
    
    return matchesSearch && matchesStatus;
  });

  const getStatusTag = (plugin: Plugin) => {
    if (plugin.status === 'loaded' || (plugin.enabled && !plugin.error)) {
      return <Tag color="success" icon={<CheckCircle2 size={12} style={{ marginRight: 4 }} />} style={{ borderRadius: 6, padding: '2px 8px' }}>{t('plugins.loaded')}</Tag>;
    }
    if (plugin.status === 'disabled' || !plugin.enabled) {
      return <Tag color="default" icon={<XCircle size={12} style={{ marginRight: 4 }} />} style={{ borderRadius: 6, padding: '2px 8px' }}>{t('plugins.disabled')}</Tag>;
    }
    if (plugin.error || plugin.status === 'error') {
      return (
        <Tooltip title={plugin.error}>
          <Tag color="error" icon={<AlertCircle size={12} style={{ marginRight: 4 }} />} style={{ borderRadius: 6, cursor: 'help', padding: '2px 8px' }}>{t('plugins.error')}</Tag>
        </Tooltip>
      );
    }
    return <Tag color="processing" style={{ borderRadius: 6, padding: '2px 8px' }}>{plugin.status}</Tag>;
  };

  const columns = [
    {
      title: t('plugins.pluginName'),
      key: 'name',
      render: (_: any, record: Plugin) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ padding: 8, background: '#f8fafc', borderRadius: 8, color: '#f59e0b' }}>
            <Zap size={18} />
          </div>
          <div>
            <div style={{ fontWeight: 600, color: '#1e293b' }}>{record.name || record.id}</div>
            <div style={{ fontSize: 11, color: '#94a3b8' }}>ID: {record.id}</div>
          </div>
        </div>
      ),
    },
    {
      title: t('plugins.version'),
      dataIndex: 'version',
      key: 'version',
      width: 100,
      render: (v: string) => <Typography.Text code style={{ fontSize: 11 }}>{v || 'N/A'}</Typography.Text>
    },
    {
      title: t('plugins.status'),
      key: 'status',
      width: 120,
      render: (record: Plugin) => getStatusTag(record),
    },
    {
      title: t('plugins.enable'),
      key: 'enabled',
      width: 80,
      render: (record: Plugin) => {
        const isProcessing = processingIds.has(record.id) || hasActiveTask(record.id);
        const switchComp = (
          <Switch 
            checked={record.enabled} 
            size="small"
            loading={isProcessing}
            disabled={isProcessing}
            onChange={(checked, e) => handleAction(record.id, checked ? 'enable' : 'disable', e)}
          />
        );

        if (isProcessing) {
          return (
            <Tooltip title={t('common.processing')}>
              <div style={{ cursor: 'not-allowed', display: 'inline-block' }}>
                {switchComp}
              </div>
            </Tooltip>
          );
        }
        return switchComp;
      }
    },
    {
      title: t('common.action'),
      key: 'actions',
      width: 150,
      render: (record: Plugin) => {
        const isProcessing = processingIds.has(record.id) || hasActiveTask(record.id, 'uninstall');
        return (
          <div style={{ display: 'flex', gap: 8 }}>
            <Tooltip title={record.rootDir}>
              <Button size="small" type="text" icon={<Info size={14} />} />
            </Tooltip>
            <Tooltip title={isProcessing ? t('common.processing') : ''}>
              <Popconfirm
                title={t('plugins.uninstallConfirmTitle')}
                description={t('plugins.uninstallConfirmContent', { name: record.name })}
                onConfirm={(e) => handleAction(record.id, 'uninstall', e)}
                disabled={isProcessing}
                okText={t('common.confirm')}
                cancelText={t('common.cancel')}
                okButtonProps={{ danger: true, loading: isProcessing }}
              >
                <Button 
                  size="small" 
                  type="text" 
                  danger 
                  icon={<Trash2 size={14} />} 
                  disabled={isProcessing}
                  style={{ cursor: isProcessing ? 'not-allowed' : 'pointer' }}
                />
              </Popconfirm>
            </Tooltip>
          </div>
        );
      }
    }
  ];

  return (
    <div style={{ height: '100%', minHeight: 'calc(100vh - 100px)', width: '100%', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* 允许在网关停止时通过 Buddy 管理插件 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '0' : '8px', display: 'flex', flexDirection: 'column', gap: 20 }}>
      <Card 
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 12 }}>
            <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Zap size={isMobile ? 18 : 20} color="#f59e0b" /> {isMobile ? t('plugins.title') : t('plugins.fullTitle')}
            </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12 }}>
                {!isMobile && (
                  <>
                    <Button 
                      size="small" 
                      icon={<ArrowUpCircle size={14} />} 
                      onClick={handleUpdate}
                      loading={updating}
                      disabled={updating || reloading}
                      style={{ fontSize: 12, borderRadius: 6 }}
                    >
                      {t('plugins.update')}
                    </Button>
                    <Button 
                      size="small" 
                      icon={<Settings2 size={14} />} 
                      onClick={handleReload}
                      loading={reloading}
                      disabled={updating || reloading}
                      style={{ fontSize: 12, borderRadius: 6 }}
                    >
                      {t('plugins.reload')}
                    </Button>
                  </>
                )}
                {updatedAt && (
                   <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>
                     {isMobile ? updatedAt.split(' ')[1] : `${t('plugins.syncedAt')}: ${updatedAt}`}
                   </span>
                )}
                <Button 
                  type="text" 
                  size="small" 
                  icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />} 
                  onClick={() => onRefresh(true)}
                  loading={loading}
                  style={{ color: '#64748b', display: 'flex', alignItems: 'center', padding: isMobile ? '0 4px' : '0 8px' }}
                >
                   {isMobile ? '' : t('common.refresh')}
                </Button>
              </div>
          </div>
        }
        bodyStyle={{ padding: 0 }} 
        style={{ borderRadius: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.02)', border: '1px solid #e2e8f0', overflow: 'hidden' }}
      >
        <div style={{ padding: isMobile ? '10px 16px' : '12px 24px', borderBottom: '1px solid #f1f5f9', color: '#64748b', fontSize: 12 }}>
          {t('plugins.description')}
        </div>
        
        <div style={{ 
          padding: isMobile ? '12px 16px' : '16px 24px', 
          borderBottom: '1px solid #f1f5f9',
          display: 'flex',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'flex-start' : 'center',
          gap: 12
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: isMobile ? '100%' : 'auto', flex: 1 }}>
            <Input 
              prefix={<Search size={16} color="#94a3b8" />} 
              placeholder={t('plugins.search')} 
              value={searchText}
              onChange={e => setSearchText(e.target.value)}
              style={{ flex: 1, borderRadius: 8 }}
              allowClear
            />
            {!isMobile && (
              <div style={{ 
                fontSize: 12, color: '#f59e0b', background: '#fffbeb', 
                padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap'
              }}>
                {t('plugins.count', { count: filteredPlugins.length })}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-end' }}>
            {isMobile && (
              <Button 
                size="small" 
                icon={<ArrowUpCircle size={14} />} 
                onClick={handleUpdate}
                loading={updating}
                style={{ fontSize: 11, borderRadius: 6 }}
              >
                {t('plugins.update')}
              </Button>
            )}
            <Segmented
              options={[
                { label: t('plugins.loaded'), value: 'loaded' },
                { label: t('common.all'), value: 'all' },
                { label: t('plugins.error'), value: 'error' }
              ]}
              value={statusFilter}
              onChange={(value) => setStatusFilter(value)}
              style={{ background: '#f1f5f9', borderRadius: 8, padding: 2 }}
            />
          </div>
        </div>

        {isMobile ? (
          <div style={{ maxHeight: '65vh', overflowY: 'auto' }}>
            {filteredPlugins.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>{t('plugins.noPlugins')}</div>
            ) : (
              filteredPlugins.map((plugin: Plugin) => {
                const isExpanded = expandedIds.includes(plugin.id);
                return (
                  <div key={plugin.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <div 
                      onClick={() => toggleExpand(plugin.id)}
                      style={{ padding: 16, display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
                    >
                      <div style={{ padding: 8, background: '#f8fafc', borderRadius: 8, color: '#f59e0b', flexShrink: 0 }}>
                        <Zap size={18} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <span style={{ fontWeight: 600, color: '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {plugin.name || plugin.id}
                          </span>
                          {getStatusTag(plugin)}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: '#94a3b8' }}>
                          <span>ID: {plugin.id}</span>
                          <span>•</span>
                          <Typography.Text code style={{ fontSize: 10, padding: '0 4px' }}>v{plugin.version || '0.0.0'}</Typography.Text>
                        </div>
                      </div>
                      <div style={{ color: '#94a3b8' }}>
                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </div>
                    </div>
                    
                    {isExpanded && (
                      <div style={{ padding: '0 16px 16px 16px', background: '#f8fafc' }}>
                        <div style={{ padding: 12, background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }}>
                          <div style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 600, color: '#64748b', fontSize: 11, marginBottom: 4 }}>{t('plugins.functionDesc')}</div>
                            <div style={{ color: '#445469', lineHeight: 1.5 }}>{plugin.description || t('plugins.noDescription')}</div>
                          </div>
                          
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                            <div>
                              <div style={{ fontWeight: 600, color: '#64748b', fontSize: 11, marginBottom: 4 }}>{t('plugins.origin')}</div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4, color: '#1e293b' }}>
                                {plugin.origin === 'bundled' ? <ShieldCheck size={14} color="#10b981" /> : <Globe size={14} color="#3b82f6" />}
                                {plugin.origin}
                              </div>
                            </div>
                            <div>
                               <div style={{ fontWeight: 600, color: '#64748b', fontSize: 11, marginBottom: 4 }}>{t('plugins.enable')}</div>
                               <Tooltip title={processingIds.has(plugin.id) || hasActiveTask(plugin.id) ? t('common.processing') : ''}>
                                  <Switch 
                                    checked={plugin.enabled} 
                                    size="small"
                                    loading={processingIds.has(plugin.id) || hasActiveTask(plugin.id)}
                                    disabled={processingIds.has(plugin.id) || hasActiveTask(plugin.id)}
                                    onChange={(checked, e) => handleAction(plugin.id, checked ? 'enable' : 'disable', e)}
                                    style={{ cursor: (processingIds.has(plugin.id) || hasActiveTask(plugin.id)) ? 'not-allowed' : 'pointer' }}
                                  />
                               </Tooltip>
                            </div>
                          </div>

                          <div style={{ display: 'flex', gap: 8, marginBottom: 12, paddingTop: 12, borderTop: '1px solid #f1f5f9' }}>
                            <Button 
                              size="small" 
                              icon={<Info size={14} />} 
                              onClick={() => message.info(plugin.rootDir)}
                              style={{ flex: 1, borderRadius: 8 }}
                            >
                              {t('common.info') || 'Details'}
                            </Button>
                            <Tooltip title={processingIds.has(plugin.id) || hasActiveTask(plugin.id, 'uninstall') ? t('common.processing') : ''}>
                              <Popconfirm
                                title={t('plugins.uninstallConfirmTitle')}
                                description={t('plugins.uninstallConfirmContent', { name: plugin.name })}
                                onConfirm={(e) => handleAction(plugin.id, 'uninstall', e)}
                                disabled={processingIds.has(plugin.id) || hasActiveTask(plugin.id, 'uninstall')}
                                okText={t('common.confirm')}
                                cancelText={t('common.cancel')}
                                okButtonProps={{ danger: true, loading: processingIds.has(plugin.id) || hasActiveTask(plugin.id, 'uninstall') }}
                              >
                                <Button 
                                  size="small" 
                                  danger 
                                  icon={<Trash2 size={14} />} 
                                  style={{ flex: 1, borderRadius: 8, cursor: (processingIds.has(plugin.id) || hasActiveTask(plugin.id, 'uninstall')) ? 'not-allowed' : 'pointer' }}
                                  disabled={processingIds.has(plugin.id) || hasActiveTask(plugin.id, 'uninstall')}
                                >
                                  {t('plugins.uninstall')}
                                </Button>
                              </Popconfirm>
                            </Tooltip>
                          </div>

                          {(plugin.channelIds?.length > 0 || plugin.providerIds?.length > 0) && (
                            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed #e2e8f0' }}>
                              {plugin.channelIds?.length > 0 && (
                                <div style={{ marginBottom: 8 }}>
                                  <div style={{ fontWeight: 600, color: '#64748b', fontSize: 11, marginBottom: 4 }}>{t('plugins.channels')}</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {plugin.channelIds.map((c: string) => <Tag key={c} style={{ margin: 0, fontSize: 10 }}>{c}</Tag>)}
                                  </div>
                                </div>
                              )}
                              {plugin.providerIds?.length > 0 && (
                                <div>
                                  <div style={{ fontWeight: 600, color: '#64748b', fontSize: 11, marginBottom: 4 }}>{t('plugins.providers')}</div>
                                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                    {plugin.providerIds.map((p: string) => <Tag key={p} style={{ margin: 0, fontSize: 10 }}>{p}</Tag>)}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          <Table 
            columns={columns} 
            dataSource={filteredPlugins} 
            rowKey="id"
            loading={loading}
            pagination={{ pageSize: 12, hideOnSinglePage: true }}
            locale={{ emptyText: t('plugins.noPlugins') }}
            style={{ padding: '8px' }}
            expandable={{
              expandedRowRender: record => (
                <div style={{ padding: '12px 20px', background: '#f8fafc', borderRadius: 8 }}>
                  <div style={{ marginBottom: 8 }}>
                    <Typography.Text type="secondary" strong style={{ fontSize: 12 }}>{t('plugins.functionDesc')}:</Typography.Text>
                    <div style={{ color: '#475569', marginTop: 4 }}>{record.description || t('plugins.noDescription')}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 24 }}>
                    {record.channelIds?.length > 0 && (
                      <div style={{ marginBottom: 8 }}>
                        <Typography.Text type="secondary" strong style={{ fontSize: 12 }}>{t('plugins.channels')}:</Typography.Text>
                        <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {record.channelIds.map(c => <Tag key={c}>{c}</Tag>)}
                        </div>
                      </div>
                    )}
                    {record.providerIds?.length > 0 && (
                      <div>
                        <Typography.Text type="secondary" strong style={{ fontSize: 12 }}>{t('plugins.providers')}:</Typography.Text>
                        <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {record.providerIds.map(p => <Tag key={p}>{p}</Tag>)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ),
              rowExpandable: record => !!(record.description || record.channelIds?.length || record.providerIds?.length)
            }}
          />
        )}
      </Card>
      </div>
    </div>
  );
};

export default PluginManagement;
