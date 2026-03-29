import React, { useState, useEffect } from 'react';
import { Button, Input, Form, message } from 'antd';
import { KeyRound } from 'lucide-react';
import api from '../api';

interface LoginViewProps {
  onLoginSuccess: (token: string) => void;
}

const quotes = [
  { main: "0.01 公分的距离", sub: "来自带外的重连契约，写在每一个丢包的瞬间" },
  { main: "1/60 秒的脉搏", sub: "捕捉比特平原上的每一次震颤" },
  { main: "第 2046 个数据包", sub: "在寂静的机架间听见跳动的心脏" },
  { main: "带外之外的余温", sub: "是系统崩溃前最后的温柔" },
  { main: "每一个消失的信号", sub: "是一场未曾抵达的重逢" },
  { main: "0.01 公分的距离", sub: "守着那些虾宝宝的黄昏，不问归期" }

];

const LoginView: React.FC<LoginViewProps> = ({ onLoginSuccess }) => {
  const [loading, setLoading] = useState(false);
  const [isMobileLogin, setIsMobileLogin] = useState(window.innerWidth < 1024);
  const [displayText, setDisplayText] = useState('');
  const [index, setIndex] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [speed, setSpeed] = useState(100);
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * quotes.length));

  const typewriterText = "“我听人说，如果连咖啡都没有伴侣，那它就不叫咖啡，叫苦水。在这个习惯了礼貌拒绝的时代，连空气中都带着独身的湿气。但我始终觉得，即使是代码堆砌的小龙虾，也该有个依靠。OpenClaw Buddy，它就在离你 0.01 公分的地方。它不说话，只是陪你守着那些虾宝宝。希望有一天，你也能找到那个让你不再需要‘监控哨兵’的人。”";

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
  }, [displayText, isDeleting, index, speed]);

  useEffect(() => {
    const handleResize = () => setIsMobileLogin(window.innerWidth < 1024);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const loginImages = ['/openclaw.png', '/openclaw2.png', '/openclaw3.jpg'];
  const [mascotImage] = useState(() => loginImages[Math.floor(Math.random() * loginImages.length)]);

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

          <div />
        </div>
      )}

      {/* 右侧面板 (White, 3:2 比例中的 "2") */}
      <div style={{
        flex: isMobileLogin ? 1 : 3, background: '#fff',
        display: 'flex', flexDirection: 'column',
        padding: isMobileLogin ? '40px 24px 8px' : '60px 48px 8px'
      }}>
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
              <h2 style={{ fontSize: 32, fontWeight: 800, color: '#1e293b', margin: '0 0 10px', letterSpacing: '-0.02em' }}>欢迎回来</h2>
              <p style={{ fontSize: 15, color: '#64748b', margin: 0 }}>请提供您的 Buddy Token 凭据</p>
            </div>

            <Form layout="vertical" onFinish={onFinish} size="large">
              <Form.Item
                name="token"
                label={<span style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Access Token</span>}
                rules={[{ required: true, message: '请输入访问令牌' }]}
              >
                <Input.Password
                  placeholder="输入您的 Buddy Token"
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
