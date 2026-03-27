import React, { useState, useEffect } from 'react';
import { Button, Input, Form, message } from 'antd';
import { KeyRound } from 'lucide-react';
import api from '../api';

interface LoginViewProps {
  onLoginSuccess: (token: string) => void;
}

const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [isMobileLogin, setIsMobileLogin] = useState(window.innerWidth < 1024);

  useEffect(() => {
    const handleResize = () => setIsMobileLogin(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const onFinish = async (values: { token: string }) => {
    setLoading(true);
    try {
      const res = await api.post('/login', { token: values.token });
      if (res.data.status === 'success') {
        localStorage.setItem('guardian_token', values.token);
        onLoginSuccess(values.token);
        message.success('认证成功，欢迎回来');
      }
    } catch (err: any) {
      message.error(err.response?.data?.error || '无效的访问凭据');
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
          flex: 3, background: '#0f172a', padding: '80px 64px',
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
            <span style={{ color: '#fff', fontWeight: 800, fontSize: 22, letterSpacing: '-0.02em' }}>Lobster Guardian</span>
          </div>

          <div style={{ position: 'relative', zIndex: 1, maxWidth: 480 }}>
            <h1 style={{ color: '#fff', fontSize: 44, fontWeight: 900, lineHeight: 1.1, marginBottom: 28, letterSpacing: '-0.03em' }}>
              有孚网络<br />
              <span style={{ color: '#60a5fa' }}>监控枢纽中心</span>
            </h1>
            <p style={{ color: '#94a3b8', fontSize: 17, lineHeight: 1.6, marginBottom: 48 }}>
              为您提供 OpenClaw 集群的实时拓扑视角、多维状态监测与快速自愈入口，守护核心数字资产安全。
            </p>
            <div style={{ display: 'flex', gap: 16 }}>
              {['24/7 监测', '秒级告警', '一键闭环'].map(f => (
                <div key={f} style={{
                  background: 'rgba(255,255,255,0.05)', borderRadius: 20,
                  padding: '8px 20px', color: '#cbd5e1', fontSize: 14,
                  border: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: 8
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3b82f6' }} />
                  {f}
                </div>
              ))}
            </div>
          </div>

          <p style={{ position: 'relative', zIndex: 1, color: '#475569', fontSize: 13, margin: 0 }}>
            © {new Date().getFullYear()} Yovole Network · Infrastructure Reliability
          </p>
        </div>
      )}

      {/* 右侧面板 (White, 3:2 比例中的 "2") */}
      <div style={{
        flex: isMobileLogin ? 1 : 2, background: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: isMobileLogin ? '40px 24px' : '64px 48px'
      }}>
        <div style={{ width: '100%', maxWidth: 400 }}>
          {/* Mascot 图片 (与白色背景底衬融合) */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
             <img
               src="/openclaw.jpg"
               alt="Mascot"
               style={{ width: '100%', maxWidth: 280, height: 'auto', display: 'block' }}
             />
          </div>

          <div style={{ marginBottom: 40, textAlign: 'center' }}>
            <h2 style={{ fontSize: 32, fontWeight: 800, color: '#1e293b', margin: '0 0 10px', letterSpacing: '-0.02em' }}>欢迎回来</h2>
            <p style={{ fontSize: 15, color: '#64748b', margin: 0 }}>请提供您的 Guaridan Token 凭据</p>
          </div>

          <Form layout="vertical" onFinish={onFinish} size="large">
            <Form.Item
              name="token"
              label={<span style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Access Token</span>}
              rules={[{ required: true, message: '请输入访问令牌' }]}
            >
              <Input.Password
                placeholder="请输入凭据密钥"
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
              进入控制台
            </Button>
          </Form>

          {isMobileLogin && (
            <p style={{ color: '#94a3b8', fontSize: 12, textAlign: 'center', marginTop: 40 }}>
              © {new Date().getFullYear()} Yovole Network · Operation
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default LoginView;
