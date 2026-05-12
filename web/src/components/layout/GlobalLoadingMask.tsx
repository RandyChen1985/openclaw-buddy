import { Button, Spin } from 'antd';
import { RefreshCw } from 'lucide-react';

type GlobalLoadingMaskProps = {
  isDarkMode: boolean;
  isMobile: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
  isTransitioning: boolean;
  targetStatus: string | null;
  transitionSeconds: number;
  globalLoadingMessage: string | null;
  globalLoadingCountdown: number;
  dashboardProcessing: boolean;
  dashboardAbortCtrl: AbortController | null;
  onCloseTransition: () => void;
  onCancelDashboard: () => void;
};

export default function GlobalLoadingMask({
  isDarkMode,
  isMobile,
  t,
  isTransitioning,
  targetStatus,
  transitionSeconds,
  globalLoadingMessage,
  globalLoadingCountdown,
  dashboardProcessing,
  dashboardAbortCtrl,
  onCloseTransition,
  onCancelDashboard,
}: GlobalLoadingMaskProps) {
  if (!isTransitioning && !globalLoadingMessage && !dashboardProcessing) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: isDarkMode ? 'rgba(15, 23, 42, 0.8)' : 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(2px)',
      zIndex: 9999, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 20,
      animation: 'fadeIn 0.3s ease-out'
    }}>
      <div style={{
        padding: isMobile ? '24px 20px' : '32px 40px',
        background: isDarkMode ? '#1e293b' : '#fff', borderRadius: 24,
        boxShadow: isDarkMode ? '0 25px 50px -12px rgba(0, 0, 0, 0.5)' : '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
        width: isMobile ? '100%' : 'auto', maxWidth: 340, minWidth: isMobile ? 0 : 320
      }}>
        <Spin size="large" />
        <div style={{ textAlign: 'center' }}>
          {isTransitioning ? (
            <>
              <div style={{ fontWeight: 700, color: isDarkMode ? '#f1f5f9' : '#1e293b', fontSize: 16 }}>
                {targetStatus && t(`chat.status.${targetStatus}`)}
                {!targetStatus && t('chat.status.syncing')}
              </div>
              <div style={{ color: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 13, marginTop: 6 }}>
                {targetStatus && t(`chat.status.${targetStatus}_desc`)}
                {!targetStatus && t('common.waitingGateway')}
              </div>
              <div style={{
                marginTop: 16, padding: '6px 16px', background: isDarkMode ? '#1e293b' : '#eff6ff',
                borderRadius: 20, fontSize: 13, color: '#2563eb',
                fontWeight: 700, display: 'inline-block', border: `1px solid ${isDarkMode ? '#334155' : '#dbeafe'}`
              }}>
                {t('common.secondsElapsed', { seconds: transitionSeconds })}
              </div>
            </>
          ) : globalLoadingMessage ? (
            <>
              <div style={{ fontWeight: 700, color: isDarkMode ? '#f1f5f9' : '#1e293b', fontSize: 16 }}>{globalLoadingMessage}</div>
              <div style={{ color: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 13, marginTop: 6 }}>{t('common.waiting')}</div>
              <div style={{
                marginTop: 16, padding: '6px 16px', background: isDarkMode ? '#1e293b' : '#eff6ff',
                borderRadius: 20, fontSize: 13, color: '#2563eb',
                fontWeight: 700, display: 'inline-block', border: `1px solid ${isDarkMode ? '#334155' : '#dbeafe'}`
              }}>
                {globalLoadingCountdown > 0 ? t('common.loadingCountdown', { seconds: globalLoadingCountdown }) : t('common.syncing')}
              </div>
            </>
          ) : dashboardProcessing ? (
            <>
              <div style={{ fontWeight: 700, color: isDarkMode ? '#f1f5f9' : '#1e293b', fontSize: 18, marginBottom: 4 }}>
                {t('common.lobsterPanel')}
              </div>
              <div style={{ color: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 13, lineHeight: 1.6 }}>
                正在提取安全管理地址...<br />
                这可能需要几秒钟时间
              </div>
              <Button
                danger
                style={{ marginTop: 24, borderRadius: 12, height: 40 }}
                onClick={() => {
                  dashboardAbortCtrl?.abort();
                  onCancelDashboard();
                }}
              >
                {t('common.cancel')}
              </Button>
            </>
          ) : null}
        </div>
        {isTransitioning && transitionSeconds > 60 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 12, width: '100%', paddingTop: 20, borderTop: '1px solid #f1f5f9' }}>
            <Button block onClick={onCloseTransition}>{t('common.close')}</Button>
            <Button block type="primary" icon={<RefreshCw size={14} />} onClick={() => window.location.reload()}>{t('common.refresh')}</Button>
          </div>
        )}
      </div>
    </div>
  );
}
