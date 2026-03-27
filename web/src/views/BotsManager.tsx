import React, { useState } from 'react';
import { Row, Col, Card, Tag, Spin, List, Button, Modal, Form, Input, Select, Tooltip, message } from 'antd';
import { Boxes, Server, Activity, Cpu, RefreshCw, Cloud, Plus, Pencil, Trash2 } from 'lucide-react';
import dayjs from 'dayjs';

interface BotsManagerProps {
  botsModels: any; // 结构: { data: { bots: [], models: [] }, updated_at: string }
  loadingBots: boolean;
  isMobile: boolean;
  onRefresh: () => void;
  onAddBot: (id: string, model: string) => Promise<void>;
  onSetIdentity: (id: string, name: string) => Promise<void>;
  onDeleteBot: (id: string) => Promise<void>;
}

const BotsManager: React.FC<BotsManagerProps> = ({ 
  botsModels, loadingBots, isMobile, onRefresh, onAddBot, onSetIdentity, onDeleteBot 
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [editForm] = Form.useForm();
  const [adding, setAdding] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [editingBot, setEditingBot] = useState<{ id: string, name: string } | null>(null);

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setAdding(true);
      await onAddBot(values.id, values.model);
      setIsModalOpen(false);
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
      await onSetIdentity(editingBot.id, values.name);
      setIsEditModalOpen(false);
    } catch (err) {
      // 错误已在 App.tsx 处理
    } finally {
      setProcessing(false);
    }
  };

  const handleDelete = (id: string) => {
    Modal.confirm({
      title: '确认要移除该机器人吗？',
      content: `将会执行 openclaw agents delete ${id} --force，该操作不可逆！`,
      okText: '确认移除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        await onDeleteBot(id);
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
        <Row gutter={[isMobile ? 16 : 24, isMobile ? 16 : 24]}>
          <Col span={24}>
            <Card
              title={
                <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', width: '100%', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : 12 }}>
                  <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Boxes size={isMobile ? 18 : 20} color="#2563eb" /> 小龙虾们 (Bots)
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-end' }}>
                    {botsModels?.updated_at && (
                      <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>
                        同步于: {dayjs(botsModels.updated_at).format('YYYY-MM-DD HH:mm:ss')}
                      </span>
                    )}
                    <Button 
                      type="text" 
                      size="small" 
                      icon={<Plus size={14} />} 
                      onClick={() => setIsModalOpen(true)}
                      style={{ color: '#2563eb', fontWeight: 600, display: 'flex', alignItems: 'center' }}
                    >
                      添加机器人
                    </Button>
                    <div style={{ width: 1, height: 14, background: '#e2e8f0' }} />
                    <Button 
                      type="text" 
                      size="small" 
                      icon={<RefreshCw size={14} className={loadingBots ? 'animate-spin' : ''} />} 
                      onClick={onRefresh}
                      loading={loadingBots}
                      style={{ color: '#64748b', display: 'flex', alignItems: 'center', padding: isMobile ? '0 4px' : '0 8px' }}
                    >
                      {isMobile ? '' : '刷新'}
                    </Button>
                  </div>
                </div>
              }
              styles={{ body: { padding: isMobile ? '8px 16px' : '12px 24px' } }}
              style={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}
            >
              <List
                dataSource={botsModels?.data?.bots || []}
                renderItem={(bot: any) => (
                  <List.Item style={{ padding: isMobile ? '16px 0' : '24px 0', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: '100%' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                        <div style={{ 
                          width: 48, height: 48, borderRadius: 12, background: '#f8fafc',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: '1px solid #f1f5f9'
                        }}>
                          <Server size={24} color="#6366f1" />
                        </div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <div style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>{bot.name}</div>
                            <Tooltip title="修改名称">
                              <Button 
                                type="text" 
                                size="small" 
                                icon={<Pencil size={12} />} 
                                onClick={() => handleEdit(bot)}
                                style={{ color: '#94a3b8', padding: 0, height: 18 }}
                              />
                            </Tooltip>
                          </div>
                          <div style={{ fontSize: 12, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Tag style={{ margin: 0, fontSize: 10, padding: '0 4px' }}>ID: {bot.id}</Tag>
                            <span style={{ fontSize: 10 }}>•</span>
                            <span style={{ fontSize: 11 }}>{bot.provider || 'Local'}</span>
                          </div>
                        </div>
                        <Tooltip title="彻底移除">
                          <Button 
                            danger 
                            type="text" 
                            icon={<Trash2 size={16} />} 
                            onClick={() => handleDelete(bot.id)}
                            style={{ opacity: 0.6 }}
                          />
                        </Tooltip>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                          <Tag color="success" style={{ borderRadius: 12, padding: isMobile ? '0 8px' : '0 12px', fontSize: 10 }}>运行中</Tag>
                          {!isMobile && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{bot.routingRules || 0} 条规则</div>}
                        </div>
                      
                      <div style={{ 
                        display: 'grid', 
                        gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fit, minmax(240px, 1fr))', 
                        gap: isMobile ? 8 : 12, 
                        background: '#f8fafc', 
                        padding: 12, 
                        borderRadius: 12,
                        fontSize: 11
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b' }}>
                          <Server size={12} style={{ opacity: 0.6 }} />
                          <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>工作区:</span>
                          <code style={{ color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bot.workspace || '-'}</code>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b' }}>
                          <Boxes size={12} style={{ opacity: 0.6 }} />
                          <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>实例目录:</span>
                          <code style={{ color: '#0f172a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bot.agentDir || '-'}</code>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b' }}>
                          <Activity size={12} style={{ opacity: 0.6 }} />
                          <span style={{ fontWeight: 500, whiteSpace: 'nowrap' }}>路由策略:</span>
                          <span style={{ color: '#0f172a' }}>{bot.routing || 'default'}</span>
                        </div>
                      </div>
                    </div>
                  </List.Item>
                )}
                locale={{ emptyText: <div style={{ padding: '32px 0', color: '#94a3b8' }}>暂未配置机器人</div> }}
              />
            </Card>
          </Col>

          <Col span={24}>
            <Card
              title={
                <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', width: '100%', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : 12 }}>
                  <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Cpu size={isMobile ? 18 : 20} color="#6366f1" /> 模型军团 (Models)
                  </span>
                </div>
              }
              styles={{ body: { padding: isMobile ? '8px 16px' : '12px 24px' } }}
              style={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)' }}
            >
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, padding: '12px 0' }}>
                {botsModels?.data?.models && botsModels.data.models.length > 0 ? botsModels.data.models.map((m: any) => (
                  <div key={m.id} style={{
                    background: '#f8fafc', padding: isMobile ? '8px 12px' : '12px 16px', borderRadius: 12, border: '1px solid #f1f5f9',
                    flex: isMobile ? '1 1 calc(50% - 8px)' : '0 0 auto', minWidth: isMobile ? 140 : 200, display: 'flex', flexDirection: 'column', gap: 4
                  }}>
                    <div style={{ fontWeight: 600, color: '#334155', fontSize: isMobile ? 12 : 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.name}</div>
                    <div style={{ fontSize: 10, display: 'flex', alignItems: 'center', gap: 4, color: '#94a3b8' }}>
                      <Cloud size={10} /> {m.provider}
                    </div>
                  </div>
                )) : (
                  <div style={{ textAlign: 'center', width: '100%', padding: '32px 0', color: '#94a3b8' }}>暂未配置模型</div>
                )}
              </div>
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
              <Select placeholder="请选择 AI 模型">
                {botsModels?.data?.models?.map((m: any) => (
                  <Select.Option key={m.id} value={m.id}>
                    {m.name} ({m.provider})
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
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
    </div>
  );
};

export default BotsManager;
