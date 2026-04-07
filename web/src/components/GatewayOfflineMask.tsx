import React from 'react';
import { Button } from 'antd';
import { ShieldAlert, ArrowRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface GatewayOfflineMaskProps {
  onNavigateToDashboard?: () => void;
}

const GatewayOfflineMask: React.FC<GatewayOfflineMaskProps> = ({ onNavigateToDashboard }) => {
  const { t } = useTranslation();

  return (
    <div style={{
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(255, 255, 255, 0.65)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      zIndex: 2000,
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingTop: '10vh',
      borderRadius: 'inherit'
    }}>
      <div style={{ 
        maxWidth: 400, 
        width: '90%',
        padding: 40,
        background: '#fff',
        borderRadius: 24,
        boxShadow: '0 20px 50px rgba(0,0,0,0.1)',
        textAlign: 'center',
        border: '1px solid rgba(255,255,255,0.8)'
      }}>
        <div style={{ 
          width: 80, height: 80, borderRadius: 24, background: '#eff6ff', 
          display: 'flex', alignItems: 'center', justifyContent: 'center', 
          margin: '0 auto 24px', color: '#2563eb' 
        }}>
          <ShieldAlert size={40} />
        </div>
        <h2 style={{ fontSize: 24, fontWeight: 800, color: '#1e293b', marginBottom: 12 }}>
          {t('common.gatewayOffline', { defaultValue: '网关未运行' })}
        </h2>
        <p style={{ color: '#64748b', fontSize: 15, lineHeight: 1.6, marginBottom: 32 }}>
          {t('common.gatewayOfflineDesc', { defaultValue: '当前操作依赖 OpenClaw Gateway 服务。请先前往“运行状态”页面中启动网关。' })}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {onNavigateToDashboard && (
            <Button 
              type="primary" 
              size="large" 
              icon={<ArrowRight size={18} />}
              onClick={onNavigateToDashboard}
              style={{ height: 48, borderRadius: 12, background: '#2563eb', border: 'none', fontWeight: 600, fontSize: 16 }}
            >
              {t('common.goToStartGateway', { defaultValue: '去启动网关' })}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
};

export default GatewayOfflineMask;
