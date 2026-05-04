import React from 'react';
import { Card, Tag, Button, Modal, message } from 'antd';
import { useTranslation } from 'react-i18next';
import { 
  Cloud, RefreshCw, Smartphone, Trash2, Send, MessageSquare, Bell, Settings, 
  LayoutGrid, AlertCircle, Copy, Users, HelpCircle 
} from 'lucide-react';
import api from '../api';

const HELP_URLS: Record<string, string> = {
  weixin: 'https://github.com/hao-ji-xing/openclaw-weixin/blob/main/packages/openclaw-weixin/README.zh_CN.md',
  feishu: 'https://open.feishu.cn/document/faq/trouble-shooting/how-to-obtain-app-id',
  lark: 'https://open.feishu.cn/document/faq/trouble-shooting/how-to-obtain-app-id',
  telegram: 'https://core.telegram.org/bots/tutorial',
  qqbot: 'https://q.qq.com/',
  dingtalk: 'https://open.dingtalk.com/document/orgapp/application-types',
};

import ChannelAccountsModal from '../components/ChannelAccountsModal';
import { channelPluginUiState, findPluginForChannel, type ChannelPluginUiState } from '../utils/channelPlugins';

interface ChannelStatus {
  id: string;
  configured: boolean;
  enabled: boolean;
  installed?: boolean;
  credentialConfigured?: boolean;
  credentialHint?: string;
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
  isDarkMode?: boolean;
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
  loadingConfig = false,
  isDarkMode = false
}) => {
  const { t } = useTranslation();
  const borderDefault = isDarkMode ? '#334155' : '#e2e8f0';
  const cardBg = isDarkMode ? '#1e293b' : '#fff';
  const pageHeading = isDarkMode ? '#f1f5f9' : '#0f172a';
  const pageMuted = isDarkMode ? '#94a3b8' : '#64748b';
  const dividerSubtle = isDarkMode ? '#334155' : '#f1f5f9';
  const iconBgMuted = isDarkMode ? '#0f172a' : '#f8fafc';
  const channelsList = chatChannels?.data || [];
  const configuredChannels = channelsList.filter((c: any) => c.configured);

  const [channelMetadata, setChannelMetadata] = React.useState<any[]>([]);
  const [channelStatus, setChannelStatus] = React.useState<ChannelStatus[]>([]);
  /** 与插件管理页同源：GET /v1/openclaw/plugins */
  const [pluginsList, setPluginsList] = React.useState<any[]>([]);
  const [loadingPlugins, setLoadingPlugins] = React.useState(false);
  const [pluginsListError, setPluginsListError] = React.useState<string | null>(null);

  const [selectedChannel, setSelectedChannel] = React.useState<any>(null);
  const [accountsModalVisible, setAccountsModalVisible] = React.useState(false);
  const [, setLoadingMetadata] = React.useState(false);

  const [activeChannelAccounts, setActiveChannelAccounts] = React.useState<any[]>([]);
  const [managementTitle, setManagementTitle] = React.useState('');
  const [routeAccountsOpen, setRouteAccountsOpen] = React.useState(false);
  const [routeAccountsChannel, setRouteAccountsChannel] = React.useState<any>(null);

  const isRefreshing = loadingBots || loadingConfig || refreshingWeixin || loadingChannels || loadingPlugins;

  const fetchOpenClawPlugins = async () => {
    setLoadingPlugins(true);
    setPluginsListError(null);
    try {
      const res = await api.get('/v1/openclaw/plugins');
      const body = res.data;
      const list = body?.data ?? body;
      setPluginsList(Array.isArray(list) ? list : []);
    } catch (err: any) {
      setPluginsListError(err?.message || 'fetch failed');
      setPluginsList([]);
    } finally {
      setLoadingPlugins(false);
    }
  };

  React.useEffect(() => {
    void Promise.all([fetchMetadata(), fetchStatus(), fetchOpenClawPlugins()]);
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
            <h1 style={{ fontSize: isMobile ? 20 : 24, fontWeight: 800, color: pageHeading, margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
              <LayoutGrid size={isMobile ? 24 : 28} color="#2563eb" />
              {t('channels.title') || '渠道绑定管理'}
            </h1>
            <p style={{ color: pageMuted, fontSize: 13, marginTop: 4 }}>{t('channels.description') || '管理 OpenClaw 与各类社交平台的连接状态'}</p>
          </div>
          <Button 
            icon={<RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />} 
            onClick={() => {
              onRefreshChannels();
              if (onRefreshWeixin) onRefreshWeixin();
              void Promise.all([fetchStatus(), fetchOpenClawPlugins()]);
            }}
            loading={isRefreshing}
            style={{ borderRadius: 8, background: isDarkMode ? '#0f172a' : undefined, borderColor: isDarkMode ? '#334155' : undefined, color: isDarkMode ? pageMuted : undefined }}
          >
            {t('common.refresh')}
          </Button>
        </div>

        {pluginsListError && (
          <div style={{ marginBottom: 16, padding: 12, background: isDarkMode ? '#0f172a' : '#f8fafc', borderRadius: 8, border: `1px solid ${borderDefault}`, fontSize: 13, color: pageMuted }}>
            {t('channels.pluginHintUnknown')}
            <span style={{ color: isDarkMode ? '#64748b' : '#94a3b8', marginLeft: 8 }}>({pluginsListError})</span>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
          
          <Card
            styles={{ body: { padding: 16 } }}
            style={{ borderRadius: 12, border: `1px solid ${borderDefault}`, background: cardBg, boxShadow: '0 2px 8px rgba(0,0,0,0.02)' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                  <div style={{ padding: 10, background: isDarkMode ? '#0f172a' : '#f0fdf4', borderRadius: 10, flexShrink: 0 }}>
                    <Smartphone size={24} color="#16a34a" />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: isDarkMode ? '#f1f5f9' : '#1e293b', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>                      {t('channels.weixinPlugin')}
                      <a href={HELP_URLS.weixin} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ display: 'flex' }}>
                        <HelpCircle size={14} color="#94a3b8" style={{ cursor: 'pointer' }} />
                      </a>
                    </div>
                    <div style={{ color: pageMuted, fontSize: 11, marginTop: 2, lineHeight: 1.45 }}>
                      {t('channels.weixinCardDescription')}
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, fontFamily: 'monospace' }}>
                      {weixinStatus?.version
                        ? t('channels.weixinPluginVersion', { version: weixinStatus.version })
                        : 'openclaw-weixin'}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                  <Tag color={weixinStatus?.installed ? 'success' : 'default'} style={{ borderRadius: 4, margin: 0, border: 'none' }}>
                    {weixinStatus?.installed ? t('channels.installed') : t('channels.notInstalled')}
                  </Tag>
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  justifyContent: 'flex-end',
                  gap: 8,
                  paddingTop: 8,
                  borderTop: `1px solid ${dividerSubtle}`,
                }}
              >
                <Button
                  size="small"
                  icon={<Users size={13} />}
                  onClick={() => showManagement({ id: 'weixin', name: t('channels.weixinPlugin') })}
                  style={{ fontSize: 12, borderRadius: 6, ...(isDarkMode ? { borderColor: '#334155', color: '#cbd5e1' } : {}) }}
                >
                  {t('channels.manageAccounts')}
                </Button>
                {weixinStatus?.installed ? (
                  <Button
                    type="default"
                    size="small"
                    loading={loadingWeixin}
                    icon={<RefreshCw size={14} />}
                    onClick={() => onGetQRCode()}
                    style={{
                      borderRadius: 6,
                      fontSize: 12,
                      background: '#07C160',
                      borderColor: '#059A54',
                      color: '#fff',
                    }}
                  >
                    {t('channels.getLoginCode')}
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    size="small"
                    loading={loadingWeixin}
                    icon={<RefreshCw size={14} />}
                    onClick={() => onInstallWeixin()}
                    style={{ borderRadius: 6, fontSize: 12 }}
                  >
                    {t('channels.installPlugin')}
                  </Button>
                )}
              </div>
            </div>
          </Card>

          {channelMetadata.map(ch => {
            const status = channelStatus.find(s => s.id === ch.id);
            const isConfigured = !!(status?.configured || status?.credentialConfigured);
            const pluginRow = findPluginForChannel(pluginsList, ch.id);
            const pluginUi: ChannelPluginUiState = pluginsListError ? 'unknown' : channelPluginUiState(pluginRow);
            const isLoaded = pluginUi === 'loaded';

            const installCmd = `openclaw plugins install @openclaw/${ch.id}`;
            const enableCmd = `openclaw plugins enable ${ch.id}`;

            const hintBg = isDarkMode
              ? (pluginUi === 'disabled' ? 'rgba(245,158,11,0.12)' : pluginUi === 'unknown' ? '#0f172a' : 'rgba(239,68,68,0.12)')
              : (pluginUi === 'disabled' ? '#fffbeb' : pluginUi === 'unknown' ? '#f8fafc' : '#fef2f2');
            const hintBorder = isDarkMode
              ? (pluginUi === 'disabled' ? 'rgba(245,158,11,0.35)' : pluginUi === 'unknown' ? '#334155' : 'rgba(248,113,113,0.45)')
              : (pluginUi === 'disabled' ? '#fde68a' : pluginUi === 'unknown' ? '#e2e8f0' : '#fecaca');
            const hintColor = isDarkMode
              ? (pluginUi === 'disabled' ? '#fbbf24' : pluginUi === 'unknown' ? '#94a3b8' : '#fca5a5')
              : (pluginUi === 'disabled' ? '#d97706' : pluginUi === 'unknown' ? '#64748b' : '#dc2626');

            const statusTag = (() => {
              if (isLoaded) return null;
              if (pluginUi === 'unknown') {
                return <Tag color="default" style={{ borderRadius: 4, margin: 0, border: 'none' }}>{t('channels.pluginUnknown')}</Tag>;
              }
              if (pluginUi === 'disabled') {
                return <Tag color="warning" style={{ borderRadius: 4, margin: 0, border: 'none' }}>{t('channels.pluginDisabled')}</Tag>;
              }
              return <Tag color="error" style={{ borderRadius: 4, margin: 0, border: 'none' }}>{t('channels.pluginMissing')}</Tag>;
            })();

            return (
              <Card 
                key={ch.id}
                hoverable={isLoaded}
                onClick={() => {
                  if (isLoaded) {
                    setRouteAccountsChannel(ch);
                    setRouteAccountsOpen(true);
                  }
                }}
                styles={{ body: { padding: 16 } }}
                style={{ borderRadius: 12, border: `1px solid ${borderDefault}`, background: cardBg, opacity: isLoaded ? 1 : 0.85 }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                      <div style={{ padding: 10, background: iconBgMuted, borderRadius: 10, flexShrink: 0, opacity: isLoaded ? 1 : 0.5 }}>
                        {getIcon(ch.icon)}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, color: isDarkMode ? '#f1f5f9' : '#1e293b', fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                          {ch.name}
                          {HELP_URLS[ch.id.toLowerCase()] && (
                            <a href={HELP_URLS[ch.id.toLowerCase()]} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ display: 'flex' }}>
                              <HelpCircle size={14} color="#94a3b8" style={{ cursor: 'pointer' }} />
                            </a>
                          )}
                        </div>
                        <div style={{ color: pageMuted, fontSize: 11, marginTop: 2 }}>{ch.description}</div>
                        {isLoaded && status?.credentialHint && (
                          <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4, fontFamily: 'monospace' }}>{status.credentialHint}</div>
                        )}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                      {isLoaded && isConfigured && (
                        <Tag color="success" style={{ borderRadius: 4, margin: 0, border: 'none', background: isDarkMode ? 'rgba(22,163,74,0.2)' : '#f0fdf4', color: '#16a34a' }}>
                          {t('channels.configured')}
                        </Tag>
                      )}
                      {!isLoaded && statusTag}
                    </div>
                  </div>
                  {isLoaded && (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        justifyContent: 'flex-end',
                        gap: 8,
                        paddingTop: 8,
                        borderTop: `1px solid ${dividerSubtle}`,
                      }}
                    >
                      <Button
                        type="primary"
                        ghost={isConfigured}
                        size="small"
                        icon={<Users size={13} />}
                        onClick={(e) => {
                          e.stopPropagation();
                          setRouteAccountsChannel(ch);
                          setRouteAccountsOpen(true);
                        }}
                        style={{ fontSize: 12, borderRadius: 6, ...(isDarkMode && isConfigured ? { borderColor: '#334155', color: '#cbd5e1' } : {}) }}
                      >
                        {t('channels.manageAccounts')}
                      </Button>
                    </div>
                  )}
                </div>
                
                {!isLoaded && (
                  <div style={{ marginTop: 16, padding: '12px', background: hintBg, borderRadius: 8, border: `1px solid ${hintBorder}`, display: 'flex', flexDirection: 'column', gap: 8 }} onClick={e => e.stopPropagation()}>
                    <div style={{ fontSize: 12, color: hintColor, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <AlertCircle size={14} />
                      {pluginUi === 'unknown' && t('channels.pluginHintUnknown')}
                      {pluginUi === 'missing' && t('channels.pluginHintMissing')}
                      {pluginUi === 'disabled' && t('channels.pluginHintDisabled')}
                    </div>
                    {(pluginUi === 'missing' || pluginUi === 'disabled') && (
                      <div style={{ display: 'flex', alignItems: 'center', background: isDarkMode ? 'rgba(15,23,42,0.6)' : 'rgba(0,0,0,0.03)', borderRadius: 6, padding: '6px 10px', gap: 8 }}>
                        <code style={{ fontSize: 11, color: isDarkMode ? '#cbd5e1' : '#334155', flex: 1, fontFamily: 'monospace', userSelect: 'all', wordBreak: 'break-all' }}>
                          {pluginUi === 'disabled' ? enableCmd : installCmd}
                        </code>
                        <Button 
                          type="text" 
                          size="small" 
                          icon={<Copy size={12} />} 
                          onClick={() => {
                            const cmd = pluginUi === 'disabled' ? enableCmd : installCmd;
                            void navigator.clipboard.writeText(cmd);
                            message.success(t('common.copySuccess'));
                          }}
                          style={{ width: 24, height: 24, minWidth: 24, padding: 0, color: pageMuted }}
                        />
                      </div>
                    )}
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
          styles={{
            content: { background: isDarkMode ? '#0f172a' : undefined },
            header: isDarkMode ? { background: '#1e293b', borderBottom: `1px solid ${borderDefault}`, color: pageHeading } : undefined,
            body: { background: isDarkMode ? '#0f172a' : undefined },
          }}
        >
          <div style={{ padding: '8px 0' }}>
            {activeChannelAccounts.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: pageMuted }}>
                <Cloud size={48} strokeWidth={1} style={{ marginBottom: 12 }} />
                <p>{t('channels.noAccountsInChannel') || '该渠道暂无已绑定账号'}</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {activeChannelAccounts.map((channel: any, index: number) => (
                  <Card 
                    key={index} 
                    styles={{ body: { padding: '12px 16px' } }}
                    style={{ borderRadius: 12, border: `1px solid ${dividerSubtle}`, background: isDarkMode ? '#0f172a' : '#f8fafc' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: isDarkMode ? '#1e293b' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `1px solid ${borderDefault}` }}>
                          {selectedChannel?.id === 'weixin' ? <Smartphone size={18} color="#16a34a" /> : getIcon(selectedChannel?.icon)}
                        </div>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: isDarkMode ? '#f1f5f9' : '#1e293b' }}>{channel.name}</div>
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

        <ChannelAccountsModal
          visible={routeAccountsOpen}
          channel={routeAccountsChannel ? { id: routeAccountsChannel.id, name: routeAccountsChannel.name } : null}
          onClose={() => {
            setRouteAccountsOpen(false);
            setRouteAccountsChannel(null);
          }}
          onAfterChange={() => {
            void Promise.all([fetchStatus(), fetchOpenClawPlugins()]);
            onRefreshChannels();
          }}
          isDarkMode={isDarkMode}
        />


      </div>
    </div>
  );
};

export default ChannelsManager;
