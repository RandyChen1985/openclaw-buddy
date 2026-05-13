import { AlertCircle, Bot } from 'lucide-react';

type NoBotPermissionOverlayProps = {
  isDarkMode: boolean;
  isMobile: boolean;
  t: (key: string, options?: Record<string, any>) => string;
};

export default function NoBotPermissionOverlay({ isDarkMode, isMobile, t }: NoBotPermissionOverlayProps) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 100,
        background: isDarkMode ? 'rgba(15, 23, 42, 0.94)' : 'rgba(248, 250, 252, 0.97)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        pointerEvents: 'auto',
      }}
      aria-live="polite"
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          padding: isMobile ? '28px 22px' : '36px 40px',
          borderRadius: 20,
          background: isDarkMode ? '#1e293b' : '#fff',
          border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
          boxShadow: isDarkMode
            ? '0 25px 50px -12px rgba(0, 0, 0, 0.55)'
            : '0 25px 50px -12px rgba(15, 23, 42, 0.15)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            margin: '0 auto 16px',
            borderRadius: 14,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isDarkMode ? '#0f172a' : '#fef3c7',
            border: `1px solid ${isDarkMode ? '#334155' : '#fde68a'}`,
          }}
        >
          <Bot size={28} color={isDarkMode ? '#93c5fd' : '#d97706'} strokeWidth={2} />
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            marginBottom: 12,
            fontWeight: 800,
            fontSize: 17,
            color: isDarkMode ? '#f1f5f9' : '#0f172a',
          }}
        >
          <AlertCircle size={20} color="#f59e0b" strokeWidth={2.5} />
          {t('users.noBotPermissionTitle', { defaultValue: '暂无 Bot 使用权限' })}
        </div>
        <p
          style={{
            margin: 0,
            fontSize: 14,
            lineHeight: 1.65,
            color: isDarkMode ? '#94a3b8' : '#64748b',
          }}
        >
          {t('users.noBotPermission', {
            defaultValue: '当前账号未分配任何 Bot 权限，请联系管理员分配后再使用。',
          })}
        </p>
      </div>
    </div>
  );
}
