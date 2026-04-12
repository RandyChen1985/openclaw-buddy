import React from 'react';
import { Tag as AntdTag } from 'antd';
import { Cpu as CpuIcon } from 'lucide-react';

interface ChatV3EmptyStateProps {
  isMobile: boolean;
  t: any;
}

const ChatV3EmptyState: React.FC<ChatV3EmptyStateProps> = ({ isMobile, t }) => {
  return (
    <div style={{ 
      flex: 1, height: '100%',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: isMobile ? '12px' : '24px',
      boxSizing: 'border-box'
    }}>
      <div style={{ margin: '0 auto', textAlign: 'center', maxWidth: isMobile ? '100%' : 400, padding: isMobile ? '20px 0' : '40px', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ background: '#eff6ff', width: isMobile ? 64 : 80, height: isMobile ? 64 : 80, borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', color: '#2563eb' }}>
          <CpuIcon size={isMobile ? 32 : 40} />
        </div>
        <h3 style={{ fontSize: isMobile ? 18 : 20, fontWeight: 800, color: '#1e293b', marginBottom: 12 }}>{t('chat.v3Ready')}</h3>
        <p style={{ color: '#64748b', lineHeight: 1.6, fontSize: isMobile ? 13 : 14, padding: isMobile ? '0 10px' : 0 }}>{t('chat.v3ReadyDesc')}</p>
        
        <div style={{ marginTop: 24, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
          <AntdTag style={{ borderRadius: 10, padding: isMobile ? '2px 8px' : '4px 12px', fontSize: isMobile ? 11 : 12, margin: 0 }}>{t('chat.v3LowLatency', { defaultValue: '⚡ 低延迟' })}</AntdTag>
          <AntdTag style={{ borderRadius: 10, padding: isMobile ? '2px 8px' : '4px 12px', fontSize: isMobile ? 11 : 12, margin: 0 }}>{t('chat.v3Secure', { defaultValue: '🔒 Ed25519' })}</AntdTag>
          <AntdTag style={{ borderRadius: 10, padding: isMobile ? '2px 8px' : '4px 12px', fontSize: isMobile ? 11 : 12, margin: 0 }}>{t('chat.v3CloudSync', { defaultValue: '🌐 云同步' })}</AntdTag>
        </div>
      </div>
    </div>
  );
};

export default ChatV3EmptyState;
