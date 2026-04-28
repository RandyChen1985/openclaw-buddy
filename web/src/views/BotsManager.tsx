import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Tag, Spin, Button, Modal, Form, Input, Select, Tooltip, Table, Checkbox, Segmented, Empty, Tabs, List as AntList, Popconfirm, Alert } from 'antd';
import { useTranslation } from 'react-i18next';
import { 
  Boxes, RefreshCw, Plus, Pencil, Trash2, Cpu, History, ShieldCheck, Zap, Star, 
  ChevronDown, ChevronUp, Activity, ZapOff, Bot, LayoutGrid, List, FolderOpen,
  Eye, Save, Brain, Edit3, BrainCircuit, Copy, Heart, Users, MessageSquare
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import dayjs from 'dayjs';
import api from '../api';
import { message } from 'antd';
import TokenBadge from '../components/TokenBadge';
import FileExplorer from '../components/FileExplorer';

interface BotsManagerProps {
  botsModels: any; 
  loadingBots: boolean;
  isMobile: boolean;
  onRefresh: () => void; // 现在对应 fetchModelsConfig
  onRefreshBots: () => void; // 现在对应 fetchBotsModels
  modelsConfig: any;
  loadingConfig: boolean;
  onAddBot: (id: string, model: string) => Promise<void>;
  onUpdateBot: (id: string, name?: string, model?: string) => Promise<void>;
  onDeleteBot: (id: string) => Promise<void>;
  onSetDefaultModel: (id: string) => Promise<void>;
  activeTasks?: any[];
  isRunning?: boolean;
  onNavigateToDashboard?: () => void;
  onNavigateToChat?: (botId: string) => void;
}

const BotsManager: React.FC<BotsManagerProps> = ({ 
  botsModels, loadingBots, isMobile, onRefresh, onRefreshBots, modelsConfig, loadingConfig,
  onAddBot, onUpdateBot, onDeleteBot, onSetDefaultModel,
  activeTasks = [],
  onNavigateToDashboard,
  onNavigateToChat
}) => {
  const { t } = useTranslation();
  const cardColors = [
    { bg: '#eff6ff', border: '#dbeafe', iconBg: '#dbeafe', theme: '#2563eb' }, // Blue
    { bg: '#f5f3ff', border: '#ddd6fe', iconBg: '#ede9fe', theme: '#7c3aed' }, // Indigo
    { bg: '#f0fdf4', border: '#dcfce7', iconBg: '#dcfce7', theme: '#16a34a' }, // Green
    { bg: '#fffbeb', border: '#fef3c7', iconBg: '#fef3c7', theme: '#d97706' }, // Amber
    { bg: '#faf5ff', border: '#f3e8ff', iconBg: '#f3e8ff', theme: '#9333ea' }, // Purple
    { bg: '#fdf2f8', border: '#fce7f3', iconBg: '#fce7f3', theme: '#db2777' }, // Pink
  ];
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [adding, setAdding] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [editingBot, setEditingBot] = useState<{ id: string, name: string, model: string } | null>(null);
  const [deletingBotId, setDeletingBotId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  
  const [collapsedProviders, setCollapsedProviders] = useState<Set<string>>(new Set());
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [isEditingProvider, setIsEditingProvider] = useState(false);
  const [editingProviderName, setEditingProviderName] = useState<string | null>(null);
  const [configForm] = Form.useForm();
  const [modelForm] = Form.useForm();
  const [submittingConfig, setSubmittingConfig] = useState(false);
  const [isEditingModel, setIsEditingModel] = useState(false);
  
  // 模型连通性测试状态
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [testLatencyMap, setTestLatencyMap] = useState<Record<string, { latency: number, error?: string }>>({});

  // 视图模式切换
  const [botsViewMode, setBotsViewMode] = useState<'card' | 'list'>('card');
  const [modelsViewMode, setModelsViewMode] = useState<'card' | 'list'>('card');

  // --- Provider Icon Component ---
  const ProviderIcon = ({ provider, size = 28 }: { provider: string, size?: number }) => {
    const p = (provider || '').toLowerCase();
    const iconStyle = { width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' };
    
    if (p.includes('openai')) return <div style={iconStyle}><Bot size={size * 0.8} color="#10a37f" /></div>;
    if (p.includes('anthropic') || p.includes('claude')) return <div style={{ ...iconStyle, fontSize: size * 0.7, fontWeight: 900, color: '#d97706', fontFamily: 'serif' }}>A</div>;
    if (p.includes('google') || p.includes('gemini')) return <div style={iconStyle}><Zap size={size * 0.8} color="#4285f4" fill="#4285f4" /></div>;
    if (p.includes('deepseek')) return <div style={iconStyle}><Activity size={size * 0.8} color="#0891b2" /></div>;
    if (p.includes('mistral')) return <div style={iconStyle}><ZapOff size={size * 0.8} color="#f97316" /></div>;
    if (p.includes('zhipu')) return <div style={iconStyle}><Zap size={size * 0.8} color="#6366f1" fill="#6366f1" /></div>;
    
    return <div style={{ ...iconStyle, fontSize: size * 0.8 }}>🍭</div>;
  };

  useEffect(() => {
    fetchSessions();
  }, []);
  
  const isBotProcessing = (botId: string) => {
    return activeTasks.some(t => t.module === 'bots' && t.target === botId && t.status === 'Running');
  };

  const isModelProcessing = (modelFullId: string) => {
    return activeTasks.some(t => 
      t.module === 'bots' && 
      (t.action === 'set-default-model' || t.action === 'delete-model' || t.action === 'add-model') && 
      t.target === modelFullId && 
      t.status === 'Running'
    );
  };

  const isProviderProcessing = (providerName: string) => {
    return activeTasks.some(t => 
      t.module === 'bots' && 
      (t.action === 'add-provider' || t.action === 'add-model' || t.action === 'delete-provider' || t.action === 'update-provider') && 
      t.target === providerName && 
      t.status === 'Running'
    );
  };

  // --- 自动刷新闭环：监测后台任务完成情况 ---

  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editorType, setEditorType] = useState<'soul' | 'identity' | 'memory' | 'heartbeat' | 'agents'>('soul');
  const [editorContent, setEditorContent] = useState('');
  const [editorBotId, setEditorBotId] = useState('');
  const [isEditorLoading, setIsEditorLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  
  // Memory management states
  const [memoryFiles, setMemoryFiles] = useState<string[]>([]);
  const [activeMemoryTab, setActiveMemoryTab] = useState<'long' | 'daily'>('long');
  const [selectedMemoryFile, setSelectedMemoryFile] = useState<string | null>(null);
  const [loadingMemoryList, setLoadingMemoryList] = useState(false);
  const [editorViewMode, setEditorViewMode] = useState<'code' | 'preview'>('code');

  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerPath, setExplorerPath] = useState('');
  const [explorerTitle, setExplorerTitle] = useState('');


  const fetchSessions = async (force = false) => {
    setLoadingSessions(true);
    try {
      const res = await api.get(`/v1/openclaw/sessions${force ? '?refresh=true' : ''}`);
      setSessions(res.data.data || res.data || []);
    } catch (err) {
    } finally {
      setLoadingSessions(false);
    }
  };

  const formatAgeMs = (ms: number) => {
    if (ms < 60000) return t('bots.justNow');
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return t('bots.minutesAgo', { count: minutes });
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return t('bots.hoursAgo', { count: hours });
    return t('bots.daysAgo', { count: Math.floor(hours / 24) });
  };

  const handleAddProvider = async () => {
    try {
      const values = await configForm.validateFields();
      setSubmittingConfig(true);
      setIsProviderModalOpen(false);
      
      // 物理调用渠道保存接口
      await api.post('/v1/openclaw/models/provider', {
        name: isEditingProvider ? editingProviderName : values.name,
        config: {
          baseUrl: values.baseUrl,
          apiKey: values.apiKey,
          auth: values.auth || 'api-key',
          api: values.api || 'openai-completions'
        }
      });
      
      configForm.resetFields();
      setIsEditingProvider(false);
      setEditingProviderName(null);
      message.success(t('common.waitingGateway'));
      // 此处不再手动调刷新，App.tsx 监听到任务完成后会自动执行 fetchModelsConfig 物理对账
    } catch (err: any) {
      if (!err.errorFields) {
        message.error(t('bots.saveFailed') + ': ' + (err.response?.data?.error || err.message));
      }
    } finally {
      setSubmittingConfig(false);
    }
  };

  const handleEditProvider = (name: string, config: any) => {
    setEditingProviderName(name);
    setIsEditingProvider(true);
    configForm.setFieldsValue({
      name: name,
      baseUrl: config.baseUrl,
      apiKey: config.apiKey,
      auth: config.auth || 'api-key',
      api: config.api || 'openai-completions'
    });
    setIsProviderModalOpen(true);
  };

  const handleEditModel = (providerName: string, m: any) => {
    setIsEditingModel(true);
    // 回填表单
    modelForm.setFieldsValue({
      provider_name: providerName,
      id: m.id,
      name: m.name,
      api: m.api || 'openai-completions',
      reasoning: !!m.reasoning,
      input: m.input || ['text'],
      maxTokens: m.maxTokens || 2000000,
      contextWindow: m.contextWindow || 2000000,
    });
    setIsModelModalOpen(true);
  };

  const handleAddModelToProvider = async () => {
    try {
      await modelForm.validateFields();
      const values = modelForm.getFieldsValue(true);
      setSubmittingConfig(true);
      setIsModelModalOpen(false);

      const submitData = {
        providerName: values.provider_name,
        modelConfig: {
          id: values.id,
          name: values.name || values.id,
          api: values.api,
          reasoning: !!values.reasoning,
          input: values.input,
          maxTokens: parseInt(values.maxTokens) || 2000000,
          contextWindow: parseInt(values.contextWindow) || 2000000,
        }
      };

      // 物理发起模型添加请求
      await api.post('/v1/openclaw/models/provider/model', submitData);
      modelForm.resetFields();
      setIsEditingModel(false);
      message.success(t('common.waitingGateway'));
      // 同上，UI 对账动作已由 App.tsx 全局观察器承包
    } catch (err: any) {
      if (!err.errorFields) {
        message.error(t('bots.saveFailed') + ': ' + (err.response?.data?.error || err.message));
      }
    } finally {
      setSubmittingConfig(false);
    }
  };

  const handleTestModel = async (provider: string, modelId: string) => {
    const fullId = `${provider}/${modelId}`;
    setTestingModelId(fullId);
    try {
      const startTime = Date.now();
      await api.post('/v1/openclaw/models/test-direct', { providerName: provider, modelId });
      const latency = Date.now() - startTime;
      setTestLatencyMap(prev => ({ ...prev, [fullId]: { latency } }));
      message.success(t('bots.testSuccess', { id: modelId, latency }));
    } catch (err: any) {
      setTestLatencyMap(prev => ({ ...prev, [fullId]: { latency: -1, error: err.message } }));
      message.error(t('bots.testFailed', { id: modelId }) + ': ' + (err.response?.data?.error || err.message));
    } finally {
      setTestingModelId(null);
    }
  };

  const handleDeleteModel = (provider: string, modelId: string) => {
    Modal.confirm({
      title: t('bots.removeModelTitle'),
      content: t('bots.removeModelWarning', { id: modelId, provider }),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          // 物理调用模型删除接口 (任务 ID 会被全局 App.tsx 捕捉并自动重刷)
          await api.delete(`/v1/openclaw/models/provider/${provider}/model/${modelId}`);
          message.success(t('common.waitingGateway'));
        } catch (err: any) {
          message.error(t('bots.deleteFailed') + ': ' + (err.response?.data?.error || err.message));
          onRefresh(); // 失败回退对账
        }
      }
    });
  };

  const handleDeleteProvider = (name: string) => {
    Modal.confirm({
      title: t('bots.removeProviderTitle', { name }),
      content: t('bots.removeProviderWarning', { name }),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await api.delete(`/v1/openclaw/models/provider/${name}`);
          message.success(t('common.waitingGateway'));
        } catch (err: any) {
          message.error(t('bots.deleteFailed') + ': ' + (err.response?.data?.error || err.message));
        }
      }
    });
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setIsModalOpen(false); // 立即关闭弹窗
      setAdding(true);
      await onAddBot(values.id, values.model);
      form.resetFields();
    } catch (err) {
    } finally {
      setAdding(false);
    }
  };

  const handleEditClick = (bot: any) => {
    setEditingBot(bot);
    editForm.setFieldsValue({ name: bot.name || '', model: bot.model });
    setIsEditModalOpen(true);
  };

  const handleEditOk = async () => {
    try {
      const values = await editForm.validateFields();
      setIsEditModalOpen(false); // 立即关闭弹窗
      setProcessing(true);
      
      const nameChanged = editingBot && values.name !== editingBot.name;
      const modelChanged = editingBot && values.model !== editingBot.model;
      
      if (editingBot && (nameChanged || modelChanged)) {
        await onUpdateBot(
          editingBot.id, 
          nameChanged ? values.name : undefined, 
          modelChanged ? values.model : undefined
        );
        onRefresh();
      } else {
        message.info(t('common.noChanges'));
      }
    } catch (err) {
    } finally {
      setProcessing(false);
    }
  };

  const showDeleteConfirm = (id: string) => {
    setDeletingBotId(id);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (deletingBotId) {
      setIsDeleteModalOpen(false); // 立即关闭弹窗
      setProcessing(true);
      await onDeleteBot(deletingBotId);
      setDeletingBotId(null);
      setProcessing(false);
    }
  };

  const handleOpenFileEditor = async (botId: string, type: 'soul' | 'identity' | 'memory' | 'heartbeat' | 'agents', filename?: string, tabOverride?: 'long' | 'daily') => {
    try {
      setEditorBotId(botId);
      setEditorType(type as any);
      setEditorContent('');
      setIsEditorLoading(true);
      setIsEditorOpen(true);
      setEditorViewMode('code');
      
      const bot = botsModels?.data?.bots?.find((b: any) => b.id === botId);
      const workspaceParam = bot?.workspace ? `&workspace=${encodeURIComponent(bot.workspace)}` : '';
      
      const currentTab = tabOverride || activeMemoryTab;
      
      let url = `/v1/openclaw/bots/file?id=${botId}&type=${type}${workspaceParam}`;
      if (type === 'memory' && currentTab === 'daily' && filename) {
        url = `/v1/openclaw/bots/file?id=${botId}&type=memory_file&filename=${encodeURIComponent(filename)}${workspaceParam}`;
        setSelectedMemoryFile(filename);
      } else if (type === 'memory' && currentTab === 'long') {
        setSelectedMemoryFile(null);
      } else if (type === 'memory' && currentTab === 'daily' && !filename) {
          // 如果没传文件名且处于日期记忆 Tab，先拉列表
          fetchMemoryList(botId, bot?.workspace);
          setIsEditorLoading(false);
          return;
      }

      const res = await api.get(url);
      setEditorContent(res.data.content || '');
    } catch (err: any) {
      if (isEditorOpen) {
        message.error(t('common.loadFailed') + ': ' + (err.response?.data?.error || err.message));
      }
    } finally {
      setIsEditorLoading(false);
    }
  };

  const fetchMemoryList = async (botId: string, workspace?: string) => {
    setLoadingMemoryList(true);
    try {
      const workspaceParam = workspace ? `&workspace=${encodeURIComponent(workspace)}` : '';
      const res = await api.get(`/v1/openclaw/bots/memory/list?id=${botId}${workspaceParam}`);
      setMemoryFiles(res.data.files || []);
    } catch (err: any) {
      message.error(t('common.loadFailed') + ': ' + (err.response?.data?.error || err.message));
    } finally {
      setLoadingMemoryList(false);
    }
  };

  const handleDeleteMemoryFile = async (botId: string, filename: string, workspace?: string) => {
    try {
      const workspaceParam = workspace ? `&workspace=${encodeURIComponent(workspace)}` : '';
      await api.delete(`/v1/openclaw/bots/memory/file?id=${botId}&filename=${encodeURIComponent(filename)}${workspaceParam}`);
      message.success(t('common.success'));
      fetchMemoryList(botId, workspace);
      if (selectedMemoryFile === filename) {
        setEditorContent('');
        setSelectedMemoryFile(null);
      }
    } catch (err: any) {
      message.error(t('common.error') + ': ' + (err.response?.data?.error || err.message));
    }
  };

  const handleSaveFileContent = async () => {
    try {
      setIsSaving(true);
      
      const bot = botsModels?.data?.bots?.find((b: any) => b.id === editorBotId);
      
      const params: any = {
        id: editorBotId,
        type: editorType === 'memory' ? (activeMemoryTab === 'long' ? 'memory' : 'memory_file') : editorType,
        content: editorContent,
        workspace: bot?.workspace
      };

      if (editorType === 'memory' && activeMemoryTab === 'daily' && selectedMemoryFile) {
        params.filename = selectedMemoryFile;
      }

      await api.post('/v1/openclaw/bots/file', params);
      message.success(t('bots.saveSuccess'));
      
      if (editorType === 'memory' && activeMemoryTab === 'daily') {
          // 仅刷新列表，不关闭 Modal 以便继续操作
          fetchMemoryList(editorBotId, bot?.workspace);
      } else {
          setIsEditorOpen(false);
      }
    } catch (err: any) {
      message.error(t('bots.saveFailed') + ': ' + (err.response?.data?.error || err.message));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetDefaultModel = (fullId: string) => {
    const confirmInstance = Modal.confirm({
      title: t('bots.confirmSwitchDefault'),
      content: t('bots.switchDefaultContent', { name: fullId }),
      okText: t('common.confirm'),
      cancelText: t('common.cancel'),
      onOk: () => {
        confirmInstance.destroy();
        // 在弹窗销毁后立刻执行异步业务
        (async () => {
          try {
            await onSetDefaultModel(fullId);
            await onRefresh();
            message.success(t('common.waitingGateway'));
          } catch (err: any) {
            message.error(err.message || 'Failed to set default model');
          }
        })();
      }
    });
  };

  return (
    <div style={{ height: '100%', minHeight: 'calc(100vh - 100px)', width: '100%', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {/* 允许在网关停止时通过 Buddy 管理机器人 */}
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '0' : '8px' }}>
        <div style={{ marginBottom: 24, padding: isMobile ? '0 8px' : '0' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 }}>
          <div>
            <h2 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, color: '#1e293b', margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
              <Boxes size={isMobile ? 24 : 28} color="#2563eb" />
              {t('bots.title')}
            </h2>
            <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>{t('bots.description')}</p>
          </div>
          
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {!isMobile && botsModels?.updated_at && (
                <span style={{ fontSize: 13, color: '#94a3b8', marginRight: 4 }}>
                  {t('bots.lastSynced')}: {dayjs(botsModels.updated_at).format('HH:mm:ss')}
                </span>
              )}
              <Button 
                icon={<RefreshCw size={16} className={loadingBots ? 'animate-spin' : ''} />} 
                onClick={onRefreshBots} 
                loading={loadingBots}
                style={{ borderRadius: 10, background: '#f1f5f9', border: 'none', color: '#64748b', fontWeight: 600 }}
              >
                {isMobile ? '' : t('common.refresh')}
              </Button>
              <Button 
                type="primary" 
                icon={<Plus size={18} />} 
                onClick={() => setIsModalOpen(true)}
                style={{ borderRadius: 10, height: 32, padding: isMobile ? '0 12px' : '0 20px', fontWeight: 600, boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)' }}
              >
                {isMobile ? '' : t('bots.addBot')}
              </Button>
            </div>
            
            {!isMobile && (
              <Segmented 
                value={botsViewMode} 
                onChange={(val: any) => setBotsViewMode(val)}
                options={[
                  { value: 'card', icon: <LayoutGrid size={14} /> },
                  { value: 'list', icon: <List size={14} /> }
                ]}
                style={{ borderRadius: 8, background: '#f1f5f9' }}
              />
            )}
          </div>
        </div>
      </div>

      {loadingBots && !botsModels ? (
        <div style={{ textAlign: 'center', padding: '100px 0' }}>
          <Spin size="large" tip={t('common.loading')} />
        </div>
      ) : (
        <Row gutter={[20, 20]}>
          <Col span={24}>
            {(!botsModels?.data?.bots || botsModels.data.bots.length === 0) ? (
              <div style={{ padding: '20px 0' }}>
                <Alert
                  message={
                    <span style={{ fontWeight: 600 }}>{t('bots.noBotsWarning')}</span>
                  }
                  type="warning"
                  showIcon
                  icon={<Activity size={20} />}
                  style={{ borderRadius: 12, border: '1px solid #fed7aa', backgroundColor: '#fff7ed' }}
                  action={
                    <Button 
                      size="small" 
                      type="primary" 
                      ghost 
                      onClick={onNavigateToDashboard}
                      style={{ borderRadius: 6, fontSize: 12 }}
                    >
                      {t('common.dashboard')}
                    </Button>
                  }
                />
              </div>
            ) : (botsViewMode === 'card' || isMobile) ? (
              <Row gutter={[20, 20]}>
                {botsModels.data.bots.map((bot: any, index: number) => {
                  const color = cardColors[index % cardColors.length];
                  return (
                    <Col xs={24} sm={12} md={8} lg={8} xl={8} key={bot.id}>
                      <Card
                        hoverable
                        styles={{ body: { padding: '16px 20px' } }}
                        style={{ 
                          borderRadius: 24, 
                          border: `1px solid ${color.border}`,
                          background: `linear-gradient(135deg, ${color.bg} 0%, #ffffff 100%)`, // 渐变底色
                          height: '100%',
                          transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)',
                          position: 'relative',
                          overflow: 'hidden',
                          boxShadow: `0 10px 25px -12px ${color.theme}40`, // 主题色阴影
                          opacity: isBotProcessing(bot.id) ? 0.7 : 1,
                          pointerEvents: isBotProcessing(bot.id) ? 'none' : 'auto'
                        }}
                        className="bot-card card-float"
                      >
                        {isBotProcessing(bot.id) && (
                          <div style={{ 
                            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
                            display: 'flex', alignItems: 'center', justifyContent: 'center', 
                            background: 'rgba(255,255,255,0.4)', zIndex: 10, backdropFilter: 'blur(2px)' 
                          }}>
                            <Spin tip={t('common.processing')} />
                          </div>
                        )}
                        <div style={{ position: 'absolute', top: 0, right: 0, width: 80, height: 80, background: `linear-gradient(135deg, transparent 50%, ${color.bg} 100%)`, opacity: 0.5, zIndex: 0 }}></div>
                        
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, position: 'relative', zIndex: 1 }}>
                           <div style={{ 
                             width: 52, height: 52, borderRadius: 16, 
                             background: '#ffffff', display: 'flex', 
                             alignItems: 'center', justifyContent: 'center',
                             boxShadow: `0 8px 20px -6px ${color.theme}30`,
                             border: `1.5px solid #ffffff`
                           }}>
                             {bot.emoji ? (
                               <span style={{ fontSize: 28, lineHeight: 1 }}>{bot.emoji}</span>
                             ) : (
                               <Bot size={28} color={color.theme} />
                             )}
                           </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            {onNavigateToChat && (
                              <Button
                                type="text"
                                size="small"
                                icon={<MessageSquare size={16} />}
                                onClick={() => onNavigateToChat(bot.id)}
                                style={{ color: '#0ea5e9' }}
                              />
                            )}
                            <Button type="text" size="small" icon={<Pencil size={16} />} onClick={() => handleEditClick(bot)} style={{ color: '#94a3b8' }} />
                            {bot.id !== 'main' && (
                              <Button type="text" size="small" icon={<Trash2 size={16} />} onClick={() => showDeleteConfirm(bot.id)} style={{ color: '#94a3b8' }} className="delete-hover" />
                            )}
                          </div>
                        </div>

                        <div style={{ position: 'relative', zIndex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                            <div style={{ fontSize: 20, fontWeight: 900, color: '#0f172a', letterSpacing: '-0.5px' }}>{bot.displayName || bot.name || bot.id}</div>
                            <div style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', border: '2px solid #fff', boxShadow: '0 0 10px rgba(34, 197, 94, 0.4)', flexShrink: 0 }} className="status-pulse" />
                            <div 
                              onClick={(e) => {
                                e.stopPropagation();
                                navigator.clipboard.writeText(bot.id);
                                message.success(t('common.copySuccess'));
                              }}
                              style={{ 
                                display: 'inline-flex', alignItems: 'center', gap: 6, 
                                padding: '2px 8px', background: '#f1f5f9', border: '1px solid #e2e8f0',
                                borderRadius: 6, cursor: 'pointer', transition: 'all 0.2s',
                                fontSize: 11, color: '#64748b', fontFamily: 'monospace', fontWeight: 600,
                                marginLeft: 4
                              }}
                              className="id-copy-tag"
                            >
                              <span style={{ opacity: 0.7 }}>#</span>
                              {bot.id}
                              <Copy size={10} style={{ opacity: 0.5 }} />
                            </div>
                          </div>
                          
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, marginTop: 4 }}>
                            <div style={{ display: 'flex', gap: 8 }}>
                              <Tooltip title={t('bots.editSoul')}>
                                <Button 
                                  type="text" 
                                  size="small" 
                                  icon={<Brain size={16} color="#8b5cf6" />} 
                                  onClick={() => handleOpenFileEditor(bot.id, 'soul')}
                                  style={{ 
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: 28, height: 28, borderRadius: 8, background: '#f5f3ff', 
                                    border: '1px solid #ddd6fe'
                                  }}
                                />
                              </Tooltip>
                              <Tooltip title={t('bots.editIdentity')}>
                                <Button 
                                  type="text" 
                                  size="small" 
                                  icon={<ShieldCheck size={16} color="#2563eb" />} 
                                  onClick={() => handleOpenFileEditor(bot.id, 'identity')}
                                  style={{ 
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: 28, height: 28, borderRadius: 8, background: '#eff6ff', 
                                    border: '1px solid #dbeafe'
                                  }}
                                />
                              </Tooltip>
                              <Tooltip title={t('bots.editMemory')}>
                                <Button 
                                  type="text" 
                                  size="small" 
                                  icon={<BrainCircuit size={16} color="#059669" />} 
                                  onClick={() => {
                                    setActiveMemoryTab('long');
                                    handleOpenFileEditor(bot.id, 'memory');
                                  }}
                                  style={{ 
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: 28, height: 28, borderRadius: 8, background: '#ecfdf5', 
                                    border: '1px solid #d1fae5'
                                  }}
                                />
                              </Tooltip>
                              <Tooltip title={t('bots.editHeartbeat')}>
                                <Button 
                                  type="text" 
                                  size="small" 
                                  icon={<Heart size={16} color="#f97316" />} 
                                  onClick={() => handleOpenFileEditor(bot.id, 'heartbeat')}
                                  style={{ 
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: 28, height: 28, borderRadius: 8, background: '#fff7ed', 
                                    border: '1px solid #ffedd5'
                                  }}
                                />
                              </Tooltip>
                              <Tooltip title={t('bots.editAgents')}>
                                <Button 
                                  type="text" 
                                  size="small" 
                                  icon={<Users size={16} color="#0891b2" />} 
                                  onClick={() => handleOpenFileEditor(bot.id, 'agents')}
                                  style={{ 
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    width: 28, height: 28, borderRadius: 8, background: '#ecfeff', 
                                    border: '1px solid #cffafe'
                                  }}
                                />
                              </Tooltip>
                            </div>
                          </div>
                          
                          <div style={{ background: 'rgba(255, 255, 255, 0.5)', backdropFilter: 'blur(8px)', padding: '10px 14px', borderRadius: 18, border: `1px solid ${color.border}60` }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, flexShrink: 0 }}>
                                  {t('bots.currentModel')}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '65%', overflow: 'hidden' }}>
                                  <Cpu size={12} color={color.theme} style={{ flexShrink: 0 }} />
                                  <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {bot.model}
                                  </span>
                                </div>
                              </div>
                              <div style={{ height: 1, borderTop: `1px dashed ${color.border}40`, margin: '0' }}></div>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 800, flexShrink: 0 }}>
                                  {t('bots.workspace')}
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, maxWidth: '65%', overflow: 'hidden' }}>
                                  <FolderOpen size={12} color="#64748b" style={{ flexShrink: 0 }} />
                                  <span 
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (bot.workspace) {
                                        setExplorerPath(bot.workspace);
                                        setExplorerTitle(`${bot.name} ${t('bots.workspace')}`);
                                        setExplorerOpen(true);
                                      }
                                    }}
                                    style={{ 
                                      fontSize: 11, 
                                      fontWeight: 700, 
                                      color: '#0ea5e9', 
                                      overflow: 'hidden', 
                                      textOverflow: 'ellipsis', 
                                      whiteSpace: 'nowrap', 
                                      fontFamily: 'monospace',
                                      cursor: 'pointer',
                                      textDecoration: 'underline',
                                      textDecorationStyle: 'dotted'
                                    }}
                                  >
                                    {bot.workspace?.length > 18 ? bot.workspace.substring(0, 8) + '...' + bot.workspace.substring(bot.workspace.length - 8) : bot.workspace}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            ) : (
              <Card style={{ borderRadius: 16, border: '1px solid #e2e8f0' }} styles={{ body: { padding: 0 } }}>
                <Table 
                  dataSource={botsModels?.data?.bots || []} 
                  pagination={false}
                  rowKey="id"
                  columns={[
                    { title: t('bots.botId'), dataIndex: 'id', key: 'id', render: (id: string, record: any) => {
                      const modelProvider = record.model?.includes('/') ? record.model.split('/')[0] : (record.provider || (id === 'main' ? 'openai' : ''));
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <ProviderIcon provider={modelProvider} size={20} />
                          <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{id}</span>
                        </div>
                      );
                    }},
                    { title: t('bots.displayName'), dataIndex: 'name', key: 'name', render: (name: string, record: any) => name || record.id },
                    { title: t('bots.currentModel'), dataIndex: 'model', key: 'model', render: (m: string) => <Tag color="blue" style={{ borderRadius: 6 }}>{m}</Tag> },
                    { title: t('common.action'), key: 'action', width: 120, render: (_, record: any) => (
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button size="small" type="text" icon={<Pencil size={14} />} onClick={() => handleEditClick(record)} />
                        {record.id !== 'main' && (
                          <Button size="small" type="text" danger icon={<Trash2 size={14} />} onClick={() => showDeleteConfirm(record.id)} />
                        )}
                      </div>
                    )}
                  ]}
                />
              </Card>
            )}
          </Col>

          <Col span={24}>
            <Card
              title={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                    <Cpu size={isMobile ? 18 : 20} color="#6366f1" /> 
                    <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: '#1e293b' }}>{t('bots.modelLegion')}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {!isMobile && (
                      <Segmented 
                        value={modelsViewMode} 
                        onChange={(val: any) => setModelsViewMode(val)}
                        options={[
                          { value: 'card', icon: <LayoutGrid size={12} /> },
                          { value: 'list', icon: <List size={12} /> }
                        ]}
                        style={{ borderRadius: 8, background: '#f1f5f9', marginRight: 8 }}
                      />
                    )}
                    <Button 
                      type="primary" 
                      ghost 
                      size="small" 
                      icon={<ShieldCheck size={14} />} 
                      onClick={() => setIsProviderModalOpen(true)}
                      style={{ borderRadius: 8, fontSize: 12, height: 28 }}
                    >
                      {isMobile ? t('bots.channel') : t('bots.addChannel')}
                    </Button>
                    <Button 
                      type="primary" 
                      ghost 
                      size="small" 
                      icon={<Plus size={14} />} 
                      onClick={() => setIsModelModalOpen(true)}
                      style={{ borderRadius: 8, fontSize: 12, height: 28 }}
                    >
                      {isMobile ? t('bots.model') : t('bots.addModel')}
                    </Button>
                  </div>
                </div>
              }
              styles={{ body: { padding: '20px' } }}
              style={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', width: '100%' }}
            >
              {loadingConfig && !modelsConfig ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}><Spin size="small" tip={t('common.syncing')} /></div>
              ) : modelsConfig ? (
                Object.entries(modelsConfig).map(([providerName, providerData]: [string, any]) => {
                  const providerModels = (providerData.models || []);

                  return (
                    <div key={providerName} style={{ marginBottom: 28 }}>
                      <div 
                        style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, paddingLeft: 4, cursor: 'pointer', userSelect: 'none' }}
                        onClick={() => {
                          const newCollapsed = new Set(collapsedProviders);
                          if (newCollapsed.has(providerName)) {
                            newCollapsed.delete(providerName);
                          } else {
                            newCollapsed.add(providerName);
                          }
                          setCollapsedProviders(newCollapsed);
                        }}
                      >
                        <div style={{ width: 4, height: 16, background: '#6366f1', borderRadius: 2 }}></div>
                        <span style={{ fontWeight: 800, color: '#475569', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {providerName} ({providerModels.length})
                        </span>
                        {isProviderProcessing(providerName) && <Spin size="small" style={{ marginLeft: 4 }} />}
                        <Button 
                          type="text" 
                          size="small" 
                          icon={<Pencil size={12} />} 
                          disabled={isProviderProcessing(providerName)}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleEditProvider(providerName, providerData);
                          }}
                          style={{ color: '#94a3b8', padding: 0, height: 18, width: 18, marginLeft: -4 }}
                        />
                        <Button 
                          type="text" 
                          size="small" 
                          danger
                          icon={<Trash2 size={12} />} 
                          disabled={isProviderProcessing(providerName)}
                          loading={isProviderProcessing(providerName)}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteProvider(providerName);
                          }}
                          style={{ color: '#ef4444', padding: 0, height: 18, width: 18, marginLeft: 4 }}
                        />
                        {collapsedProviders.has(providerName) ? <ChevronUp size={14} color="#94a3b8" /> : <ChevronDown size={14} color="#94a3b8" />}
                        <div style={{ height: 1, flex: 1, background: '#f1f5f9', marginLeft: 8 }}></div>
                      </div>
                      {!collapsedProviders.has(providerName) && (
                        providerModels.length > 0 ? (
                          (modelsViewMode === 'card' || isMobile) ? (
                            <Row gutter={[16, 16]}>
                            {providerModels.map((m: any, mIdx: number) => {
                              const isDefault = botsModels?.data?.models?.find((dm: any) => dm.id === `${providerName}/${m.id}`)?.isDefault;
                              const color = cardColors[mIdx % cardColors.length];
                              
                              return (
                                <Col xs={24} sm={12} md={8} lg={8} xl={8} key={m.id}>
                                  <div style={{
                                    background: isDefault 
                                      ? `linear-gradient(135deg, #f5f3ff 0%, #ffffff 100%)` 
                                      : `linear-gradient(135deg, ${color.bg} 0%, #ffffff 100%)`,
                                    padding: '18px',
                                    borderRadius: 18,
                                    border: isDefault ? '2px solid #a78bfa' : `1px solid ${color.border}`,
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 12,
                                    position: 'relative',
                                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                    boxShadow: isDefault 
                                      ? '0 10px 20px -5px rgba(139, 92, 246, 0.2)' 
                                      : `0 4px 12px -4px ${color.theme}20`,
                                    cursor: 'default',
                                    opacity: isModelProcessing(`${providerName}/${m.id}`) ? 0.7 : 1,
                                    pointerEvents: isModelProcessing(`${providerName}/${m.id}`) ? 'none' : 'auto'
                                  }} className="model-card card-float">
                                    {isModelProcessing(`${providerName}/${m.id}`) && (
                                      <div style={{ 
                                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, 
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', 
                                        background: 'rgba(255,255,255,0.4)', zIndex: 10, backdropFilter: 'blur(2px)',
                                        borderRadius: 18
                                      }}>
                                        <Spin size="small" />
                                      </div>
                                    )}
                                    {isDefault && (
                                      <div style={{
                                        position: 'absolute', top: -10, right: 12,
                                        background: '#7c3aed', color: '#fff', fontSize: 9,
                                        padding: '2px 10px', borderRadius: 20, fontWeight: 800,
                                        boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)', 
                                        display: 'flex', alignItems: 'center', gap: 4,
                                        zIndex: 2, letterSpacing: '0.02em'
                                      }}>
                                        {t('bots.default')}
                                      </div>
                                    )}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                      <div style={{ 
                                        width: 38, height: 38, borderRadius: 10, background: isDefault ? '#ede9fe' : '#f8fafc',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)',
                                        flexShrink: 0
                                      }}>
                                        <Cpu size={18} color={isDefault ? '#7c3aed' : '#94a3b8'} />
                                      </div>
                                      <div style={{ minWidth: 0, flex: 1 }}>
                                        <Tooltip title={m.name || m.id}>
                                          <div style={{ fontWeight: 800, color: '#1e293b', fontSize: 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
                                            {m.name || m.id}
                                            {testLatencyMap[providerName + '/' + m.id] && (
                                              <Tag color={testLatencyMap[providerName + '/' + m.id].latency > 0 ? 'success' : 'error'} style={{ margin: 0, fontSize: 10, padding: '0 4px', borderRadius: 4, height: 16, lineHeight: '14px', border: 'none', background: testLatencyMap[providerName + '/' + m.id].latency > 0 ? '#f0fdf4' : '#fef2f2', color: testLatencyMap[providerName + '/' + m.id].latency > 0 ? '#16a34a' : '#ef4444' }}>
                                                {testLatencyMap[providerName + '/' + m.id].latency > 0 ? `${testLatencyMap[providerName + '/' + m.id].latency}ms` : t('bots.fail')}
                                              </Tag>
                                            )}
                                          </div>
                                        </Tooltip>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', opacity: 0.8 }}>
                                          <span>ID: {m.id}</span>
                                          <Button
                                            type="text"
                                            size="small"
                                            icon={<Copy size={10} />}
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              navigator.clipboard.writeText(m.id);
                                              message.success(t('common.copySuccess'));
                                            }}
                                            style={{ color: '#cbd5e1', padding: 0, height: 16, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', minWidth: 16 }}
                                          />
                                        </div>
                                      </div>
                                    </div>
    
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                         {m.reasoning && (
                                           <Tag color="orange" style={{ margin: 0, borderRadius: 6, fontSize: 10, border: 'none', background: '#fff7ed', color: '#f59e0b', fontWeight: 700, padding: '0 6px' }}>
                                             <Zap size={10} style={{ marginRight: 2, display: 'inline-block', verticalAlign: 'middle' }} /> {t('bots.reasoningType')}
                                           </Tag>
                                         )} 
                                      </div>
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<Zap size={14} className={testingModelId === `${providerName}/${m.id}` ? 'animate-pulse' : ''} />}
                                            loading={testingModelId === `${providerName}/${m.id}`}
                                            onClick={() => handleTestModel(providerName, m.id)}
                                            style={{ color: testingModelId === `${providerName}/${m.id}` ? '#f59e0b' : '#cbd5e1', padding: 0, height: 24, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                        />
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<Pencil size={14} />}
                                            onClick={() => handleEditModel(providerName, m)}
                                            style={{ color: '#cbd5e1', padding: 0, height: 24, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                        />
                                        {!isDefault && (
                                          <Button 
                                            type="text" 
                                            size="small" 
                                            icon={<Star size={14} className={isModelProcessing(`${providerName}/${m.id}`) ? 'animate-spin' : ''} />} 
                                            loading={isModelProcessing(`${providerName}/${m.id}`)}
                                            onClick={() => handleSetDefaultModel(`${providerName}/${m.id}`)}
                                            style={{ color: '#cbd5e1', padding: 0, height: 24, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                          />
                                        )}
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<Trash2 size={14} />}
                                            onClick={() => handleDeleteModel(providerName, m.id)}
                                            style={{ color: '#cbd5e1', padding: 0, height: 24, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                            className="delete-hover"
                                        />
                                      </div>
                                    </div>
                                  </div>
                                </Col>
                              );
                            })}
                          </Row>
                        ) : (
                          <Table 
                            size="small"
                            dataSource={providerModels}
                            pagination={false}
                            rowKey="id"
                            columns={[
                              { title: 'ID', dataIndex: 'id', key: 'id', render: (id: string) => <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{id}</span> },
                              { title: t('bots.displayName'), dataIndex: 'name', key: 'name', render: (name: string, r: any) => name || r.id },
                              { title: t('bots.api'), dataIndex: 'api', key: 'api', render: (api: string) => <Tag style={{ borderRadius: 4, fontSize: 10 }}>{api}</Tag> },
                              { title: t('bots.latency'), key: 'latency', width: 100, render: (_, r: any) => {
                                const lat = testLatencyMap[providerName + '/' + r.id]?.latency;
                                if (lat === undefined) return '-';
                                return <Tag color={lat > 0 ? 'success' : 'error'}>{lat > 0 ? `${lat}ms` : t('bots.fail')}</Tag>;
                              }},
                              { title: t('common.action'), key: 'action', width: 150, render: (_, r: any) => {
                                const fullId = `${providerName}/${r.id}`;
                                const rowIsDefault = !!botsModels?.data?.models?.find((dm: any) => dm.id === fullId)?.isDefault;
                                return (
                                  <div style={{ display: 'flex', gap: 4 }}>
                                    <Button size="small" type="text" icon={<Zap size={14} />} onClick={() => handleTestModel(providerName, r.id)} loading={testingModelId === fullId} />
                                    <Button size="small" type="text" icon={<Pencil size={14} />} onClick={() => handleEditModel(providerName, r)} />
                                    {!rowIsDefault && (
                                      <Button size="small" type="text" icon={<Star size={14} />} onClick={() => handleSetDefaultModel(fullId)} />
                                    )}
                                    <Button size="small" type="text" danger icon={<Trash2 size={14} />} onClick={() => handleDeleteModel(providerName, r.id)} />
                                  </div>
                                );
                              }}
                            ]}
                          />
                        )
                      ) : (
                        <div style={{ textAlign: 'center', padding: '20px', background: '#f8fafc', borderRadius: 12, border: '1px dashed #e2e8f0', marginBottom: 28 }}>
                          <Empty description={t('common.noContent')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                        </div>
                      )
                    )}
                    </div>
                  );
                })
              ) : (
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>{t('bots.noModelGroups')}</div>
              )}
            </Card>
          </Col>

          <Col span={24}>
            <Card
              title={
                <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', width: '100%', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <History size={isMobile ? 18 : 20} color="#f59e0b" /> 
                    <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: '#1e293b' }}>{t('bots.recentSessions')}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-end' }}>
                    <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>
                      {t('bots.realtimeSync')}
                    </span>
                    <Button 
                      type="text"
                      size="small" 
                      icon={<RefreshCw size={14} className={loadingSessions ? 'animate-spin' : ''} />} 
                      onClick={() => fetchSessions(true)}
                      loading={loadingSessions}
                      style={{ color: '#64748b', display: 'flex', alignItems: 'center', padding: isMobile ? '0 4px' : '0 8px' }}
                    >
                      {isMobile ? '' : t('common.refresh')}
                    </Button>
                  </div>
                </div>
              }
              styles={{ body: { padding: isMobile ? '0' : '16px 20px' } }}
              style={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', width: '100%' }}
            >
              <Table 
                dataSource={sessions} 
                loading={loadingSessions}
                rowKey="key"
                pagination={false}
                size={isMobile ? "small" : "middle"}
                scroll={{ x: 'max-content' }}
                columns={[
                  {
                    title: t('bots.sessionKey'),
                    dataIndex: 'key',
                    key: 'key',
                    render: (text: string) => (
                      <Tooltip title={text}>
                        <div style={{ maxWidth: isMobile ? 80 : 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 13 }}>
                          {text}
                        </div>
                      </Tooltip>
                    )
                  },
                  {
                    title: t('bots.agent'),
                    dataIndex: 'agentId',
                    key: 'agentId',
                    render: (id: string) => <Tag color="blue" style={{ borderRadius: 6, margin: 0 }}>{id}</Tag>
                  },
                  {
                    title: t('bots.activeTime'),
                    dataIndex: 'ageMs',
                    key: 'ageMs',
                    render: (ms: number) => <span style={{ color: '#64748b', fontSize: 13 }}>{formatAgeMs(ms)}</span>
                  },
                  {
                    title: t('bots.usingModel'),
                    dataIndex: 'model',
                    key: 'model',
                    render: (m: string) => <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 13 }}>{m}</span>
                  },
                  {
                    title: t('bots.tokenUsage'),
                    key: 'tokens',
                    render: (_, record: any) => {
                      const ctx = Number(record.contextTokens) || 0;
                      const used = Number(record.totalTokens) || 0;
                      const percent = ctx > 0 ? Math.round((used / ctx) * 100) : 0;
                      const safePercent = Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
                      let color = '#22c55e';
                      if (safePercent > 80) color = '#ef4444';
                      else if (safePercent > 50) color = '#f59e0b';

                      const ctxK = ctx > 0 ? Math.round(ctx / 1000) : 0;
                      const usedK = Math.round(used / 1000);

                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: isMobile ? 80 : 120 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                            <span>{usedK}k / {ctx > 0 ? `${ctxK}k` : '—'}</span>
                            {!isMobile && ctx > 0 && <span style={{ fontWeight: 700, color }}>{safePercent}%</span>}
                          </div>
                          <div style={{ width: '100%', height: 4, background: '#f1f5f9', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ width: `${ctx > 0 ? safePercent : 0}%`, height: '100%', background: color, transition: 'width 0.3s ease' }} />
                          </div>
                        </div>
                      );
                    }
                  },
                  ...(!isMobile ? [{
                    title: t('bots.type'),
                    dataIndex: 'kind',
                    key: 'kind',
                    render: (k: string) => <Tag style={{ borderRadius: 6, margin: 0 }}>{String(k).toUpperCase()}</Tag>
                  }] : [])
                ]}
              />
            </Card>
          </Col>
        </Row>
      )}
      {/* 添加机器人对话框 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ padding: 6, background: '#eff6ff', borderRadius: 8 }}><Boxes size={18} color="#2563eb" /></div>
            <span>{t('bots.addBotTitle')}</span>
          </div>
        }
        open={isModalOpen}
        onOk={handleOk}
        onCancel={() => setIsModalOpen(false)}
        confirmLoading={adding}
        okText={t('bots.confirmCreate')}
        cancelText={t('common.cancel')}
        centered
        style={{ borderRadius: 16 }}
      >
        <div style={{ padding: '8px 0' }}>
          <Form form={form} layout="vertical" initialValues={{ id: '', model: '' }}>
            <Form.Item
              label={t('bots.botId')}
              name="id"
              rules={[
                { required: true, message: t('bots.botIdRequired') },
                { pattern: /^[a-zA-Z0-9_]+$/, message: t('bots.botIdPattern') }
              ]}
              extra={<span style={{ fontSize: 11, color: '#94a3b8' }}>{t('bots.idFormatTip')}: <code style={{ background: '#f1f5f9', padding: '1px 4px' }}>dev_bot</code>. {t('bots.workspaceAutoTip')} <code style={{ background: '#f1f5f9', padding: '1px 4px' }}>~/.openclaw/workspace_[id]</code></span>}
            >
              <Input placeholder={t('bots.botIdPlaceholder')} />
            </Form.Item>
            
            <Form.Item
              label={t('bots.selectModel')}
              name="model"
              rules={[{ required: true, message: t('bots.selectModelRequired') }]}
            >
              <Select 
                placeholder={t('bots.selectModelPlaceholder')} 
                dropdownStyle={{ borderRadius: 12 }}
                showSearch
                optionFilterProp="label"
              >
                {/* 按 Provider 分组展示 */}
                {Object.entries(
                  (botsModels?.data?.models || []).reduce((acc: any, m: any) => {
                    // 如果 ID 是 provider/model 格式，则取 / 前面的
                    const p = m.id.includes('/') ? m.id.split('/')[0] : (m.provider || 'Others');
                    if (!acc[p]) acc[p] = [];
                    acc[p].push(m);
                    return acc;
                  }, {})
                ).map(([provider, models]: [string, any]) => (
                  <Select.OptGroup key={provider} label={provider.toUpperCase()}>
                    {models.map((m: any) => (
                      <Select.Option key={m.id} value={m.id} label={m.name}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>{m.name || m.id}</span>
                          <span style={{ fontSize: 10, color: '#94a3b8' }}>{m.id}</span>
                        </div>
                      </Select.Option>
                    ))}
                  </Select.OptGroup>
                ))}
              </Select>
            </Form.Item>
          </Form>
        </div>
      </Modal>

      {/* 渠道管理对话框 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ padding: 6, background: '#f5f3ff', borderRadius: 8 }}><ShieldCheck size={18} color="#7c3aed" /></div>
            <span>{isEditingProvider ? `${t('common.edit')} ${editingProviderName}` : t('bots.addProviderTitle')}</span>
          </div>
        }
        open={isProviderModalOpen}
        onCancel={() => {
          setIsProviderModalOpen(false);
          setIsEditingProvider(false);
          setEditingProviderName(null);
          configForm.resetFields();
        }}
        footer={null}
        width={550}
        centered
        style={{ borderRadius: 16 }}
      >
        <div style={{ padding: '8px 0' }}>
            <Form form={configForm} layout="vertical">
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Item label={t('bots.providerId')} name="name" rules={[{ required: true, message: t('bots.providerIdRequired') }]} extra={t('bots.providerIdTip')} hidden={isEditingProvider}>
                    <Input placeholder={t('bots.providerIdPlaceholder')} />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item label={t('bots.baseUrl')} name="baseUrl" rules={[{ required: true, message: t('bots.baseUrlRequired') }]}>
                    <Input placeholder="https://api.example.com/v1" />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item label={t('bots.apiKey')} name="apiKey" rules={[{ required: true, message: t('bots.apiKeyRequired') }]}>
                    <Input.Password placeholder="sk-..." />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={t('bots.authType')} name="auth" initialValue="api-key">
                    <Select options={[{ label: 'API Key', value: 'api-key' }]} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={t('bots.apiProtocol')} name="api" initialValue="openai-completions">
                    <Select options={[{ label: t('bots.protocolOpenAICompletions'), value: 'openai-completions' }]} />
                  </Form.Item>
                </Col>
              </Row>
              <Button type="primary" block onClick={handleAddProvider} loading={submittingConfig} icon={isEditingProvider ? <Pencil size={16} /> : <Plus size={16} />} style={{ marginTop: 8, height: 40, borderRadius: 10 }}>
                {t('bots.saveConfig')}
              </Button>
            </Form>
        </div>
      </Modal>

      {/* 模型追加对话框 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ padding: 6, background: '#f5f3ff', borderRadius: 8 }}><Cpu size={18} color="#7c3aed" /></div>
            <span>{isEditingModel ? t('bots.editModelTitle') : t('bots.addNewModelTitle')}</span>
          </div>
        }
        open={isModelModalOpen}
        onCancel={() => {
          setIsModelModalOpen(false);
          setIsEditingModel(false);
          modelForm.resetFields();
        }}
        footer={null}
        width={550}
        centered
        style={{ borderRadius: 16 }}
      >
        <div style={{ padding: '8px 0' }}>
            <Form 
              form={modelForm} 
              layout="vertical"
              preserve={true}
              initialValues={{ 
                reasoning: false, 
                api: 'openai-completions',
                input: ['text'],
                maxTokens: 2000000,
                contextWindow: 2000000
              }}
            >
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item label={t('bots.selectProvider')} name="provider_name" rules={[{ required: true, message: t('bots.selectProviderRequired') }]}>
                    <Select placeholder={t('bots.selectProviderPlaceholder')} allowClear disabled={isEditingModel}>
                      {modelsConfig && Object.keys(modelsConfig).map(name => (
                        <Select.Option key={name} value={name}>{name}</Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={t('bots.modelId')} name="id" rules={[{ required: true, message: t('bots.modelIdRequired') }]}>
                    <Input placeholder={t('bots.modelIdPlaceholder')} disabled={isEditingModel} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={t('bots.displayName')} name="name">
                    <Input placeholder={t('bots.displayNamePlaceholder')} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={t('bots.apiProtocol')} name="api">
                    <Select options={[
                      { label: t('bots.protocolOpenAICompletions'), value: 'openai-completions' },
                      { label: t('bots.protocolOpenAIResponses'), value: 'openai-responses' },
                      { label: t('bots.protocolOpenAICodexResponses'), value: 'openai-codex-responses' },
                      { label: t('bots.protocolAnthropicMessages'), value: 'anthropic-messages' },
                      { label: t('bots.protocolGoogleGenerativeAI'), value: 'google-generative-ai' },
                      { label: t('bots.protocolGitHubCopilot'), value: 'github-copilot' },
                      { label: t('bots.protocolBedrockConverseStream'), value: 'bedrock-converse-stream' },
                      { label: t('bots.protocolOllama'), value: 'ollama' }
                    ]} />
                  </Form.Item>
                </Col>
                 <Col span={24}>
                  <Form.Item label={t('bots.capabilities')} name="input">
                    <Select mode="multiple" placeholder={t('bots.capabilitiesPlaceholder')} options={[
                      { label: `Text (${t('bots.text')})`, value: 'text' },
                      { label: `Image (${t('bots.image')})`, value: 'image' },
                      { label: `Audio (${t('bots.audio')})`, value: 'audio' }
                    ]} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={t('bots.contextWindow')} name="contextWindow" rules={[{ required: true, message: t('bots.modelIdRequired') }]}>
                    <Input type="number" placeholder="2000000" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label={t('bots.maxTokens')} name="maxTokens" rules={[{ required: true, message: t('bots.modelIdRequired') }]}>
                    <Input type="number" placeholder="2000000" />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: 12, border: '1px solid #f1f5f9', marginBottom: 20 }}>
                     <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Zap size={18} color="#f59e0b" />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>{t('bots.enableReasoning')}</div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>{t('bots.reasoningDesc')}</div>
                          </div>
                        </div>
                        <Form.Item name="reasoning" valuePropName="checked" noStyle>
                           <Checkbox />
                        </Form.Item>
                      </div>
                  </div>
                </Col>
              </Row>
              <Button type="primary" block onClick={handleAddModelToProvider} loading={submittingConfig} icon={isEditingModel ? <Save size={16} /> : <Plus size={16} />} style={{ marginTop: 8, height: 40, borderRadius: 10 }}>
                {isEditingModel ? t('bots.updateModel') : t('bots.appendModel')}
              </Button>
            </Form>
        </div>
      </Modal>

      {/* 修改名称对话框 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ padding: 6, background: '#fef2f2', borderRadius: 8 }}><Pencil size={18} color="#ef4444" /></div>
            <span>{t('bots.editNameTitle')}</span>
          </div>
        }
        open={isEditModalOpen}
        onOk={handleEditOk}
        onCancel={() => setIsEditModalOpen(false)}
        confirmLoading={processing}
        okText={t('common.confirm')}
        cancelText={t('common.cancel')}
        centered
      >
        <div style={{ padding: '8px 0' }}>
          <Form form={editForm} layout="vertical">
            <Form.Item label={t('bots.currentId')}>
              <Input value={editingBot?.id} disabled />
            </Form.Item>
            <Form.Item
              label={t('bots.newDisplayName')}
              name="name"
              rules={[{ required: true, message: t('bots.newDisplayNameRequired') }]}
            >
              <Input placeholder={t('bots.newDisplayNamePlaceholder')} autoFocus />
            </Form.Item>
            <Form.Item 
              label={t('bots.defaultModel')} 
              name="model" 
              rules={[{ required: true, message: t('bots.selectModelRequired') }]}
            >
              <Select 
                placeholder={t('bots.botDefaultModelPlaceholder')}
                dropdownStyle={{ borderRadius: 12 }}
                showSearch
                optionFilterProp="label"
              >
                {/* 按 Provider 分组展示 */}
                {Object.entries(
                  (botsModels?.data?.models || []).reduce((acc: any, m: any) => {
                    const p = m.id.includes('/') ? m.id.split('/')[0] : (m.provider || 'Others');
                    if (!acc[p]) acc[p] = [];
                    acc[p].push(m);
                    return acc;
                  }, {})
                ).map(([provider, models]: [string, any]) => (
                  <Select.OptGroup key={provider} label={provider.toUpperCase()}>
                    {models.map((m: any) => (
                      <Select.Option key={m.id} value={m.id} label={m.name}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontWeight: 600, fontSize: 13 }}>{m.name || m.id}</span>
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>{m.id}</span>
                        </div>
                      </Select.Option>
                    ))}
                  </Select.OptGroup>
                ))}
              </Select>
            </Form.Item>
          </Form>
        </div>
      </Modal>

      {/* 删除确认受控对话框 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ padding: 6, background: '#fef2f2', borderRadius: 8 }}><Trash2 size={18} color="#ef4444" /></div>
            <span>{t('bots.removeBotTitle')}</span>
          </div>
        }
        open={isDeleteModalOpen}
        onOk={handleConfirmDelete}
        onCancel={() => setIsDeleteModalOpen(false)}
        okText={t('bots.removeBotConfirm')}
        cancelText={t('common.cancel')}
        okButtonProps={{ danger: true }}
        centered
      >
        <div style={{ padding: '8px 0' }}>
          <p style={{ color: '#ef4444', fontWeight: 600 }}>{t('bots.removeBotWarning', { id: deletingBotId })}</p>
          <p style={{ color: '#64748b', fontSize: 13 }}>{t('bots.irreversible')}</p>
        </div>
      </Modal>

      {/* 机器人核心人格/身份/记忆编辑器 (分屏预览模式) */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ 
              padding: 8, 
              background: editorType === 'soul' ? 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)' : 
                         editorType === 'identity' ? 'linear-gradient(135deg, #2563eb 0%, #3b82f6 100%)' : 
                         editorType === 'heartbeat' ? 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)' :
                         editorType === 'agents' ? 'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)' :
                         'linear-gradient(135deg, #059669 0%, #10b981 100%)', 
              borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.2)'
            }}>
              {editorType === 'soul' ? <Brain size={18} color="#fff" /> : 
               editorType === 'identity' ? <ShieldCheck size={18} color="#fff" /> : 
               editorType === 'heartbeat' ? <Heart size={18} color="#fff" /> :
               editorType === 'agents' ? <Users size={18} color="#fff" /> :
               <BrainCircuit size={18} color="#fff" />}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b', marginBottom: 2 }}>
                {editorType === 'soul' ? t('bots.editSoul') : 
                 editorType === 'identity' ? t('bots.editIdentity') : 
                 editorType === 'heartbeat' ? t('bots.editHeartbeat') :
                 editorType === 'agents' ? t('bots.editAgents') :
                 t('bots.editMemory')}
              </div>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
                {editorBotId} · {editorType === 'soul' ? 'SOUL.md' : 
                              editorType === 'identity' ? 'IDENTITY.md' : 
                              editorType === 'heartbeat' ? 'HEARTBEAT.md' :
                              editorType === 'agents' ? 'AGENTS.md' :
                              (selectedMemoryFile || 'MEMORY.md')}
              </div>
            </div>
            {editorType === 'memory' && (
              <Tabs 
                size="small" 
                activeKey={activeMemoryTab} 
                onChange={(key: any) => {
                  setActiveMemoryTab(key);
                  if (key === 'long') {
                    handleOpenFileEditor(editorBotId, 'memory', undefined, 'long');
                  } else {
                    const bot = botsModels?.data?.bots?.find((b: any) => b.id === editorBotId);
                    fetchMemoryList(editorBotId, bot?.workspace);
                    setEditorContent('');
                    setSelectedMemoryFile(null);
                  }
                }}
                className="memory-tabs"
                style={{ marginBottom: -16, marginRight: 24 }}
                items={[
                  { key: 'long', label: t('bots.longTermMemory') },
                  { key: 'daily', label: t('bots.dailyMemory') }
                ]}
              />
            )}
          </div>
        }
        open={isEditorOpen}
        onCancel={() => setIsEditorOpen(false)}
        footer={[
          <Button key="cancel" onClick={() => setIsEditorOpen(false)} style={{ borderRadius: 8 }}>
            {t('common.cancel')}
          </Button>,
          <Button 
            key="save" 
            type="primary" 
            loading={isSaving} 
            icon={<Save size={14} />} 
            onClick={handleSaveFileContent} 
            disabled={editorType === 'memory' && activeMemoryTab === 'daily' && !selectedMemoryFile}
            style={{ 
              borderRadius: 8, 
              background: editorType === 'soul' ? '#8b5cf6' : (editorType === 'identity' ? '#2563eb' : '#059669'), 
              border: 'none' 
            }}
          >
            {t('common.save')}
          </Button>
        ]}
        width={isMobile ? '100%' : (editorType === 'memory' && activeMemoryTab === 'daily' ? 1200 : 1000)}
        centered
        bodyStyle={{ padding: '0', height: isMobile ? 'calc(100vh - 120px)' : '75vh', overflow: 'hidden' }}
      >
        <Spin 
          spinning={isEditorLoading || isSaving} 
          tip={isSaving ? t('common.processing') : t('common.loading')}
          style={{ height: '100%' }}
          wrapperClassName="bot-editor-spin-wrapper"
        >
          <div style={{ display: 'flex', height: '100%', flexDirection: isMobile ? 'column' : 'row' }}>
            {/* 记忆文件列表 (仅在日期记忆 Tab 显示) */}
            {editorType === 'memory' && activeMemoryTab === 'daily' && (
              <div style={{ width: 240, borderRight: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: '#475569' }}>{t('bots.dailyMemory')}</span>
                  <Tooltip title={t('bots.addMemoryFile')}>
                    <Button 
                      size="small" 
                      type="text" 
                      icon={<Plus size={14} />} 
                      onClick={() => {
                        const bot = botsModels?.data?.bots?.find((b: any) => b.id === editorBotId);
                        const today = dayjs().format('YYYY-MM-DD');
                        Modal.confirm({
                          title: t('bots.addMemoryFile'),
                          content: (
                            <div style={{ marginTop: 16 }}>
                              <Input id="new-memory-filename" defaultValue={`${today}.md`} placeholder="YYYY-MM-DD.md" />
                            </div>
                          ),
                          onOk: async () => {
                            const filename = (document.getElementById('new-memory-filename') as HTMLInputElement).value;
                            if (filename) {
                              setSelectedMemoryFile(filename);
                              setEditorContent('');
                              // 自动触发一次保存来创建文件
                              await api.post('/v1/openclaw/bots/file', {
                                id: editorBotId,
                                type: 'memory_file',
                                filename: filename,
                                content: '# ' + filename.replace('.md', ''),
                                workspace: bot?.workspace
                              });
                              fetchMemoryList(editorBotId, bot?.workspace);
                              handleOpenFileEditor(editorBotId, 'memory', filename);
                            }
                          }
                        });
                      }} 
                    />
                  </Tooltip>
                </div>
                <div style={{ flex: 1, overflowY: 'auto' }}>
                  <AntList
                    loading={loadingMemoryList}
                    dataSource={memoryFiles}
                    renderItem={item => (
                      <AntList.Item 
                        onClick={() => handleOpenFileEditor(editorBotId, 'memory', item)}
                        style={{ 
                          padding: '10px 16px', 
                          cursor: 'pointer',
                          background: selectedMemoryFile === item ? '#fff' : 'transparent',
                          borderLeft: selectedMemoryFile === item ? '3px solid #10b981' : '3px solid transparent',
                          transition: 'all 0.2s'
                        }}
                        className="memory-list-item"
                      >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                          <span style={{ fontSize: 13, color: selectedMemoryFile === item ? '#059669' : '#64748b', fontWeight: selectedMemoryFile === item ? 700 : 500 }}>{item}</span>
                          <Popconfirm
                            title={t('bots.confirmDeleteMemory')}
                            onConfirm={(e) => {
                              e?.stopPropagation();
                              const bot = botsModels?.data?.bots?.find((b: any) => b.id === editorBotId);
                              handleDeleteMemoryFile(editorBotId, item, bot?.workspace);
                            }}
                            onCancel={(e) => e?.stopPropagation()}
                          >
                            <Button size="small" type="text" icon={<Trash2 size={12} />} onClick={e => e.stopPropagation()} style={{ color: '#94a3b8' }} />
                          </Popconfirm>
                        </div>
                      </AntList.Item>
                    )}
                  />
                </div>
              </div>
            )}

            {isEditorLoading ? (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: '#fff' }}>
                <Spin tip={t('common.loading')} />
              </div>
            ) : (
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fff' }}>
                {/* Tab 切换控制栏 */}
                <div style={{ 
                  padding: '12px 20px', 
                  borderBottom: '1px solid #f1f5f9', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  background: '#f8fafc' 
                }}>
                  <Segmented
                    value={editorViewMode}
                    onChange={(value: any) => setEditorViewMode(value)}
                    options={[
                      { label: <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Edit3 size={14} />{t('bots.markdownSource')}</div>, value: 'code' },
                      { label: <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><Eye size={14} />{t('experts.preview')}</div>, value: 'preview' }
                    ]}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                     <Tooltip title={t('common.refresh')}>
                      <Button 
                        size="small" 
                        type="text" 
                        icon={<RefreshCw size={14} className={isEditorLoading ? 'animate-spin' : ''} />} 
                        onClick={() => handleOpenFileEditor(editorBotId, editorType, selectedMemoryFile || undefined)} 
                        style={{ color: '#94a3b8' }}
                      />
                    </Tooltip>
                  </div>
                </div>

                {/* 内容区 */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                  {editorViewMode === 'code' ? (
                    <div style={{ flex: 1, padding: 0, position: 'relative', overflow: 'hidden' }}>
                      <TokenBadge text={editorContent} />
                      <Input.TextArea
                        value={editorContent}
                        onChange={(e) => setEditorContent(e.target.value)}
                        placeholder={editorType === 'soul' ? t('experts.soulPlaceholder') : 
                                     editorType === 'identity' ? t('experts.identityPlaceholder') : 
                                     editorType === 'heartbeat' ? 'HEARTBEAT.md configuration...' :
                                     editorType === 'agents' ? 'AGENTS.md configuration...' :
                                     t('bots.memoryPlaceholder')}
                        className="bot-editor-textarea"
                        style={{ 
                          height: '100%', border: 'none', background: 'transparent',
                          padding: '24px', resize: 'none', fontSize: 14, fontFamily: 'monospace',
                          lineHeight: 1.7, borderRadius: 0, overflowY: 'auto'
                        }}
                      />
                    </div>
                  ) : (
                    <div style={{ flex: 1, padding: '30px 40px', overflowY: 'auto', backgroundColor: '#fff' }}>
                      {editorContent ? (
                        <div className="markdown-body" style={{ fontSize: 15, maxWidth: '900px', margin: '0 auto' }}>
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{editorContent}</ReactMarkdown>
                        </div>
                      ) : (
                        <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#cbd5e1' }}>
                          <Empty description={t('common.noContent')} image={Empty.PRESENTED_IMAGE_SIMPLE} />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </Spin>
      </Modal>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        .markdown-body h1 { font-size: 1.4em; margin-bottom: 16px; color: #1e293b; border-bottom: 2px solid #e2e8f0; padding-bottom: 8px; }
        .markdown-body h2 { font-size: 1.25em; margin-top: 24px; margin-bottom: 12px; color: #334155; }
        .markdown-body p { margin-bottom: 16px; line-height: 1.7; color: #475569; }
        .markdown-body ul, .markdown-body ol { margin-bottom: 16px; padding-left: 20px; }
        .markdown-body li { margin-bottom: 6px; color: #475569; }
        .markdown-body code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 13px; color: #2563eb; }
        .markdown-body blockquote { border-left: 4px solid #e2e8f0; padding-left: 16px; color: #64748b; font-style: italic; margin: 16px 0; }
        .markdown-body table { display: block; width: 100%; overflow-x: auto; border-collapse: collapse; margin-bottom: 16px; }
        .markdown-body table th, .markdown-body table td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
        .markdown-body table th { background: #f8fafc; font-weight: 700; color: #475569; }
        .markdown-body table td { color: #64748b; }
        @keyframes pulse-green {
          0% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
          70% { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
          100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
        }
        .status-pulse {
          animation: pulse-green 2s infinite;
        }
        .bot-editor-spin-wrapper, 
        .bot-editor-spin-wrapper .ant-spin-container,
        .bot-editor-spin-wrapper .ant-spin-nested-loading {
          height: 100% !important;
        }
        .bot-editor-textarea {
          height: 100% !important;
          border-radius: 0 !important;
        }
        .bot-editor-textarea textarea {
          height: 100% !important;
          overflow-y: auto !important;
          padding: 24px !important;
        }
        .memory-tabs .ant-tabs-nav::before {
          border-bottom: none !important;
        }
        .memory-list-item:hover {
          background: #f1f5f9 !important;
        }
        .id-copy-tag:hover {
          background: #e2e8f0 !important;
          border-color: #cbd5e1 !important;
          color: #1e293b !important;
        }
      ` }} />
      <FileExplorer 
        open={explorerOpen}
        onClose={() => setExplorerOpen(false)}
        rootPath={explorerPath}
        title={explorerTitle}
        t={t}
        isMobile={isMobile}
      />
    </div>
  );
};

export default BotsManager;
