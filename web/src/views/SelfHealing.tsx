import React from 'react';
import { Card, Badge, Button, List, Tag } from 'antd';
import { Zap, Terminal } from 'lucide-react';
import dayjs from 'dayjs';

interface SelfHealingProps {
  selfHealingEnabled: boolean;
  healEvents: any[];
  loadingSets: boolean;
  onToggle: (checked: boolean) => void;
}

const SelfHealing: React.FC<SelfHealingProps> = ({ 
  selfHealingEnabled, 
  healEvents, 
  loadingSets, 
  onToggle 
}) => {
  const isMobile = window.innerWidth < 768;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 软开关卡片 */}
      <Card
        styles={{ body: { padding: isMobile ? '20px' : '24px 28px' } }}
        style={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}
      >
        <div style={{ 
          display: 'flex', 
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'flex-start' : 'center', 
          justifyContent: 'space-between',
          gap: 20
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 16 : 20 }}>
            <div style={{ 
              width: isMobile ? 44 : 52, 
              height: isMobile ? 44 : 52, 
              borderRadius: 12, 
              background: selfHealingEnabled ? '#f0f9ff' : '#f8fafc',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0
            }}>
              <Zap size={isMobile ? 22 : 26} color={selfHealingEnabled ? '#3b82f6' : '#94a3b8'} fill={selfHealingEnabled ? '#3b82f6' : 'none'} style={{ opacity: selfHealingEnabled ? 1 : 0.5 }} />
            </div>
            <div>
              <div style={{ fontWeight: 800, color: '#1e293b', fontSize: isMobile ? 16 : 17, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                自动自愈服务
                <Badge status={selfHealingEnabled ? 'processing' : 'default'} />
              </div>
              <div style={{ color: '#64748b', fontSize: 13, maxWidth: 500, lineHeight: 1.5 }}>
                开启后，当巡检发现网关宕机或响应超时，系统将自动尝试执行修复、配置回滚并重启服务。
              </div>
            </div>
          </div>
          <div style={{ 
            textAlign: isMobile ? 'left' : 'right',
            width: isMobile ? '100%' : 'auto',
            borderTop: isMobile ? '1px solid #f1f5f9' : 'none',
            paddingTop: isMobile ? 16 : 0,
            display: 'flex',
            flexDirection: isMobile ? 'row' : 'column',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}>
            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: isMobile ? 0 : 8, fontWeight: 600 }}>
              当前状态: <span style={{ color: selfHealingEnabled ? '#16a34a' : '#ef4444' }}>{selfHealingEnabled ? '运行中' : '已禁用'}</span>
            </div>
            <Button 
              type={selfHealingEnabled ? "default" : "primary"}
              size="large"
              loading={loadingSets}
              onClick={() => onToggle(!selfHealingEnabled)}
              style={{ 
                borderRadius: 10, minWidth: 100, fontWeight: 700,
                background: selfHealingEnabled ? '#ef4444' : '#2563eb',
                borderColor: selfHealingEnabled ? '#ef4444' : '#2563eb',
                color: '#fff'
              }}
            >
              {selfHealingEnabled ? '禁用服务' : '立即开启'}
            </Button>
          </div>
        </div>
      </Card>


      {/* 自愈日志列表 */}
      <Card
        title={<span style={{ fontSize: 14, fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: 8 }}><Terminal size={16} /> 历史自愈事件</span>}
        styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 48 }, body: { padding: '0 24px' } }}
        style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
      >
        {healEvents.length === 0 ? (
          <div style={{ padding: '60px 0', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>☕</div>
            <div style={{ fontSize: 13 }}>暂无自愈事件记录，系统运行平稳</div>
          </div>
        ) : (
          <List
            dataSource={healEvents}
            renderItem={(item: any) => (
              <List.Item style={{ padding: '20px 0', borderBottom: '1px solid #f8fafc' }}>
                <div style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                    <Tag color="warning" style={{ borderRadius: 4, fontWeight: 600 }}>{item.reason}</Tag>
                    <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>{dayjs(item.timestamp).format('YYYY-MM-DD HH:mm:ss')}</span>
                  </div>
                  <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: 8, border: '1px solid #f1f5f9' }}>
                    <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                      <span style={{ color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>恢复方法:</span>
                      <span style={{ color: '#1e293b' }}>{item.method}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 12, fontSize: 13, marginTop: 4 }}>
                      <span style={{ color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>处置结果:</span>
                      <span style={{ color: item.result === 'Success' ? '#16a34a' : '#ef4444', fontWeight: 600 }}>{item.result === 'Success' ? '✅ 已恢复' : '❌ 失败'}</span>
                    </div>
                  </div>
                </div>
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
};

export default SelfHealing;
