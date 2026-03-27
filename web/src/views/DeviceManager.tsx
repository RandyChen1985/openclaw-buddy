import React from 'react';
import { Card, Tag, Spin, List, Button, Tooltip } from 'antd';
import { Smartphone, CheckCircle, RefreshCw } from 'lucide-react';
import dayjs from 'dayjs';

interface DeviceManagerProps {
  devices: any; // 结构: { data: [], updated_at: string }
  loadingDevices: boolean;
  onApproveDevice: (requestId: string) => void;
  onRefresh: () => void;
  isMobile?: boolean; // 新增移动端标记
}

const DeviceManager: React.FC<DeviceManagerProps> = ({ 
  devices, 
  loadingDevices, 
  onApproveDevice,
  onRefresh,
  isMobile
}) => {
  const deviceList = devices?.data || [];
  const pendingDevices = deviceList.filter((d: any) => d.status === 'pending');
  const pairedDevices = deviceList.filter((d: any) => d.status === 'paired');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* 1. 待批准设备请求 */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', width: '100%', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : 12 }}>
            <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
              <Smartphone size={isMobile ? 18 : 20} color="#f59e0b" /> 待处理连接请求
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-end' }}>
              {devices?.updated_at && (
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>
                  同步于: {dayjs(devices.updated_at).format('YYYY-MM-DD HH:mm:ss')}
                </span>
              )}
              <Button 
                type="text" 
                size="small" 
                icon={<RefreshCw size={14} className={loadingDevices ? 'animate-spin' : ''} />} 
                onClick={onRefresh}
                loading={loadingDevices}
                style={{ color: '#64748b', display: 'flex', alignItems: 'center', padding: isMobile ? '0 4px' : '0 8px' }}
              >
                刷新
              </Button>
            </div>
          </div>
        }
        styles={{ body: { padding: '0 24px' } }}
        style={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}
      >
        <div style={{ padding: '12px 0', borderBottom: '1px solid #f1f5f9', marginBottom: 0, color: '#64748b', fontSize: 13 }}>
          以下设备正在请求接入 OpenClaw，请审核并决定是否批准授权。
        </div>
        {loadingDevices && !devices?.data ? (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>
            <Spin tip="同步中..." size="small" />
          </div>
        ) : pendingDevices.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: 13 }}>暂无待处理的设备请求</div>
          </div>
        ) : (
          <List
            dataSource={pendingDevices}
            renderItem={(item: any) => (
              <List.Item 
                style={{ padding: '20px 0', borderBottom: '1px solid #f8fafc' }}
                actions={[
                  <Button 
                    key="approve"
                    type="primary" 
                    icon={<CheckCircle size={14} />} 
                    size="small"
                    onClick={() => onApproveDevice(item.requestId)}
                    style={{ borderRadius: 6, fontSize: 12 }}
                  >
                    批准授权
                  </Button>
                ]}
              >
                <List.Item.Meta
                  avatar={
                    <div style={{ 
                      width: 40, height: 40, borderRadius: 10, background: '#fffbeb',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b'
                    }}>
                      <Smartphone size={20} />
                    </div>
                  }
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 700, color: '#1e293b', fontSize: 15 }}>{item.displayName || '未知设备'}</span>
                      <Tag color="orange" style={{ borderRadius: 4, margin: 0, fontSize: 11 }}>待批准</Tag>
                    </div>
                  }
                  description={
                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '80px 1fr', gap: '4px 12px', fontSize: 12 }}>
                      <span style={{ color: '#94a3b8' }}>请求 ID:</span>
                      <Tooltip title={item.requestId}>
                        <span style={{ fontFamily: 'monospace', color: '#2563eb', background: '#eff6ff', padding: '1px 6px', borderRadius: 4, cursor: 'help' }}>
                          {item.requestId?.substring(0, 12)}...
                        </span>
                      </Tooltip>
                      <span style={{ color: '#94a3b8' }}>操作系统:</span>
                      <span style={{ color: '#475569' }}>{item.platform || '—'}</span>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      {/* 2. 已成功配对设备 */}
      <Card
        title={<span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}><Smartphone size={isMobile ? 18 : 20} color="#10b981" /> 已配对合规设备</span>}
        styles={{ body: { padding: isMobile ? '0 16px' : '0 24px' } }}
        style={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}
      >
        <div style={{ padding: '12px 0', borderBottom: '1px solid #f1f5f9', marginBottom: 0, color: '#64748b', fontSize: 13 }}>
          当前已成功配对并获准通过 OpenClaw 终端的合法设备及应用列表。
        </div>
        {loadingDevices && !devices?.data ? (
          <div style={{ padding: '40px 0', textAlign: 'center' }}>
            <Spin tip="同步中..." size="small" />
          </div>
        ) : pairedDevices.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: 13 }}>暂无已配对的设备信息</div>
          </div>
        ) : (
          <List
            dataSource={pairedDevices}
            renderItem={(item: any) => (
              <List.Item style={{ padding: '20px 0', borderBottom: '1px solid #f8fafc' }}>
                <List.Item.Meta
                  avatar={
                    <div style={{ 
                      width: 40, height: 40, borderRadius: 10, background: '#f0fdf4',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#10b981'
                    }}>
                      <Smartphone size={20} />
                    </div>
                  }
                  title={
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 700, color: '#1e293b', fontSize: 15 }}>{item.displayName || '未知设备'}</span>
                      <Tag color="success" style={{ borderRadius: 4, margin: 0, fontSize: 11 }}>已加固</Tag>
                    </div>
                  }
                  description={
                    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '80px 1fr', gap: '4px 12px', fontSize: 12 }}>
                      <span style={{ color: '#94a3b8' }}>设备 ID:</span>
                      <Tooltip title={item.deviceId}>
                        <span style={{ fontFamily: 'monospace', color: '#2563eb', background: '#eff6ff', padding: '1px 6px', borderRadius: 4, cursor: 'help' }}>
                          {item.deviceId?.substring(0, 12)}...
                        </span>
                      </Tooltip>
                      <span style={{ color: '#94a3b8' }}>操作系统:</span>
                      <span style={{ color: '#475569' }}>{item.platform || '—'}</span>
                      <span style={{ color: '#94a3b8' }}>运行模式:</span>
                      <span><Tag color="blue" style={{ margin: 0, fontSize: 10 }}>{item.clientMode || '—'}</Tag></span>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>
    </div>
  );
};

export default DeviceManager;
