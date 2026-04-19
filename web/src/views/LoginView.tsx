import React, { useState, useEffect } from 'react';
import { Button, Input, Form, message } from 'antd';
import { KeyRound } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import api from '../api';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { getBaseURL } from '../utils/url';
import storage from '../utils/storage';

interface LoginViewProps {
  onLoginSuccess: (token: string) => void;
}

const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
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
          setSpeed(120); // 慢一点的打印速度
        } else {
          // 打印完停顿 4 秒
          setSpeed(4000);
          setIsDeleting(true);
        }
      } else {
        if (displayText.length > 0) {
          setDisplayText(prev => prev.slice(0, -1));
          setSpeed(40); // 快速退格
        } else {
          setIsDeleting(false);
          setIndex(0);
          setSpeed(1000); // 重新开始前的停顿
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

  const onFinish = async (values: { token: string }) => {
    setLoading(true);
    const apiBase = getBaseURL();
    console.log(`🔐 [Auth] Attempting login. BaseURL: ${apiBase}, Token Length: ${values.token?.length}`);
    
    try {
      const res = await api.post('/login', { token: (values.token || '').trim() });
      if (res.data.status === 'success') {
        const trimmedToken = (values.token || '').trim();
        storage.setItem('guardian_token', trimmedToken);
        // 增加 100ms 延迟确保 storage 状态被 React 分发
        setTimeout(() => {
           onLoginSuccess(trimmedToken);
           message.success(t('login.authSuccess'));
        }, 100);
      }
    } catch (err: any) {
      console.error('🔐 [Auth] Login failed:', err.response?.data || err.message);
      message.error(err.response?.data?.error || t('login.invalidCredentials'));
    } finally {
      setLoading(false);
    }
  };


  return (
    <div style={{
      display: 'flex', minHeight: '100vh', background: '#fff',
      flexDirection: isMobileLogin ? 'column' : 'row'
    }}>
      {/* 左侧装饰区 (Dark, 3:2 比例中的 "3") - 移动端彻底移除 */}
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

      {/* 右侧面板 (White, 3:2 比例中的 "2") */}
      <div style={{
        flex: isMobileLogin ? 1 : 3, background: '#fff',
        display: 'flex', flexDirection: 'column',
        padding: isMobileLogin ? '40px 24px 8px' : '60px 48px 8px',
        position: 'relative'
      }}>
        <div style={{ position: 'absolute', top: 24, right: 24, zIndex: 10 }}>
           <LanguageSwitcher />
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ width: '100%', maxWidth: 400 }}>
            {/* Mascot 图片 (与白色背景底衬融合) */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
               <img
                 src={mascotImage}
                 alt="Mascot"
                 style={{ width: '100%', maxWidth: 280, height: 'auto', display: 'block' }}
               />
            </div>

            <div style={{ marginBottom: 40, textAlign: 'center' }}>
              <h2 style={{ fontSize: 32, fontWeight: 800, color: '#1e293b', margin: '0 0 10px', letterSpacing: '-0.02em' }}>{t('login.welcomeBack')}</h2>
              <p style={{ fontSize: 15, color: '#64748b', margin: 0 }}>{t('login.credentialsTip')}</p>
            </div>

            <Form layout="vertical" onFinish={onFinish} size="large">
              <Form.Item
                name="token"
                label={<span style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t('login.accessToken')}</span>}
                rules={[{ required: true, message: t('login.tokenRequired') }]}
              >
                <Input.Password
                  placeholder={t('login.tokenPlaceholder')}
                  prefix={<KeyRound size={18} color="#94a3b8" style={{ marginRight: 8 }} />}
                  style={{ borderRadius: 12, padding: '12px 16px', background: '#f8fafc', border: '1px solid #e2e8f0' }}
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
                  marginTop: 16, background: '#2563eb', border: 'none',
                  boxShadow: '0 10px 15px -3px rgba(37,99,235,0.3)'
                }}
              >
                {t('login.button')}
              </Button>
            </Form>
          </div>
        </div>

        {/* 版权信息贴近底部 */}
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
