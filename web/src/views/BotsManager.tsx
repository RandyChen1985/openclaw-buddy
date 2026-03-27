import React, { useState } from 'react';
import { Row, Col, Card, Tag, Spin, List, Button, Modal, Form, Input, Select } from 'antd';
import { Boxes, Server, Activity, Cpu, RefreshCw, Cloud, Plus } from 'lucide-react';
import dayjs from 'dayjs';

interface BotsManagerProps {
  botsModels: any; // 结构: { data: { bots: [], models: [] }, updated_at: string }
  loadingBots: boolean;
  isMobile: boolean;
  onRefresh: () => void;
  onAddBot: (id: string, model: string) => Promise<void>;
}

const BotsManager: React.FC<BotsManagerProps> = ({ botsModels, loadingBots, isMobile, onRefresh, onAddBot }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [adding, setAdding] = useState(false);

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
                      {isMobile ? '' : '添加机器人'}
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 12 : 16 }}>
                        <div style={{ fontSize: isMobile ? 24 : 32 }}>{bot.emoji || '🤖'}</div>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                            <span style={{ fontWeight: 800, color: '#1e293b', fontSize: isMobile ? 14 : 16 }}>{bot.id}</span>
                            {bot.name && <Tag color="default" style={{ borderRadius: 6, fontSize: 10, margin: 0 }}>{bot.name}</Tag>}
                          </div>
                          <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
                            <span style={{ display: isMobile ? 'none' : 'inline' }}>关联模型: </span>
                            <Tag color="blue" style={{ borderRadius: 4, margin: 0, scale: '0.8', transformOrigin: 'left' }}>{bot.model}</Tag>
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <Tag color="success" style={{ borderRadius: 12, padding: isMobile ? '0 8px' : '0 12px', fontSize: 10 }}>运行中</Tag>
                          {!isMobile && <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 4 }}>{bot.routingRules || 0} 条规则</div>}
                        </div>
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
    </div>
  );
};

export default BotsManager;
