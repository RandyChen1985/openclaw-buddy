import React from 'react';
import { Card, Tag, Spin, Button, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { CheckCircle, Cloud, RefreshCw, Zap, AlertCircle, Smartphone, Radar, Trash2 } from 'lucide-react';
import dayjs from 'dayjs';

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
  onUnbindWeixin?: (id: string) => void;
  activeTasks?: any[]; // 新增：用于检测解绑任务状态
  isMobile?: boolean; // 新增
}

const ChannelsManager: React.FC<ChannelsManagerProps> = ({ 
  chatChannels, 
  weixinStatus, 
  loadingChannels, 
  loadingWeixin, 
  checkWeixinSeconds, 
  isGettingQR,
  onInstallWeixin,
  onGetQRCode,
  onRefreshChannels,
  onUnbindWeixin,
  activeTasks = [],
  isMobile
}) => {
  const { t } = useTranslation();
  const channelsList = chatChannels?.data || [];
  const configuredChannels = channelsList.filter((c: any) => c.configured);
  const hasWeixinConfig = configuredChannels.some((c: any) => c.name.toLowerCase().includes('weixin'));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 已绑定渠道概览 */}
      <Card
        title={
          <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', width: '100%', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 8 : 12 }}>
            <span style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: '#1e293b', display: 'flex', alignItems: 'center', gap: 8 }}>
              <CheckCircle size={isMobile ? 18 : 20} color="#10b981" /> {t('channels.boundChannels')}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, width: isMobile ? '100%' : 'auto', justifyContent: isMobile ? 'space-between' : 'flex-end' }}>
              {chatChannels?.updated_at && (
                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>
                  {t('channels.syncedAt')}: {dayjs(chatChannels.updated_at).format('YYYY-MM-DD HH:mm:ss')}
                </span>
              )}
              <Button 
                type="text" 
                size="small" 
                icon={<RefreshCw size={14} className={loadingChannels ? 'animate-spin' : ''} />} 
                onClick={onRefreshChannels}
                loading={loadingChannels}
                style={{ color: '#64748b', display: 'flex', alignItems: 'center', padding: isMobile ? '0 4px' : '0 8px' }}
              >
                {isMobile ? '' : t('common.refresh')}
              </Button>
            </div>
          </div>
        }
        styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: isMobile ? 40 : 48 }, body: { padding: isMobile ? '16px 16px' : '16px 24px' } }}
        style={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}
      >
        {loadingChannels && !chatChannels?.data ? (
          <div style={{ textAlign: 'center', padding: '12px 0' }}>
            <Spin size="small" tip={t('channels.syncing')} />
          </div>
        ) : configuredChannels.length === 0 ? (
          <div style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', padding: '12px 0' }}>
            {t('channels.noChannels')}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {configuredChannels.map((c: any) => {
              const weixinId = c.name.toLowerCase().includes('weixin') ? (() => {
                const match = c.name.match(/openclaw-weixin\s+([^:]+)/i);
                return match ? match[1].trim() : null;
              })() : null;

              return (
                <div key={c.name} style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: '100%' }}>
                  <Tag 
                    color="blue" 
                    icon={<CheckCircle size={12} />} 
                    style={{ 
                      borderRadius: 8, 
                      padding: '6px 12px', 
                      margin: 0,
                      fontSize: 13,
                      display: 'flex',
                      alignItems: 'center',
                      background: '#f0f7ff',
                      border: '1px solid #dbeafe',
                      color: '#1d4ed8',
                      flex: 1,
                      maxWidth: 'fit-content',
                      whiteSpace: 'normal',
                      height: 'auto',
                      lineHeight: '1.5'
                    }}
                  >
                    {c.name}
                  </Tag>
                  {weixinId && onUnbindWeixin && (
                    <Button
                      type="text"
                      danger
                      size="small"
                      icon={<Trash2 size={14} />}
                      loading={activeTasks.some(t => 
                        t.module === 'wechat' && 
                        t.action === 'unbind' && 
                        t.target === weixinId && 
                        (t.status === 'Running' || t.status === 'Pending')
                      )}
                      onClick={() => {
                        Modal.confirm({
                          title: t('common.confirmAction'),
                          content: t('channels.unbindConfirm', { id: weixinId }),
                          okText: t('channels.unbind'),
                          okButtonProps: { danger: true },
                          cancelText: t('common.cancel'),
                          onOk: () => onUnbindWeixin(weixinId)
                        });
                      }}
                      style={{ flexShrink: 0, padding: '0 4px' }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 微信插件状态卡片 */}
      <style>{`
        @keyframes radar-scan {
          0% { transform: scale(0.9); opacity: 0.8; }
          50% { transform: scale(1.4); opacity: 0.3; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        .radar-pulse-container {
          position: relative;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .radar-ring {
          position: absolute;
          width: 100%;
          height: 100%;
          border-radius: 50%;
          border: 2px solid var(--radar-color, #3b82f6);
          animation: radar-scan 1.5s cubic-bezier(0, 0, 0.2, 1) infinite;
        }
      `}</style>
      <Card
        styles={{ body: { padding: 20 } }}
        style={{ borderRadius: 12, border: '1px solid #e2e8f0', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1 }}>
            <div style={{ padding: 12, background: '#eef2ff', borderRadius: 12, flexShrink: 0 }}>
              <Cloud size={24} color="#4f46e5" />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 15, marginBottom: 4 }}>
                {t('channels.weixinPlugin')} (openclaw-weixin)
              </div>
              <div style={{ color: '#64748b', fontSize: 12 }}>
                {weixinStatus === null 
                  ? t('channels.connecting')
                  : weixinStatus.installed 
                    ? t('channels.runningManaged', { status: weixinStatus.status })
                    : t('channels.coreMissing')}
              </div>
            </div>
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
            {weixinStatus === null ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <span style={{ fontSize: 13, color: '#ef4444', fontWeight: 600 }}>{t('channels.monitoring')} ({checkWeixinSeconds}s)</span>
                <div className="radar-pulse-container" style={{ width: 32, height: 32, '--radar-color': '#ef4444' } as any}>
                  <div className="radar-ring"></div>
                  <div className="radar-ring" style={{ animationDelay: '0.5s' }}></div>
                  <Radar size={24} color="#ef4444" style={{ position: 'relative', zIndex: 1 }} />
                </div>
              </div>
            ) : weixinStatus.installed ? (
              <Tag color="success" style={{ borderRadius: 6, fontSize: 12, padding: '4px 12px', border: 'none', background: '#f0fdf4', color: '#16a34a', fontWeight: 600 }}>
                {t('channels.installed')} v{weixinStatus.version}
              </Tag>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Tag color="error" style={{ borderRadius: 4, fontSize: 11 }}>{t('channels.notInstalled')}</Tag>
                <Button 
                  type="primary" 
                  icon={<Zap size={14} />} 
                  loading={loadingWeixin}
                  onClick={onInstallWeixin}
                  style={{ borderRadius: 8, height: 36 }}
                >
                  {t('channels.installPlugin')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* 微信登录卡片 */}
      <div style={{ marginTop: 20, position: 'relative', overflow: 'hidden', borderRadius: 12 }}>
        {/* 监测中遮罩层 */}
        {weixinStatus === null && (
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(4px)',
            zIndex: 10, display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', gap: 12, borderRadius: 12, border: '1px solid #e2e8f0',
            transition: 'all 0.3s ease'
          }}>
            <div className="radar-pulse-container" style={{ width: 48, height: 48, '--radar-color': '#94a3b8' } as any}>
              <div className="radar-ring"></div>
              <div className="radar-ring" style={{ animationDelay: '0.4s' }}></div>
              <Radar size={32} color="#94a3b8" style={{ position: 'relative', zIndex: 1 }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#1e293b' }}>{t('channels.monitoringStatus')}</span>
              <span style={{ fontSize: 12, color: '#64748b' }}>{t('channels.confirmingCore')} ({checkWeixinSeconds}s)</span>
            </div>
          </div>
        )}

        {hasWeixinConfig && (
          <div style={{ 
            background: '#fffbeb', color: '#b45309', fontSize: 11, 
            padding: '8px 20px', borderRadius: '12px 12px 0 0', 
            border: '1px solid #fef3c7', borderBottom: 'none',
            display: 'flex', alignItems: 'center', gap: 8,
            fontWeight: 600, width: '100%'
          }}>
            <AlertCircle size={14} /> {t('channels.overwriteWarning')}
          </div>
        )}
        <Card
          onClick={() => {
            if (isGettingQR || weixinStatus === null) return;
            if (weixinStatus?.installed) onGetQRCode();
          }}
          styles={{ body: { padding: 20 } }}
          style={{ 
            borderRadius: hasWeixinConfig ? '0 0 12px 12px' : 12, border: '1px solid #e2e8f0', 
            cursor: weixinStatus?.installed ? 'pointer' : 'not-allowed', 
            transition: 'all 0.3s',
            filter: weixinStatus === null ? 'blur(1px)' : 'none' // 遮罩下方的轻微模糊
          }}
          hoverable={weixinStatus?.installed && weixinStatus !== null}
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
                  {t('channels.getLoginCode')}
                </div>
                <div style={{ color: '#64748b', fontSize: 12 }}>{t('channels.getLoginCodeDesc')}</div>
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
                {t('channels.getNow')} <RefreshCw size={12} />
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default ChannelsManager;
