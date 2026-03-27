import React from 'react';
import { Row, Col, Card, Tag, Spin, List, Button } from 'antd';
import { Boxes, Server, Activity, Cpu, RefreshCw, Cloud } from 'lucide-react';
import dayjs from 'dayjs';

interface BotsManagerProps {
  botsModels: any; // 结构: { data: { bots: [], models: [] }, updated_at: string }
  loadingBots: boolean;
  isMobile: boolean;
  onRefresh: () => void;
}

const BotsManager: React.FC<BotsManagerProps> = ({ botsModels, loadingBots, isMobile, onRefresh }) => {
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Boxes size={20} color="#2563eb" /> 小龙虾们 (Bots)
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {botsModels?.updated_at && (
                      <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>
                        同步于: {dayjs(botsModels.updated_at).format('YYYY-MM-DD HH:mm:ss')}
                      </span>
                    )}
                    <Button 
                      type="text" 
                      size="small" 
                      icon={<RefreshCw size={14} className={loadingBots ? 'animate-spin' : ''} />} 
                      onClick={onRefresh}
                      loading={loadingBots}
                      style={{ color: '#64748b', display: 'flex', alignItems: 'center' }}
                    >
                      刷新
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Cpu size={20} color="#6366f1" /> 模型军团 (Models)
                  </span>
                  {/* 第二个卡片通常不需要重复刷新和时间，但为了统一风格可以保留或简化 */}
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
    </div>
  );
};

export default BotsManager;
