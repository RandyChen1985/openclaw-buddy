import React, { useState } from 'react';
import { Row, Col, Card, Tag, Spin, Button, Modal, Form, Input, Select, Tooltip } from 'antd';
import { Boxes, RefreshCw, Cloud, Plus, Pencil, Trash2, Cpu } from 'lucide-react';
import dayjs from 'dayjs';

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
                  添加{isMobile ? '' : '机器人'}
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
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Cpu size={isMobile ? 18 : 20} color="#6366f1" /> 模型军团 (Models)
                </div>
              }
              styles={{ body: { padding: '16px 20px' } }}
              style={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)', width: '100%' }}
            >
              <Row gutter={[12, 12]}>
                {botsModels?.data?.models && botsModels.data.models.length > 0 ? botsModels.data.models.map((m: any) => {
                  const isDefault = m.isDefault;
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
                          <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {m.name}
                          </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                          <div style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, color: '#64748b' }}>
                             <Cloud size={11} /> {m.provider || 'AI Provider'}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            {!isDefault && (
                              <Tooltip title="设为全局默认模型">
                                <Button 
                                  type="text" 
                                  size="small" 
                                  icon={<RefreshCw size={12} />} 
                                  onClick={() => handleSetDefaultModel(m)}
                                  style={{ color: '#94a3b8', padding: '0 4px', height: 20, fontSize: 10, display: 'flex', alignItems: 'center' }}
                                >
                                  设为默认
                                </Button>
                              </Tooltip>
                            )}
                            <Tag style={{ margin: 0, borderRadius: 6, fontSize: 9, background: isDefault ? '#ddd6fe' : '#e2e8f0', color: isDefault ? '#5b21b6' : '#64748b', border: 'none' }}>ACTIVE</Tag>
                          </div>
                        </div>
                      </div>
                    </Col>
                  );
                }) : (
                  <Col span={24}>
                    <div style={{ textAlign: 'center', width: '100%', padding: '32px 0', color: '#94a3b8' }}>暂未配置模型</div>
                  </Col>
                )}
              </Row>
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
