import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Tag, Spin, Button, Modal, Form, Input, Select, Tooltip, Table, Checkbox } from 'antd';
import { Boxes, RefreshCw, Plus, Pencil, Trash2, Cpu, History, ShieldCheck, Zap, MessageSquare, Star } from 'lucide-react';
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
  onDeleteBot: (id: string) => Promise<void>;
  onSetDefaultModel: (id: string) => Promise<void>;
}

const BotsManager: React.FC<BotsManagerProps> = ({ 
  botsModels, loadingBots, isMobile, onRefresh, onAddBot, onSetIdentity, onDeleteBot, onSetDefaultModel 
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
  const [editingBot, setEditingBot] = useState<{ id: string, name: string } | null>(null);
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
      await api.post('/v1/openclaw/models/provider', {
        name: values.name,
        config: {
          baseUrl: values.baseUrl,
          apiKey: values.apiKey,
          auth: values.auth || 'api-key',
          api: values.api || 'openai-completions'
        }
      });
      message.success('提供商添加成功');
      configForm.resetFields();
      await fetchModelsConfig();
    } catch (err: any) {
      message.error('添加失败: ' + (err.response?.data?.error || err.message));
    } finally {
      setSubmittingConfig(false);
    }
  };

  const handleAddModelToProvider = async () => {
    try {
      // 1. 先进行表单校验（会自动触发 rules 提示）
      await modelForm.validateFields();
      
      // 2. 显式从 form 实例中拉取所有字段（包含 preserve 的字段）
      const values = modelForm.getFieldsValue(true);
      console.log('📦 Form Instance Data:', values);
      
      setSubmittingConfig(true);
      
      // 3. 构建结构化提交数据
      const submitData = {
        provider_name: values.provider_name,
        model_config: {
          id: values.id,
          name: values.name || values.id,
          api: values.api || 'openai-chat',
          reasoning: !!values.reasoning,
          input: values.input || ['text']
        }
      };

      console.log('🚀 Final Submit Data:', submitData);
      await api.post('/v1/openclaw/models/provider/model', submitData);
      
      message.success('模型已成功追加');
      modelForm.resetFields(['id', 'name', 'reasoning']); // 仅重置模型部分，保留 provider 方便连续添加
      await Promise.all([fetchModelsConfig(), onRefresh()]);
    } catch (err: any) {
      if (err.errorFields) {
        // 这是 Form 校验失败的情况
        console.warn('⚠️ Form Validation Failed:', err.errorFields);
        return;
      }
      console.error('❌ Model Add Failed:', err);
      message.error('添加失败: ' + (err.response?.data?.error || err.message || '未知错误'));
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
    setEditingBot({ id: bot.id, name: bot.name });
    editForm.setFieldsValue({ name: bot.name });
    setIsEditModalOpen(true);
  };

  const handleEditOk = async () => {
    if (!editingBot) return;
    try {
      const values = await editForm.validateFields();
      setProcessing(true);
      setIsEditModalOpen(false); // 同步关闭，避免重叠
      await onSetIdentity(editingBot.id, values.name);
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
                        <span style={{ color: '#64748b' }}>关联模型</span>
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
                    <div key={providerName} style={{ marginBottom: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, paddingLeft: 4 }}>
                        <ShieldCheck size={14} color="#6366f1" />
                        <span style={{ fontWeight: 700, color: '#475569', fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                          {providerName}
                        </span>
                        <div style={{ height: 1, flex: 1, background: '#f1f5f9', marginLeft: 8 }}></div>
                      </div>
                      <Row gutter={[12, 12]}>
                        {providerModels.map((m: any) => {
                          // 检查是否为默认模型 (从 botsModels.data.models 中匹配)
                          const isDefault = botsModels?.data?.models?.find((dm: any) => dm.id === m.id)?.isDefault;
                          
                          return (
                            <Col xs={24} sm={12} md={8} lg={6} xl={4} key={m.id}>
                              <div style={{
                                background: isDefault ? '#f5f3ff' : '#f8fafc',
                                padding: '16px',
                                borderRadius: 14,
                                border: isDefault ? '2px solid #a78bfa' : '1px solid #f1f5f9',
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 8,
                                position: 'relative',
                                transition: 'all 0.2s ease',
                                boxShadow: isDefault ? '0 4px 12px rgba(139, 92, 246, 0.15)' : 'none'
                              }}>
                                {isDefault && (
                                  <div style={{
                                    position: 'absolute', top: -10, right: 12,
                                    background: '#7c3aed', color: '#fff', fontSize: 10,
                                    padding: '2px 8px', borderRadius: 20, fontWeight: 800,
                                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', gap: 4
                                  }}>
                                    <Tag style={{ border: 'none', background: 'transparent', color: '#fff', margin: 0, padding: 0, fontSize: 10 }}>DEFAULT</Tag>
                                  </div>
                                )}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                  <div style={{ 
                                    width: 32, height: 32, borderRadius: 8, background: isDefault ? '#ede9fe' : '#f1f5f9',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                                  }}>
                                    <Cpu size={16} color={isDefault ? '#7c3aed' : '#94a3b8'} />
                                  </div>
                                  <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {m.name || m.id}
                                  </div>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                                  <div style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, color: '#94a3b8' }}>
                                     {m.reasoning ? <Zap size={10} color="#f59e0b" /> : <MessageSquare size={10} />} 
                                     {m.reasoning ? '推理模型' : '通用模型'}
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    {!isDefault && (
                                      <Tooltip title="设为全局默认模型">
                                        <Button 
                                          type="text" 
                                          size="small" 
                                          icon={<Star size={12} />} 
                                          onClick={() => handleSetDefaultModel(m)}
                                          style={{ color: '#94a3b8', padding: '0 4px', height: 20, fontSize: 10, display: 'flex', alignItems: 'center' }}
                                        />
                                      </Tooltip>
                                    )}
                                    <Tag style={{ margin: 0, borderRadius: 6, fontSize: 9, background: isDefault ? '#ddd6fe' : '#e2e8f0', color: isDefault ? '#5b21b6' : '#64748b', border: 'none' }}>ACTIVE</Tag>
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
                input: ['text']
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
