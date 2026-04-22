import React from 'react';
import { Card, Tag, Button, Modal, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { Cloud, RefreshCw, Smartphone, Trash2, Send, MessageSquare, Bell, Settings, LayoutGrid, AlertCircle, Copy } from 'lucide-react';
import api from '../api';
import ChannelSetupModal from '../components/ChannelSetupModal';

interface ChannelStatus {
  id: string;
  configured: boolean;
  enabled: boolean;
  pluginStatus: string;
  pluginError: string;
}

interface ChannelsManagerProps {
  chatChannels: any;
  weixinStatus: any;
  loadingChannels: boolean;
  loadingWeixin: boolean;
  checkWeixinSeconds: number;
  isGettingQR: boolean;
  onInstallWeixin: () => void;
  onGetQRCode: () => void;
  onRefreshChannels: () => void;
  onRefreshWeixin?: () => void;
  refreshingWeixin?: boolean;
  onUnbindWeixin?: (id: string) => void;
  activeTasks?: any[];
  isMobile?: boolean;
  isRunning?: boolean;
  onNavigateToDashboard?: () => void;
  loadingBots?: boolean;
  loadingConfig?: boolean;
}

const ChannelsManager: React.FC<ChannelsManagerProps> = ({ 
  chatChannels, 
  weixinStatus, 
  loadingChannels, 
  loadingWeixin, 
  onInstallWeixin,
  onGetQRCode,
  onRefreshChannels,
  onRefreshWeixin,
  refreshingWeixin,
  onUnbindWeixin,
  isMobile,
  loadingBots = false,
  loadingConfig = false
}) => {
  const { t } = useTranslation();
  const channelsList = chatChannels?.data || [];
  const configuredChannels = channelsList.filter((c: any) => c.configured);
  
  const isRefreshing = loadingBots || loadingConfig || refreshingWeixin || loadingChannels;

  const [channelMetadata, setChannelMetadata] = React.useState<any[]>([]);
  const [channelStatus, setChannelStatus] = React.useState<ChannelStatus[]>([]);
  const [setupVisible, setSetupVisible] = React.useState(false);
  const [selectedChannel, setSelectedChannel] = React.useState<any>(null);
  const [accountsModalVisible, setAccountsModalVisible] = React.useState(false);
  const [, setLoadingMetadata] = React.useState(false);

  const [activeChannelAccounts, setActiveChannelAccounts] = React.useState<any[]>([]);
  const [managementTitle, setManagementTitle] = React.useState('');

  React.useEffect(() => {
    fetchMetadata();
    fetchStatus();
  }, []);

  const fetchMetadata = async () => {
    setLoadingMetadata(true);
    try {
      const res = await api.get('/v1/channels/metadata');
      setChannelMetadata(res.data.data || res.data || []);
    } catch (err) {
      console.error('Failed to fetch channel metadata');
    } finally {
      setLoadingMetadata(false);
    }
  };

  const fetchStatus = async () => {
    try {
      const res = await api.get('/v1/channels/status');
      setChannelStatus(res.data.data || res.data || []);
    } catch (err) {
      console.error('Failed to fetch channel status');
    }
  };

  const [unbindingChannel, setUnbindingChannel] = React.useState<string | null>(null);

  const handleUnbindChannel = (ch: any) => {
    Modal.confirm({
      title: t('common.confirmAction'),
      content: `确定要解绑 ${ch.name} 渠道吗？解绑后该渠道将不再路由消息给 Agent。`,
      okText: t('channels.unbind'),
      okButtonProps: { danger: true },
      cancelText: t('common.cancel'),
      onOk: async () => {
        setUnbindingChannel(ch.id);
        try {
          await api.delete(`/v1/channels/${ch.id}/setup`);
          message.success(`${ch.name} 解绑成功`);
          fetchStatus();
          onRefreshChannels();
        } catch (err: any) {
          message.error(`解绑失败: ${err?.response?.data?.message || err.message}`);
        } finally {
          setUnbindingChannel(null);
        }
      }
    });
  };

  const onUnbindAccount = (name: string) => {
    // 微信账号解绑逻辑（保留原有）
    const parts = name.split(/\s+/);
    const fullPrefix = parts[0];
    const accountId = parts.slice(1).join(' ');
    
    if (accountId && onUnbindWeixin) {
      Modal.confirm({
        title: t('common.confirmAction'),
        content: t('channels.unbindConfirm', { id: accountId }),
        okText: t('channels.unbind'),
        okButtonProps: { danger: true },
        cancelText: t('common.cancel'),
        onOk: () => {
          if (fullPrefix.includes('weixin')) {
            onUnbindWeixin(accountId);
          } else {
            message.info('通用解绑功能正在接入中...');
          }
        }
      });
    }
  };

  const showManagement = (ch: any) => {
    setSelectedChannel(ch);
    const prefix = `openclaw-${ch.id}`;
    const accounts = configuredChannels.filter((c: any) => c.name.toLowerCase().includes(prefix));
    setActiveChannelAccounts(accounts);
    setManagementTitle(ch.name);
    setAccountsModalVisible(true);
  };

  const getIcon = (iconName: string) => {
    switch (iconName) {
      case 'Lark': return <LayoutGrid size={24} color="#3b82f6" />;
      case 'Send': return <Send size={24} color="#0088cc" />;
      case 'MessageCircle': return <MessageSquare size={24} color="#12b7f5" />;
      case 'Bell': return <Bell size={24} color="#007fff" />;
      default: return <Settings size={24} color="#64748b" />;
    }
  };

  return (
    <div style={{ height: '100%', minHeight: 'calc(100vh - 100px)', width: '100%', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px' : '24px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, color: '#0f172a', margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
              <LayoutGrid size={isMobile ? 24 : 28} color="#2563eb" />
              {t('channels.title') || '渠道绑定管理'}
            </h1>
            <p style={{ color: '#64748b', fontSize: 13, marginTop: 4 }}>{t('channels.description') || '管理 OpenClaw 与各类社交平台的连接状态'}</p>
          </div>
          <Button 
            icon={<RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />} 
            onClick={() => {
              onRefreshChannels();
              if (onRefreshWeixin) onRefreshWeixin();
              fetchStatus();
            }}
            loading={isRefreshing}
            style={{ borderRadius: 8 }}
          >
            {t('common.refresh')}
          </Button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          
          <Card 
            styles={{ body: { padding: 16 } }}
            style={{ borderRadius: 12, border: '1px solid #e2e8f0', background: '#fff', boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ padding: 10, background: '#f0fdf4', borderRadius: 10, flexShrink: 0 }}>
                  <Smartphone size={24} color="#16a34a" />
                </div>
                <div>
                  <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 14 }}>微信官方插件</div>
                  <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{weixinStatus?.version ? `v${weixinStatus.version}` : 'openclaw-weixin'}</div>
                </div>
              </div>
              <Tag color={weixinStatus?.installed ? "success" : "default"} style={{ borderRadius: 4, margin: 0, border: 'none' }}>
                {weixinStatus?.installed ? t('channels.installed') : t('channels.notInstalled')}
              </Tag>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <Button 
                block 
                size="small" 
                icon={<Settings size={14} />} 
                onClick={() => showManagement({ id: 'weixin', name: '微信官方插件' })}
                style={{ borderRadius: 6, fontSize: 12 }}
              >
                {t('channels.manageAccounts') || '账号管理'}
              </Button>
              <Button 
                block 
                type="primary" 
                size="small" 
                loading={loadingWeixin}
                icon={<RefreshCw size={14} />} 
                onClick={() => {
                  if (weixinStatus?.installed) onGetQRCode();
                  else onInstallWeixin();
                }}
                style={{ borderRadius: 6, fontSize: 12 }}
              >
                {weixinStatus?.installed ? (t('channels.getLoginCode') || '获取二维码') : (t('channels.installPlugin') || '安装插件')}
              </Button>
            </div>
          </Card>

          {channelMetadata.map(ch => {
            const status = channelStatus.find(s => s.id === ch.id);
            const isConfigured = status?.configured || false;
            const pluginStatus = status?.pluginStatus || 'missing';
            
            return (
              <Card 
                key={ch.id}
                hoverable={pluginStatus === 'loaded'}
                onClick={() => {
                  if (pluginStatus === 'loaded') {
                    setSelectedChannel(ch);
                    setSetupVisible(true);
                  }
                }}
                styles={{ body: { padding: 16 } }}
                style={{ borderRadius: 12, border: '1px solid #e2e8f0', background: '#fff', opacity: pluginStatus === 'loaded' ? 1 : 0.8 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ padding: 10, background: '#f8fafc', borderRadius: 10, flexShrink: 0, opacity: pluginStatus === 'loaded' ? 1 : 0.5 }}>
                      {getIcon(ch.icon)}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 14 }}>{ch.name}</div>
                      <div style={{ color: '#64748b', fontSize: 11, marginTop: 2 }}>{ch.description}</div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {pluginStatus === 'loaded' ? (
                      isConfigured ? (
                        <>
                          <Tag color="success" style={{ borderRadius: 4, margin: 0, border: 'none', background: '#f0fdf4', color: '#16a34a' }}>
                            {t('channels.configured')}
                          </Tag>
                          <Button 
                            size="small"
                            danger
                            type="text"
                            icon={<Trash2 size={13} />}
                            loading={unbindingChannel === ch.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUnbindChannel(ch);
                            }}
                            style={{ fontSize: 12 }}
                          >
                            {t('channels.unbind')}
                          </Button>
                        </>
                      ) : (
                        <Button type="primary" size="small" ghost style={{ borderRadius: 6, fontSize: 12 }}>
                          {t('channels.setup')}
                        </Button>
                      )
                    ) : (
                      <Tag color={pluginStatus === 'disabled' ? 'warning' : 'error'} style={{ borderRadius: 4, margin: 0, border: 'none' }}>
                        {pluginStatus === 'disabled' ? '未启用' : '未安装'}
                      </Tag>
                    )}
                  </div>
                </div>
                
                {pluginStatus !== 'loaded' && (
                  <div style={{ marginTop: 16, padding: '12px', background: pluginStatus === 'disabled' ? '#fffbeb' : '#fef2f2', borderRadius: 8, border: `1px solid ${pluginStatus === 'disabled' ? '#fde68a' : '#fecaca'}`, display: 'flex', flexDirection: 'column', gap: 8 }} onClick={e => e.stopPropagation()}>
                    <div style={{ fontSize: 12, color: pluginStatus === 'disabled' ? '#d97706' : '#dc2626', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertCircle size={14} />
                      {pluginStatus === 'disabled' ? '此插件已安装但被禁用，请先启用：' : '此渠道插件尚未安装，请先安装：'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', background: 'rgba(0,0,0,0.03)', borderRadius: 6, padding: '6px 10px', gap: 8 }}>
                      <code style={{ fontSize: 11, color: '#334155', flex: 1, fontFamily: 'monospace', userSelect: 'all', wordBreak: 'break-all' }}>
                        {pluginStatus === 'disabled' 
                          ? `openclaw config set plugins.${ch.id}.enabled true` 
                          : `openclaw plugins install @openclaw/${ch.id}`}
                      </code>
                      <Button 
                        type="text" 
                        size="small" 
                        icon={<Copy size={12} />} 
                        onClick={() => {
                          navigator.clipboard.writeText(pluginStatus === 'disabled' 
                            ? `openclaw config set plugins.${ch.id}.enabled true` 
                            : `openclaw plugins install @openclaw/${ch.id}`);
                          message.success('已复制命令');
                        }}
                        style={{ width: 24, height: 24, minWidth: 24, padding: 0, color: '#64748b' }}
                      />
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        <Modal
          title={`${t('channels.manageAccounts')} - ${managementTitle}`}
          open={accountsModalVisible}
          onCancel={() => setAccountsModalVisible(false)}
          footer={null}
          width={600}
          centered
        >
          <div style={{ padding: '8px 0' }}>
            {activeChannelAccounts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#94a3b8' }}>
                <Cloud size={48} strokeWidth={1} style={{ marginBottom: 12 }} />
                <p>{t('channels.noAccountsInChannel') || '该渠道暂无已绑定账号'}</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {activeChannelAccounts.map((channel: any, index: number) => (
                  <Card 
                    key={index} 
                    styles={{ body: { padding: '12px 16px' } }}
                    style={{ borderRadius: 12, border: '1px solid #f1f5f9', background: '#f8fafc' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #e2e8f0' }}>
                          {selectedChannel?.id === 'weixin' ? <Smartphone size={18} color="#16a34a" /> : getIcon(selectedChannel?.icon)}
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b' }}>{channel.name}</div>
                        </div>
                      </div>
                      <Button 
                        danger 
                        size="small" 
                        type="text" 
                        icon={<Trash2 size={14} />}
                        onClick={() => onUnbindAccount(channel.name)}
                      >
                        {t('channels.unbind')}
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </Modal>

        <ChannelSetupModal 
          visible={setupVisible}
          channel={selectedChannel}
          onClose={() => setSetupVisible(false)}
          onSuccess={() => {
            fetchStatus();
            onRefreshChannels();
          }}
        />
      </div>
    </div>
  );
};

export default ChannelsManager;
