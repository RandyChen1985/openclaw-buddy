import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Tag, Spin, Button, Modal, Form, Input, Select, Tooltip, Table, Checkbox } from 'antd';
import { Boxes, RefreshCw, Plus, Pencil, Trash2, Cpu, History, ShieldCheck, Zap, Star } from 'lucide-react';
import dayjs from 'dayjs';
import api from '../api';
import { message } from 'antd';

interface BotsManagerProps {
  botsModels: any; // 结构: { data: { bots: [], models: [] }, updated_at: string }
  loadingBots: boolean;
  isMobile: boolean;
  onRefresh: () => void;
  onAddBot: (id: string, model: string) => Promise<void>;
  onSetIdentity: (id: string, name: string) => Promise<void>;
  onSetBotModel: (id: string, model: string) => Promise<void>;
  onDeleteBot: (id: string) => Promise<void>;
  onSetDefaultModel: (id: string) => Promise<void>;
  onShowGlobalLoading: (message: string, duration?: number) => void; // 新增
}

const BotsManager: React.FC<BotsManagerProps> = ({ 
  botsModels, loadingBots, isMobile, onRefresh, onAddBot, onSetIdentity, onSetBotModel, onDeleteBot, onSetDefaultModel, onShowGlobalLoading
}) => {
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
  
  // 模型管理相关状态
  const [modelsConfig, setModelsConfig] = useState<any>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [isProviderModalOpen, setIsProviderModalOpen] = useState(false);
  const [isModelModalOpen, setIsModelModalOpen] = useState(false);
  const [configForm] = Form.useForm();
  const [modelForm] = Form.useForm();
  const [submittingConfig, setSubmittingConfig] = useState(false);
  
  // 模型连通性测试状态
  const [testingModelId, setTestingModelId] = useState<string | null>(null);
  const [testLatencyMap, setTestLatencyMap] = useState<Record<string, { latency: number, error?: string }>>({});

  useEffect(() => {
    fetchSessions();
    fetchModelsConfig();
  }, []);

  const fetchModelsConfig = async () => {
    setLoadingConfig(true);
    try {
      const res = await api.get('/v1/openclaw/models/config');
      setModelsConfig(res.data);
    } catch (err) {
      console.error('Failed to fetch models config:', err);
    } finally {
      setLoadingConfig(false);
    }
  };

  const fetchSessions = async (force = false) => {
    setLoadingSessions(true);
    try {
      const res = await api.get(`/v1/openclaw/sessions${force ? '?refresh=true' : ''}`);
      setSessions(res.data.data || []);
    } catch (err) {
      // 错误静默或通过 message 处理
    } finally {
      setLoadingSessions(false);
    }
  };

  const formatAgeMs = (ms: number) => {
    if (ms < 60000) return '刚刚';
    const minutes = Math.floor(ms / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const handleAddProvider = async () => {
      try {
          const values = await configForm.validateFields();
          setSubmittingConfig(true);
          
          // 💡 立即关闭弹窗并显示全局处理遮罩 (不等待接口)
          setIsProviderModalOpen(false);
          onShowGlobalLoading('正在同步提供商配置...', 0); 
          
          await api.post('/v1/openclaw/models/provider', {
              name: values.name,
              config: {
                  baseUrl: values.baseUrl,
                  apiKey: values.apiKey,
                  auth: values.auth || 'api-key',
                  api: values.api || 'openai-completions'
              }
          });
          
          configForm.resetFields();
          await fetchModelsConfig();
          onShowGlobalLoading('提供商配置已同步，正在重载...', 3000);
      } catch (err: any) {
          // 发生错误时关闭遮罩并提示
          onShowGlobalLoading('', 1);
          if (!err.errorFields) {
              message.error('配置保存失败: ' + ((err as any).response?.data?.error || (err as any).message));
          }
      } finally {
          setSubmittingConfig(false);
      }
  };
  const handleAddModelToProvider = async () => {
    try {
      await modelForm.validateFields();
      const values = modelForm.getFieldsValue(true);
      setSubmittingConfig(true);
      
      // 💡 立即关闭弹窗并显示全局加载 (不等待接口)
      setIsModelModalOpen(false);
      onShowGlobalLoading('正在追加模型配置...', 0);

      const submitData = {
        provider_name: values.provider_name,
        model_config: {
          id: values.id,
          name: values.name || values.id,
          api: values.api,
          reasoning: !!values.reasoning,
          input: values.input,
          maxTokens: values.maxTokens || 2000000,
          contextWindow: values.contextWindow || 2000000,
        }
      };

      await api.post('/v1/openclaw/models/provider/model', submitData);
      
      modelForm.resetFields(['id', 'name', 'reasoning']);
      await Promise.all([fetchModelsConfig(), onRefresh()]);
      onShowGlobalLoading('模型追加成功，正在重载配置...', 3000);
    } catch (err: any) {
      onShowGlobalLoading('', 1);
      if (err.errorFields) return;
      message.error('模型追加失败: ' + ((err as any).response?.data?.error || (err as any).message || '未知错误'));
    } finally {
      setSubmittingConfig(false);
    }
  };

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setAdding(true);
      setIsModalOpen(false); // 同步关闭，避免重叠
      await onAddBot(values.id, values.model);
      form.resetFields();
    } catch (err) {
      // 报错逻辑由上层 App.tsx 统一处理
    } finally {
      setAdding(false);
    }
  };

  const handleEdit = (bot: any) => {
    // 假设 bot 对象中有 ID 和目前的 Name
    // 注意: bot 结构里当前解析的是 id (OpenClaw ID) 和 name (Identity 中的名称)
    setEditingBot({ id: bot.id, name: bot.name, model: bot.model });
    editForm.setFieldsValue({ 
        name: bot.name,
        model: bot.model
    });
    setIsEditModalOpen(true);
  };

  const handleEditOk = async () => {
    if (!editingBot) return;
    try {
      const values = await editForm.validateFields();
      setProcessing(true);
      setIsEditModalOpen(false); 
      
      // 并发请求修改名称和模型（如果发生了变化）
      const tasks = [];
      if (values.name !== editingBot.name) {
        tasks.push(onSetIdentity(editingBot.id, values.name));
      }
      if (values.model !== editingBot.model) {
        tasks.push(onSetBotModel(editingBot.id, values.model));
      }
      
      if (tasks.length > 0) {
        await Promise.all(tasks);
      }
    } catch (err) {
      // 错误已在 App.tsx 处理
    } finally {
      setProcessing(false);
    }
  };

  const handleDelete = (id: string) => {
    if (botsModels?.data?.bots?.length <= 1) {
      Modal.warning({
        title: '无法移除最后一只小龙虾',
        content: '系统要求至少保留一个机器人以维持基础服务运行。',
        okText: '知道了',
        centered: true
      });
      return;
    }
    setDeletingBotId(id);
    setIsDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingBotId) return;
    setIsDeleteModalOpen(false); // 关键：先关闭弹窗，避免重叠
    try {
      await onDeleteBot(deletingBotId);
      setDeletingBotId(null);
    } catch (err) {
      // 错误已处理
    }
  };

  const handleSetDefaultModel = (model: any) => {
    Modal.confirm({
      title: '确认切换全局默认模型？',
      content: `确认要将“${model.name}”设为系统全局默认模型吗？这可能会影响所有未独立配置模型的机器人行为。`,
      okText: '确认切换',
      cancelText: '取消',
      centered: true,
      onOk: async () => {
        await onSetDefaultModel(model.id);
      }
    });
  };

  const handleTestModel = async (providerName: string, modelId: string) => {
    const fullId = `${providerName}/${modelId}`;
    setTestingModelId(fullId);
    
    try {
      // 调用后端中转接口进行直连测试，规避浏览器 CORS 限制
      const res = await api.post('/v1/openclaw/models/test-direct', {
        providerName,
        modelId
      });

      if (res.data && res.data.code === 200) {
        const latency = res.data.data.latency;
        setTestLatencyMap(prev => ({ ...prev, [fullId]: { latency } }));
        message.success(`测试成功: ${latency}ms`);
      } else {
        throw new Error(res.data?.message || '未知错误');
      }
    } catch (err: any) {
      console.error('Model connectivity test failed:', err);
      const errorMsg = err.response?.data?.message || err.message || '测试失败';
      setTestLatencyMap(prev => ({ ...prev, [fullId]: { latency: -1, error: errorMsg } }));
      message.error(`模型测试失败: ${errorMsg}`);
    } finally {
      setTestingModelId(null);
    }
  };

  const handleDeleteModel = (providerName: string, modelID: string) => {
    Modal.confirm({
      title: '确认删除此模型?',
      content: `您确定要从提供商 [${providerName}] 中删除模型 [${modelID}] 吗？`,
      okText: '删除',
      cancelText: '取消',
      onOk: () => {
        // 💡 立即触发删除操作并开启遮罩，不使用 promise 阻塞 Modal
        onShowGlobalLoading('正在删除模型配置...', 0);
        const performDelete = async () => {
          try {
            await api.delete('/v1/openclaw/models/provider/model', {
              data: { provider_name: providerName, model_id: modelID }
            });
            await Promise.all([fetchModelsConfig(), onRefresh()]);
            onShowGlobalLoading('模型已移除，资产清单正在更新...', 3000);
          } catch (err: any) {
            onShowGlobalLoading('', 1);
            message.error('删除请求失败: ' + ((err as any).response?.data?.error || (err as any).message));
          }
        };
        performDelete();
      }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, animation: 'fade-in-up 0.4s ease-out' }}>

      {loadingBots && !botsModels ? (
        <Card style={{ borderRadius: 16, border: '1px solid #e2e8f0' }}>
          <div style={{ padding: isMobile ? '60px 0' : '80px 0', textAlign: 'center' }}>
            <Spin tip="正在同步 OpenClaw 资产清单..." />
          </div>
        </Card>
      ) : (
        <Row gutter={[isMobile ? 12 : 20, isMobile ? 12 : 20]}>
          <Col span={24}>
            <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', width: '100%', marginBottom: 16 }}>
              <span style={{ fontSize: isMobile ? 15 : 18, fontWeight: 800, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 10 }}>
                <Boxes size={22} color="#2563eb" /> 小龙虾们 (Bots)
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {botsModels?.updated_at && !isMobile && (
                  <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 400 }}>
                    上次同步: {dayjs(botsModels.updated_at).format('HH:mm:ss')}
                  </span>
                )}
                <Button 
                  type="primary" 
                  icon={<RefreshCw size={16} className={loadingBots ? 'animate-spin' : ''} />} 
                  onClick={onRefresh}
                  loading={loadingBots}
                  style={{ borderRadius: 10, fontWeight: 700, background: '#e2e8f0', color: '#64748b' }}
                >
                  {isMobile ? '' : '刷新'}
                </Button>
                <Button 
                  type="primary" 
                  icon={<Plus size={16} />}
                  onClick={() => setIsModalOpen(true)}
                  style={{ borderRadius: 10, fontWeight: 700, background: '#2563eb' }}
                >
                  添加{isMobile ? '' : 'Bot'}
                </Button>
              </div>
            </div>
          </Col>

          {botsModels?.data?.bots?.map((bot: any, index: number) => {
            const color = cardColors[index % cardColors.length];
            return (
              <Col xs={24} sm={12} lg={8} key={bot.id}>
                <Card
                  hoverable
                  styles={{ body: { padding: '20px' } }}
                  style={{ 
                    borderRadius: 20, 
                    border: `1px solid ${color.border}`,
                    background: color.bg,
                    height: '100%',
                    transition: 'all 0.3s ease',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)'
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ 
                        width: 52, height: 52, borderRadius: 14, background: color.iconBg,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 28, flexShrink: 0, boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)'
                      }}>
                        🦞
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b', maxWidth: '80%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {bot.name || bot.id}
                          </div>
                          <Tooltip title="修改名称">
                            <Button 
                              type="text" 
                              size="small" 
                              icon={<Pencil size={12} />} 
                              onClick={() => handleEdit(bot)}
                              style={{ color: '#94a3b8', padding: 0, height: 18, width: 18 }}
                            />
                          </Tooltip>
                        </div>
                        <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                          <Tag style={{ margin: 0, fontSize: 10, padding: '0 4px', borderRadius: 4, background: 'rgba(255,255,255,0.6)', border: 'none' }}>ID: {bot.id}</Tag>
                        </div>
                      </div>
                      {bot.id !== 'main' && (
                        <Tooltip title="移除此机器人">
                          <Button 
                            danger 
                            type="text" 
                            icon={<Trash2 size={16} />} 
                            onClick={() => handleDelete(bot.id)}
                            style={{ opacity: 0.5, borderRadius: 8 }}
                          />
                        </Tooltip>
                      )}
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, background: 'rgba(255,255,255,0.4)', padding: 12, borderRadius: 12 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: '#64748b' }}>默认模型</span>
                        <span style={{ color: color.theme, fontWeight: 700 }}>{bot.model || '未设定'}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12 }}>
                        <span style={{ color: '#64748b' }}>工作区</span>
                        <Tooltip title={bot.workspace}>
                          <span style={{ color: '#1e293b', fontSize: 11, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {bot.workspace || '-'}
                          </span>
                        </Tooltip>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, alignItems: 'center' }}>
                         <span style={{ color: '#64748b' }}>路由规则</span>
                         <Tag color="processing" style={{ margin: 0, borderRadius: 10, fontSize: 10, padding: '0 6px' }}>{bot.routingRules || 0} 条</Tag>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 0 2px #dcfce7' }}></div>
                        <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>运行中</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#94a3b8' }}>{bot.provider || '本地节点'}</div>
                    </div>
                  </div>
                </Card>
              </Col>
            );
          })}

          {botsModels?.data?.bots?.length === 0 && (
            <Col span={24}>
              <Card style={{ borderRadius: 16, border: '1px solid #e2e8f0' }}>
                <div style={{ padding: '32px 0', color: '#94a3b8', textAlign: 'center' }}>暂未配置机器人</div>
              </Card>
            </Col>
          )}

          <Col span={24}>
            <Card
              title={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Cpu size={isMobile ? 18 : 20} color="#6366f1" /> 模型军团 (Models)
                  </div>
                  <div style={{ display: 'flex', gap: 10 }}>
                    <Button 
                      type="primary" 
                      ghost 
                      size="small" 
                      icon={<ShieldCheck size={14} />} 
                      onClick={() => setIsProviderModalOpen(true)}
                      style={{ borderRadius: 8, fontSize: 12 }}
                    >
                      添加渠道
                    </Button>
                    <Button 
                      type="primary" 
                      ghost 
                      size="small" 
                      icon={<Plus size={14} />} 
                      onClick={() => setIsModelModalOpen(true)}
                      style={{ borderRadius: 8, fontSize: 12 }}
                    >
                      添加模型
                    </Button>
                  </div>
                </div>
              }
              styles={{ body: { padding: '20px' } }}
              style={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', width: '100%' }}
            >
              {loadingConfig && !modelsConfig ? (
                <div style={{ textAlign: 'center', padding: '20px 0' }}><Spin size="small" /></div>
              ) : modelsConfig ? (
                Object.entries(modelsConfig).map(([providerName, providerData]: [string, any]) => {
                  const providerModels = providerData.models || [];
                  if (providerModels.length === 0) return null;

                  return (
                    <div key={providerName} style={{ marginBottom: 28 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, paddingLeft: 4 }}>
                        <div style={{ width: 4, height: 16, background: '#6366f1', borderRadius: 2 }}></div>
                        <span style={{ fontWeight: 800, color: '#475569', fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {providerName}
                        </span>
                        <div style={{ height: 1, flex: 1, background: '#f1f5f9', marginLeft: 8 }}></div>
                      </div>
                      <Row gutter={[16, 16]}>
                        {providerModels.map((m: any) => {
                          const isDefault = botsModels?.data?.models?.find((dm: any) => dm.id === `${providerName}/${m.id}`)?.isDefault;
                          
                          return (
                            <Col xs={24} sm={12} md={12} lg={8} xl={6} key={m.id}>
                              <div style={{
                                background: isDefault ? '#f5f3ff' : '#fff',
                                padding: '18px',
                                borderRadius: 18,
                                border: isDefault ? '2px solid #a78bfa' : '1px solid #e2e8f0',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 12,
                                position: 'relative',
                                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                boxShadow: isDefault ? '0 10px 15px -3px rgba(139, 92, 246, 0.12), 0 4px 6px -4px rgba(139, 92, 246, 0.1)' : '0 1px 3px rgba(0,0,0,0.02)',
                                cursor: 'default'
                              }} className="model-card">
                                {isDefault && (
                                  <div style={{
                                    position: 'absolute', top: -10, right: 12,
                                    background: '#7c3aed', color: '#fff', fontSize: 9,
                                    padding: '2px 10px', borderRadius: 20, fontWeight: 800,
                                    boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)', 
                                    display: 'flex', alignItems: 'center', gap: 4,
                                    zIndex: 2, letterSpacing: '0.02em'
                                  }}>
                                    DEFAULT
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
                                            {testLatencyMap[providerName + '/' + m.id].latency > 0 ? `${testLatencyMap[providerName + '/' + m.id].latency}ms` : 'FAIL'}
                                          </Tag>
                                        )}
                                      </div>
                                    </Tooltip>
                                    <div style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', opacity: 0.8 }}>ID: {m.id}</div>
                                  </div>
                                </div>

                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                     {m.reasoning && (
                                       <Tag color="orange" style={{ margin: 0, borderRadius: 6, fontSize: 10, border: 'none', background: '#fff7ed', color: '#f59e0b', fontWeight: 700, padding: '0 6px' }}>
                                         <Zap size={10} style={{ marginRight: 2, display: 'inline-block', verticalAlign: 'middle' }} /> 推理型
                                       </Tag>
                                     )} 
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Tooltip title="测试连通性 (hello)">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<Zap size={14} className={testingModelId === `${providerName}/${m.id}` ? 'animate-pulse' : ''} />}
                                            loading={testingModelId === `${providerName}/${m.id}`}
                                            onClick={() => handleTestModel(providerName, m.id)}
                                            style={{ color: testingModelId === `${providerName}/${m.id}` ? '#f59e0b' : '#cbd5e1', padding: 0, height: 24, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                        />
                                    </Tooltip>
                                    {!isDefault && (
                                      <Tooltip title="设为全局默认">
                                        <Button 
                                          type="text" 
                                          size="small" 
                                          icon={<Star size={14} />} 
                                          onClick={() => handleSetDefaultModel(m)}
                                          style={{ color: '#cbd5e1', padding: 0, height: 24, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                        />
                                      </Tooltip>
                                    )}
                                    <Tooltip title="移除模型">
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<Trash2 size={14} />}
                                            onClick={() => handleDeleteModel(providerName, m.id)}
                                            style={{ color: '#cbd5e1', padding: 0, height: 24, width: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                            className="delete-hover"
                                        />
                                    </Tooltip>
                                  </div>
                                </div>
                              </div>
                            </Col>
                          );
                        })}
                      </Row>
                    </div>
                  );
                })
              ) : (
                <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8' }}>暂未配置模型分组信息</div>
              )}
            </Card>
          </Col>

          <Col span={24}>
            <Card
              title={
                <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', width: '100%', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <History size={isMobile ? 18 : 20} color="#f59e0b" /> 
                    <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: '#1e293b' }}>最近活跃会话 (Sessions)</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-end' }}>
                    <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>
                      实时同步中
                    </span>
                    <Button 
                      type="text"
                      size="small" 
                      icon={<RefreshCw size={14} className={loadingSessions ? 'animate-spin' : ''} />} 
                      onClick={() => fetchSessions(true)}
                      loading={loadingSessions}
                      style={{ color: '#64748b', display: 'flex', alignItems: 'center', padding: isMobile ? '0 4px' : '0 8px' }}
                    >
                      {isMobile ? '' : '刷新'}
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
                    title: '会话 Key',
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
                    title: 'Agent',
                    dataIndex: 'agentId',
                    key: 'agentId',
                    render: (id: string) => <Tag color="blue" style={{ borderRadius: 6, margin: 0 }}>{id}</Tag>
                  },
                  {
                    title: '活跃时间',
                    dataIndex: 'ageMs',
                    key: 'ageMs',
                    render: (ms: number) => <span style={{ color: '#64748b', fontSize: 13 }}>{formatAgeMs(ms)}</span>
                  },
                  {
                    title: '使用模型',
                    dataIndex: 'model',
                    key: 'model',
                    render: (m: string) => <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 13 }}>{m}</span>
                  },
                  {
                    title: 'Token 消耗 (Ctx %)',
                    key: 'tokens',
                    render: (_, record: any) => {
                      const percent = Math.round((record.totalTokens / record.contextTokens) * 100) || 0;
                      let color = '#22c55e';
                      if (percent > 80) color = '#ef4444';
                      else if (percent > 50) color = '#f59e0b';
                      
                      return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: isMobile ? 80 : 120 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                            <span>{Math.round(record.totalTokens / 1000)}k / {Math.round(record.contextTokens / 1000)}k</span>
                            {!isMobile && <span style={{ fontWeight: 700, color }}>{percent}%</span>}
                          </div>
                          <div style={{ width: '100%', height: 4, background: '#f1f5f9', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(percent, 100)}%`, height: '100%', background: color, transition: 'width 0.3s ease' }}></div>
                          </div>
                        </div>
                      );
                    }
                  },
                  ...(!isMobile ? [{
                    title: '类型',
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
            <span>添加小龙虾机器人</span>
          </div>
        }
        open={isModalOpen}
        onOk={handleOk}
        onCancel={() => setIsModalOpen(false)}
        confirmLoading={adding}
        okText="确认创建"
        cancelText="取消"
        centered
        style={{ borderRadius: 16 }}
      >
        <div style={{ padding: '8px 0' }}>
          <Form form={form} layout="vertical" initialValues={{ id: '', model: '' }}>
            <Form.Item
              label="机器人 ID"
              name="id"
              rules={[
                { required: true, message: '请输入由字母、数字或下划线组成的 ID' },
                { pattern: /^[a-zA-Z0-9_]+$/, message: '仅支持字母、数字和下划线' }
              ]}
              extra={<span style={{ fontSize: 11, color: '#94a3b8' }}>建议格式如: <code style={{ background: '#f1f5f9', padding: '1px 4px' }}>dev_bot</code>。添加后工作区将自动设为 <code style={{ background: '#f1f5f9', padding: '1px 4px' }}>~/.openclaw/workspace_[id]</code></span>}
            >
              <Input placeholder="输入机器人 ID" />
            </Form.Item>
            
            <Form.Item
              label="选择模型"
              name="model"
              rules={[{ required: true, message: '请选择关联的模型' }]}
            >
              <Select 
                placeholder="请选择 AI 模型" 
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
            <span>添加 API 提供商配置 (Add Provider)</span>
          </div>
        }
        open={isProviderModalOpen}
        onCancel={() => setIsProviderModalOpen(false)}
        footer={null}
        width={550}
        centered
        style={{ borderRadius: 16 }}
      >
        <div style={{ padding: '8px 0' }}>
            <Form form={configForm} layout="vertical">
              <Row gutter={16}>
                <Col span={24}>
                  <Form.Item label="提供商标识 (ID)" name="name" rules={[{ required: true, message: '必填' }]} extra="例如: deepseek, yovole, openai">
                    <Input placeholder="输入提供商 ID" />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item label="API 基准地址 (Base URL)" name="baseUrl" rules={[{ required: true, message: '必填' }]}>
                    <Input placeholder="https://api.example.com/v1" />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <Form.Item label="API 密钥 (API Key)" name="apiKey" rules={[{ required: true, message: '必填' }]}>
                    <Input.Password placeholder="sk-..." />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="认证类型" name="auth" initialValue="api-key">
                    <Select options={[{ label: 'API Key', value: 'api-key' }]} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="API 协议" name="api" initialValue="openai-completions">
                    <Select options={[{ label: 'OpenAI Completions', value: 'openai-completions' }]} />
                  </Form.Item>
                </Col>
              </Row>
              <Button type="primary" block onClick={handleAddProvider} loading={submittingConfig} icon={<Plus size={16} />} style={{ marginTop: 8, height: 40, borderRadius: 10 }}>
                保存并生效渠道配置
              </Button>
            </Form>
        </div>
      </Modal>

      {/* 模型追加对话框 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ padding: 6, background: '#f5f3ff', borderRadius: 8 }}><Cpu size={18} color="#7c3aed" /></div>
            <span>添加新模型 (Add Model to Provider)</span>
          </div>
        }
        open={isModelModalOpen}
        onCancel={() => setIsModelModalOpen(false)}
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
                  <Form.Item label="所属提供商" name="provider_name" rules={[{ required: true, message: '请选择提供商' }]}>
                    <Select placeholder="选择一个提供商" allowClear>
                      {modelsConfig && Object.keys(modelsConfig).map(name => (
                        <Select.Option key={name} value={name}>{name}</Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="模型标识 (ID)" name="id" rules={[{ required: true, message: '必填' }]}>
                    <Input placeholder="例如: deepseek-chat" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="显示名称 (Name)" name="name">
                    <Input placeholder="例如: DeepSeek-V3" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="API 协议" name="api">
                    <Select options={[
                      { label: 'OpenAI Completions', value: 'openai-completions' },
                      { label: 'OpenAI Responses', value: 'openai-responses' },
                      { label: 'OpenAI Codex Responses', value: 'openai-codex-responses' },
                      { label: 'Anthropic Messages', value: 'anthropic-messages' },
                      { label: 'Google Generative AI', value: 'google-generative-ai' },
                      { label: 'GitHub Copilot', value: 'github-copilot' },
                      { label: 'Bedrock Converse Stream', value: 'bedrock-converse-stream' },
                      { label: 'Ollama', value: 'ollama' }
                    ]} />
                  </Form.Item>
                </Col>
                 <Col span={24}>
                  <Form.Item label="支持的能力 (Input)" name="input">
                    <Select mode="multiple" placeholder="支持的输入类型" options={[
                      { label: 'Text (文本)', value: 'text' },
                      { label: 'Image (图片)', value: 'image' },
                      { label: 'Audio (音频)', value: 'audio' }
                    ]} />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="上下文窗口 (Context Window)" name="contextWindow" rules={[{ required: true, message: '必填' }]}>
                    <Input type="number" placeholder="2000000" />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item label="最大输出 (Max Tokens)" name="maxTokens" rules={[{ required: true, message: '必填' }]}>
                    <Input type="number" placeholder="2000000" />
                  </Form.Item>
                </Col>
                <Col span={24}>
                  <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: 12, border: '1px solid #f1f5f9', marginBottom: 20 }}>
                     <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <Zap size={18} color="#f59e0b" />
                          <div>
                            <div style={{ fontWeight: 600, fontSize: 13 }}>开启推理模式 (Reasoning)</div>
                            <div style={{ fontSize: 11, color: '#94a3b8' }}>针对 DeepSeek-R1 或 O1 等思考型模型</div>
                          </div>
                        </div>
                        <Form.Item name="reasoning" valuePropName="checked" noStyle>
                           <Checkbox />
                        </Form.Item>
                      </div>
                  </div>
                </Col>
              </Row>
              <Button type="primary" block onClick={handleAddModelToProvider} loading={submittingConfig} icon={<Plus size={16} />} style={{ marginTop: 8, height: 40, borderRadius: 10 }}>
                将模型追加至该渠道
              </Button>
            </Form>
        </div>
      </Modal>

      {/* 修改名称对话框 */}
      <Modal
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ padding: 6, background: '#fef2f2', borderRadius: 8 }}><Pencil size={18} color="#ef4444" /></div>
            <span>修改机器人显示名称</span>
          </div>
        }
        open={isEditModalOpen}
        onOk={handleEditOk}
        onCancel={() => setIsEditModalOpen(false)}
        confirmLoading={processing}
        okText="确认修改"
        cancelText="取消"
        centered
      >
        <div style={{ padding: '8px 0' }}>
          <Form form={editForm} layout="vertical">
            <Form.Item label="当前 ID">
              <Input value={editingBot?.id} disabled />
            </Form.Item>
            <Form.Item
              label="新的显示名称"
              name="name"
              rules={[{ required: true, message: '请输出新的显示名称' }]}
            >
              <Input placeholder="输入新的显示名称" autoFocus />
            </Form.Item>
            <Form.Item 
              label="默认模型" 
              name="model" 
              rules={[{ required: true, message: '请选择默认模型' }]}
            >
              <Select placeholder="选择此机器人默认使用的模型">
                {botsModels?.data?.models?.map((m: any) => (
                  <Select.Option key={m.id} value={m.id}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                       <span style={{ fontWeight: 600, fontSize: 13 }}>{m.name || m.id}</span>
                       <span style={{ fontSize: 11, color: '#94a3b8' }}>{m.id}</span>
                    </div>
                  </Select.Option>
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
            <span>确认要移除该机器人吗？</span>
          </div>
        }
        open={isDeleteModalOpen}
        onOk={handleConfirmDelete}
        onCancel={() => setIsDeleteModalOpen(false)}
        okText="确认移除"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        centered
      >
        <div style={{ padding: '8px 0' }}>
          <p style={{ color: '#ef4444', fontWeight: 600 }}>将会彻底删除机器人 {deletingBotId} 以及相关工作目录！</p>
          <p style={{ color: '#64748b', fontSize: 13 }}>该操作不可逆，请谨慎操作。</p>
        </div>
      </Modal>
    </div>
  );
};

export default BotsManager;
