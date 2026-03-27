import React from 'react';
import { Card, Tag, Spin, Button } from 'antd';
import { CheckCircle, Cloud, RefreshCw, Zap, AlertCircle, Smartphone } from 'lucide-react';

interface ChannelsManagerProps {
  chatChannels: any;
  weixinStatus: any;
  loadingChannels: boolean;
  loadingWeixin: boolean;
  checkWeixinSeconds: number;
  isGettingQR: boolean;
  onInstallWeixin: () => void;
  onGetQRCode: () => void;
}

const ChannelsManager: React.FC<ChannelsManagerProps> = ({ 
  chatChannels, 
  weixinStatus, 
  loadingChannels, 
  loadingWeixin, 
  checkWeixinSeconds, 
  isGettingQR,
  onInstallWeixin,
  onGetQRCode
}) => {
  const channelsList = chatChannels?.data || [];
  const configuredChannels = channelsList.filter((c: any) => c.configured);
  const hasWeixinConfig = configuredChannels.some((c: any) => c.name.toLowerCase().includes('weixin'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 已绑定渠道概览 */}
      <Card
        title={
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 500, color: '#475569' }}>
            <CheckCircle size={14} /> 已绑定渠道
          </span>
        }
        styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 40 }, body: { padding: '16px 20px' } }}
        style={{ borderRadius: 12, border: '1px solid #e2e8f0', marginBottom: 20 }}
      >
        {loadingChannels && !chatChannels?.data ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <Spin size="small" tip="正在同步渠道信息..." />
          </div>
        ) : configuredChannels.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>
            暂无已绑定渠道，请在下方选择插件进行配置
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {configuredChannels.map((c: any) => (
              <Tag key={c.name} color="blue" icon={<CheckCircle size={10} />} style={{ borderRadius: 4, padding: '2px 8px' }}>
                {c.name}
              </Tag>
            ))}
          </div>
        )}
      </Card>

      {/* 微信插件状态卡片 */}
      <Card
        styles={{ body: { padding: 20 } }}
        style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{ padding: 12, background: '#eef2ff', borderRadius: 12, flexShrink: 0 }}><Cloud size={24} color="#4f46e5" /></div>
            <div>
              <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 15, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                微信官方插件 (openclaw-weixin)
                {weixinStatus === null ? (
                  <Tag color="processing" icon={<RefreshCw size={10} style={{ animation: 'spin 2s linear infinite' }} />} style={{ borderRadius: 4, fontSize: 11 }}>监测中 ({checkWeixinSeconds}s)</Tag>
                ) : weixinStatus.installed ? (
                  <Tag color="success" style={{ borderRadius: 4, fontSize: 11 }}>已安装 v{weixinStatus.version}</Tag>
                ) : (
                  <Tag color="error" style={{ borderRadius: 4, fontSize: 11 }}>未安装</Tag>
                )}
              </div>
              <div style={{ color: '#64748b', fontSize: 12 }}>
                {weixinStatus === null 
                  ? '正在连接插件系统并检索状态...'
                  : weixinStatus.installed 
                    ? `运行状态: ${weixinStatus.status} (已托管至配置中心)`
                    : '核心组件缺失，需完成安装后方可获取登录码'}
              </div>
            </div>
          </div>
          {weixinStatus !== null && !weixinStatus.installed && (
            <Button 
              type="primary" 
              icon={<Zap size={14} />} 
              loading={loadingWeixin}
              onClick={onInstallWeixin}
              style={{ borderRadius: 8, height: 36 }}
            >
              一键安装插件
            </Button>
          )}
        </div>
      </Card>

      {/* 微信登录卡片 */}
      <div style={{ marginTop: 20 }}>
        {hasWeixinConfig && (
          <div style={{ 
            background: '#fffbeb', color: '#b45309', fontSize: 11, 
            padding: '8px 20px', borderRadius: '12px 12px 0 0', 
            border: '1px solid #fef3c7', borderBottom: 'none',
            display: 'flex', alignItems: 'center', gap: 8,
            fontWeight: 600, width: '100%'
          }}>
            <AlertCircle size={14} /> 已经绑定过微信，重复绑定则覆盖之前的配置
          </div>
        )}
        <Card
          onClick={() => {
            if (isGettingQR) return;
            if (weixinStatus?.installed) onGetQRCode();
          }}
          styles={{ body: { padding: 20 } }}
          style={{ 
            borderRadius: hasWeixinConfig ? '0 0 12px 12px' : 12, border: '1px solid #e2e8f0', 
            cursor: weixinStatus?.installed ? 'pointer' : 'not-allowed', 
            transition: 'all 0.3s'
          }}
          hoverable={weixinStatus?.installed}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ 
                padding: 12, 
                background: weixinStatus?.installed ? '#f0fdf4' : '#f1f5f9', 
                borderRadius: 12, 
                flexShrink: 0,
                transition: 'all 0.3s'
              }}>
                <Smartphone size={24} color={weixinStatus?.installed ? '#16a34a' : '#94a3b8'} />
              </div>
              <div>
                <div style={{ 
                  fontWeight: 700, 
                  color: weixinStatus?.installed ? '#1e293b' : '#64748b', 
                  fontSize: 15, 
                  marginBottom: 4,
                  transition: 'all 0.3s'
                }}>
                  获取微信登录码
                </div>
                <div style={{ color: '#64748b', fontSize: 12 }}>生成用于身份授权的微信二维码，用于绑定个人微信，有效期 5 分钟</div>
              </div>
            </div>
            {weixinStatus?.installed && (
              <div style={{ 
                color: '#16a34a', 
                fontSize: 12, 
                fontWeight: 500, 
                display: 'flex', 
                alignItems: 'center', 
                gap: 4 
              }}>
                立即获取 <RefreshCw size={12} />
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default ChannelsManager;
