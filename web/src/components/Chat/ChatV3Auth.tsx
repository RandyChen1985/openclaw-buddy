import React from 'react';
import { ShieldCheck, Key, Cpu, RefreshCw } from 'lucide-react';
import { Button } from 'antd';

interface ChatV3AuthProps {
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';
  isMobile: boolean;
  onConnect: () => void;
  t: any;
}

const ChatV3Auth: React.FC<ChatV3AuthProps> = ({ status, isMobile, onConnect, t }) => {
  if (status === 'authenticated') return null;

  return (
    <div className="v3-auth-container" style={{
      position: 'absolute',
      top: 0, left: 0, right: 0, bottom: 0,
      background: '#f8fafc',
      zIndex: 1000,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'column',
      animation: 'v3-fade-in 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
      width: '100%',
      height: '100%',
      overflow: 'hidden'
    }}>
      <div className="v3-auth-card">
        <div className="v3-scan-line-element" />
        <div className="v3-icon-box">
          <div className="v3-icon-ring" />
          {status === 'error' ? (
            <ShieldCheck size={36} color="#ef4444" />
          ) : status === 'authorizing' ? (
            <Key size={36} color="#2563eb" />
          ) : (
            <Cpu size={36} color="#2563eb" className="animate-spin" style={{ animationDuration: '3s' }} />
          )}
        </div>
        
        <div style={{ fontWeight: 800, fontSize: isMobile ? 20 : 24, color: '#1e293b', marginBottom: 12, letterSpacing: '-0.02em', fontFamily: 'monospace' }}>
          {status === 'error' ? t('chat.v3StatusAuthFailed', { defaultValue: 'AUTH_FAILED' }) :
            status === 'connecting' ? t('chat.v3StatusConnecting', { defaultValue: 'CONNECTING...' }) :
            status === 'challenging' ? t('chat.v3StatusHandshaking', { defaultValue: 'HANDSHAKING...' }) : 
            status === 'authorizing' ? t('chat.v3StatusAuthorizing', { defaultValue: 'AUTHORIZING...' }) : t('chat.v3StatusIdentifying', { defaultValue: 'IDENTIFYING...' })}
        </div>
        
        <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginBottom: 24, fontFamily: 'monospace' }}>
          {status === 'error' ? (
            <div style={{ color: '#ef4444', background: 'rgba(239, 68, 68, 0.05)', padding: '8px 12px', borderRadius: 8, fontSize: 11, border: '1px solid rgba(239, 68, 68, 0.1)' }}>
              [ERROR] {t('chat.v3ErrorDesc', { defaultValue: 'TARGET_UNREACHABLE_OR_DENIED' })}
            </div>
          ) : status === 'authorizing' ? (
            t('chat.v3AuthorizingDesc', { defaultValue: 'DEVICE_NODE_HANDSHAKE_IN_PROGRESS...' })
          ) : t('chat.v3SecureDesc', { defaultValue: 'SECURE_CHANNEL_V3 // ED25519_HARDWARE_KEY' })}
        </div>
        
        {status === 'error' && (
          <Button 
            type="primary" 
            size="large" 
            onClick={onConnect} 
            icon={<RefreshCw size={18} />}
            style={{ width: '100%', height: 46, borderRadius: 12, background: '#2563eb', fontWeight: 600, border: 'none', boxShadow: '0 4px 15px rgba(37, 99, 235, 0.3)' }}
          >
            {t('chat.v3RetryBtn', { defaultValue: 'RETRY_CONNECTION' })}
          </Button>
        )}

        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center', gap: 4 }}>
            {[1,2,3,4].map(i => (
              <div key={i} style={{ width: 4, height: 4, background: '#2563eb', borderRadius: '50%', opacity: 0.1 + (i*0.1) }} />
            ))}
        </div>
      </div>
      
      <div style={{ position: 'absolute', bottom: 24, fontSize: 10, color: 'rgba(37, 99, 235, 0.2)', fontWeight: 600, letterSpacing: '4px', fontFamily: 'monospace' }}>
        OPENCLAW_SECURE_TUNNEL_V3.0
      </div>
    </div>
  );
};

export default ChatV3Auth;
