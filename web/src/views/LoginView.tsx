import React, { useState, useEffect } from 'react';
import { Button, Input, Form, message, Tabs } from 'antd';
import { KeyRound, User as UserIcon, Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../api';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { getBaseURL } from '../utils/url';
import storage from '../utils/storage';
import Tooltip from '../components/common/AppTooltip';

interface LoginViewProps {
  onLoginSuccess: (token: string) => void;
  isDarkMode?: boolean;
}

type LoginMode = 'password' | 'token';

const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<LoginMode>('password');
  const [isMobileLogin, setIsMobileLogin] = useState(window.innerWidth < 1024);
  const [displayText, setDisplayText] = useState('');
  const [index, setIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [speed, setSpeed] = useState(100);
  const quotes = (t('login.quotes', { returnObjects: true }) as any[]) || [];
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * quotes.length));

  const typewriterText = t('login.typewriter');

  useEffect(() => {
    const handleType = () => {
      if (!isDeleting) {
        if (index < typewriterText.length) {
          setDisplayText(prev => prev + typewriterText[index]);
          setIndex(prev => prev + 1);
          setSpeed(120);
        } else {
          setSpeed(4000);
          setIsDeleting(true);
        }
      } else {
        if (displayText.length > 0) {
          setDisplayText(prev => prev.slice(0, -1));
          setSpeed(40);
        } else {
          setIsDeleting(false);
          setIndex(0);
          setSpeed(1000);
          setQuoteIndex(prev => {
            let next = Math.floor(Math.random() * quotes.length);
            while (next === prev) next = Math.floor(Math.random() * quotes.length);
            return next;
          });
        }
      }
    };

    const timeout = setTimeout(handleType, speed);
    return () => clearTimeout(timeout);
  }, [displayText, isDeleting, index, speed, typewriterText, quotes.length]);

  useEffect(() => {
    const handleResize = () => setIsMobileLogin(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const loginImages = ['/openclaw.png', '/openclaw2.png', '/openclaw3.jpg'].map(img => getBaseURL() + img);
  const [mascotImage] = useState(() => loginImages[Math.floor(Math.random() * loginImages.length)]);

  const handlePasswordLogin = async (values: { username: string; password: string }) => {
    setLoading(true);
    try {
      const res = await api.post('/login', { username: values.username, password: values.password });
      const data: any = res.data || {};
      if (data.status === 'success' && data.token) {
        storage.setItem('guardian_token', data.token);
        onLoginSuccess(data.token);
        message.success(t('login.authSuccess'));
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || err.response?.data?.error || err.message || t('login.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  const handleTokenLogin = async (values: { token: string }) => {
    setLoading(true);
    try {
      const res = await api.post('/login', { token: values.token });
      const data: any = res.data || {};
      if (data.status === 'success') {
        const tk = data.token || values.token;
        storage.setItem('guardian_token', tk);
        onLoginSuccess(tk);
        message.success(t('login.authSuccess'));
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || err.response?.data?.error || err.message || t('login.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };

  const inputStyle = { borderRadius: 14, padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0' };
  const labelStyle: React.CSSProperties = { fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' };
  const horizontalFormLayout = {
    // 用 flex 而非栅格：更紧凑，避免左侧留白过大导致不美观
    labelCol: { flex: '72px' },
    wrapperCol: { flex: 1 },
    labelAlign: 'left' as const,
  };

  const passwordForm = (
    <Form
      layout="horizontal"
      colon={false}
      labelWrap={false}
      onFinish={handlePasswordLogin}
      size="large"
      autoComplete="off"
      style={{ width: '100%' }}
      {...horizontalFormLayout}
    >
      <Form.Item
        name="username"
        label={<span style={labelStyle}>{t('login.username')}</span>}
        rules={[{ required: true, message: t('login.usernameRequired') }]}
        style={{ marginBottom: 12 }}
      >
        <Input
          placeholder={t('login.usernamePlaceholder')}
          prefix={<UserIcon size={18} color="#94a3b8" style={{ marginRight: 8 }} />}
          style={inputStyle}
          autoComplete="username"
        />
      </Form.Item>
      <Form.Item
        name="password"
        label={<span style={labelStyle}>{t('login.password')}</span>}
        rules={[{ required: true, message: t('login.passwordRequired') }]}
        style={{ marginBottom: 12 }}
      >
        <Input.Password
          placeholder={t('login.passwordPlaceholder')}
          prefix={<Lock size={18} color="#94a3b8" style={{ marginRight: 8 }} />}
          style={inputStyle}
          autoComplete="current-password"
        />
      </Form.Item>
      <Button
        type="primary"
        htmlType="submit"
        block
        loading={loading}
        size="large"
        style={{
          height: 56, borderRadius: 12, fontWeight: 800, fontSize: 16,
          marginTop: 10, background: '#2563eb', border: 'none',
          boxShadow: '0 10px 15px -3px rgba(37,99,235,0.3)'
        }}
      >
        {t('login.button')}
      </Button>
    </Form>
  );

  const tokenForm = (
    <Form
      layout="horizontal"
      colon={false}
      labelWrap={false}
      onFinish={handleTokenLogin}
      size="large"
      style={{ width: '100%' }}
      {...horizontalFormLayout}
    >
      <Form.Item
        name="token"
        label={<span style={labelStyle}>{t('login.accessToken')}</span>}
        rules={[{ required: true, message: t('login.tokenRequired') }]}
        style={{ marginBottom: 12 }}
      >
        <Input.Password
          placeholder={t('login.tokenPlaceholder')}
          prefix={<KeyRound size={18} color="#94a3b8" style={{ marginRight: 8 }} />}
          style={inputStyle}
        />
      </Form.Item>
      <Button
        type="primary"
        htmlType="submit"
        block
        loading={loading}
        size="large"
        style={{
          height: 56, borderRadius: 12, fontWeight: 800, fontSize: 16,
          marginTop: 10, background: '#2563eb', border: 'none',
          boxShadow: '0 10px 15px -3px rgba(37,99,235,0.3)'
        }}
      >
        {t('login.button')}
      </Button>
    </Form>
  );

  return (
    <div style={{
      display: 'flex', minHeight: '100vh', background: '#fff',
      flexDirection: isMobileLogin ? 'column' : 'row',
      overflow: 'hidden',
    }}>
      {!isMobileLogin && (
        <div style={{
          flex: 7, background: '#0f172a', padding: '60px 64px 8px',
          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
          position: 'relative', overflow: 'hidden'
        }}>
          <div style={{
            position: 'absolute', top: 0, left: 0, right: 0, height: '100%',
            background: 'radial-gradient(circle at 10% 20%, rgba(37, 99, 235, 0.1) 0%, rgba(15, 23, 42, 0) 50%)',
            pointerEvents: 'none'
          }} />

          <div style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ fontSize: 24, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              🦞
            </div>
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em' }}>OpenClaw Buddy</span>
          </div>

          <div style={{ position: 'relative', zIndex: 1, maxWidth: 800 }}>
            <h1 style={{ color: '#fff', fontSize: 64, fontWeight: 900, lineHeight: 1.1, marginBottom: 32, letterSpacing: '-0.04em' }}>
              {quotes[quoteIndex].main}<br />
              <span style={{
                color: '#60a5fa',
                display: 'block',
                fontSize: 28,
                fontWeight: 700,
                paddingLeft: 180,
                marginTop: 12,
                whiteSpace: 'nowrap',
                letterSpacing: '0.05em',
                opacity: 0.85
              }}>
                {quotes[quoteIndex].sub}
              </span>
            </h1>


            <p style={{
              color: '#94a3b8',
              fontSize: 17,
              lineHeight: 1.8,
              marginBottom: 48,
              minHeight: '120px',
              fontStyle: 'italic',
              fontFamily: 'serif'
            }}>
              {displayText}
              <span style={{ display: 'inline-block', width: 2, height: 18, background: '#60a5fa', marginLeft: 4, verticalAlign: 'middle', animation: 'blink 1s step-end infinite' }} />
              <style>{`
                @keyframes blink {
                  from, to { opacity: 1; }
                  50% { opacity: 0; }
                }
              `}</style>
            </p>
            <div style={{ display: 'flex', gap: 16 }}>
              {['monit', 'alert', 'loop'].map(key => (
                <div key={key} style={{
                  background: 'rgba(255,255,255,0.05)', borderRadius: 20,
                  padding: '8px 20px', color: '#cbd5e1', fontSize: 13,
                  border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: 8
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6' }} />
                  {t(`login.features.${key}`)}
                </div>
              ))}
            </div>
          </div>

          <div />
        </div>
      )}

      <div style={{
        flex: isMobileLogin ? 1 : 3, background: '#fff',
        display: 'flex', flexDirection: 'column',
        padding: isMobileLogin ? '40px 24px 8px' : '60px 48px 8px',
        position: 'relative',
        overflow: 'hidden',
      }}>
        <div style={{ position: 'absolute', top: 24, left: 24, right: 24, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Tooltip title="GitHub">
            <a
              href="https://github.com/RandyChen1985/openclaw-buddy"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                width: 30,
                height: 30,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                border: '1px solid #e2e8f0',
                background: '#fff',
                color: '#334155',
                textDecoration: 'none',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.28 1.15-.28 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4" />
                <path d="M9 18c-4.51 2-5-2-7-2" />
              </svg>
            </a>
          </Tooltip>
          <LanguageSwitcher />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 400 }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
              <img
                src={mascotImage}
                alt="Mascot"
                style={{ width: '100%', maxWidth: 280, height: 'auto', display: 'block', maxHeight: 180, objectFit: 'contain' }}
              />
            </div>

            <div style={{ marginBottom: 24, textAlign: 'center' }}>
              <h2 style={{ fontSize: 32, fontWeight: 800, color: '#1e293b', margin: '0 0 10px', letterSpacing: '-0.02em' }}>{t('login.welcomeBack')}</h2>
              <p style={{ fontSize: 15, color: '#64748b', margin: 0 }}>{t('login.credentialsTip')}</p>
            </div>

            <Tabs
              activeKey={mode}
              onChange={(k) => setMode(k as LoginMode)}
              centered
              size="small"
              items={[
                { key: 'password', label: t('login.modePassword'), children: passwordForm },
                { key: 'token', label: t('login.modeToken'), children: tokenForm },
              ]}
            />
          </div>
        </div>

        <p style={{
          color: '#94a3b8',
          fontSize: 11,
          textAlign: 'center',
          marginTop: 8,
          marginBottom: 0
        }}>
          © {new Date().getFullYear()} OpenClaw Buddy · Copyright by Randy Chen · cexlong@gmail.com
        </p>
      </div>
    </div>
  );
};

export default LoginView;
