import { useState, useEffect, useRef } from 'react';
import {
  Layout, Card, Button, Input, Form,
  Tooltip, Badge, Tag,
  Row, Col, List, message,
  ConfigProvider, Menu, Drawer, Spin, Modal, Progress,
  QRCode,
} from 'antd';
import {
  Activity, Boxes, Cloud, Cpu, KeyRound,
  LayoutDashboard, LogOut, Menu as MenuIcon,
  Play, RefreshCw, Server, Smartphone, Square,
  Terminal, Zap, 
} from 'lucide-react';
import axios from 'axios';
import {
  XAxis, YAxis, CartesianGrid,
  Tooltip as ChartTooltip, ResponsiveContainer, AreaChart, Area,
} from 'recharts';
import dayjs from 'dayjs';

const { Header, Content, Sider } = Layout;

// ─── Styles & Animations ───────────────────────────────────────────────────────
const globalStyles = `
@keyframes crayfish-bounce {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-10px) rotate(3deg); }
}
@keyframes crayfish-claws {
  0%, 100% { transform: rotate(-5deg); }
  50% { transform: rotate(5deg); }
}
@keyframes text-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
`;

// ─── Loading Component ─────────────────────────────────────────────────────────
const CrayfishLoading = () => (
  <div style={{
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', height: 400, gap: 24,
  }}>
    <style>{globalStyles}</style>
    <div style={{
      fontSize: 14, fontFamily: 'monospace', color: '#2563eb',
      lineHeight: 1.2, whiteSpace: 'pre', textAlign: 'center',
      animation: 'crayfish-bounce 2s ease-in-out infinite',
    }}>
{`      _   _
     / \\_/ \\
    (  o o  )
     \\  ^  /
      \\___/
      /   \\
     /     \\
    (       )
     \\_____/
      | | |`}
    </div>
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8
    }}>
      <div style={{
        fontSize: 14, fontWeight: 700, color: '#1e293b',
        animation: 'text-pulse 2s infinite'
      }}>
        OpenClaw 状态监测中
      </div>
      <div style={{ fontSize: 12, color: '#94a3b8' }}>
        正在同步网关核心数据，请稍后...
      </div>
    </div>
  </div>
);

// ─── API ───────────────────────────────────────────────────────────────────────
const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '' });
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('guardian_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// ─── Login ─────────────────────────────────────────────────────────────────────
const LoginPage = ({ onLoginSuccess }: { onLoginSuccess: (token: string) => void }) => {
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

// ─── Dashboard ─────────────────────────────────────────────────────────────────
const Dashboard = () => {
  const [status, setStatus] = useState<any>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [wsLogs, setWsLogs] = useState<string[]>([]);
  const [activeTab, setActiveKey] = useState('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [fetching, setFetching] = useState(true);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [transitionSeconds, setTransitionSeconds] = useState(0);
  const [targetStatus, setTargetStatus] = useState<string | null>(null);
  const [refreshCountdown, setRefreshCountdown] = useState(10);
  const lastStatusRef = useRef<string | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ open: boolean, action: string, title: string, color: string }>({
    open: false,
    action: '',
    title: '',
    color: '#2563eb'
  });
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [qrData, setQrData] = useState<{ qrcode_url: string, expires_at: string } | null>(null);
  const [weixinStatus, setWeixinStatus] = useState<any>(null);
  const [loadingWeixin, setLoadingWeixin] = useState(false);
  const [checkWeixinSeconds, setCheckWeixinSeconds] = useState(0);
  const [isGettingQR, setIsGettingQR] = useState(false);
  const [qrSeconds, setQrSeconds] = useState(0);
  const logsEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  useEffect(() => {
    let interval: any;
    if (isTransitioning) {
      setTransitionSeconds(0);
      interval = setInterval(() => {
        setTransitionSeconds(s => s + 1);
      }, 1000);
    } else {
      setTransitionSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isTransitioning]);

  useEffect(() => {
    let interval: any;
    if (weixinStatus === null) {
      interval = setInterval(() => {
        setCheckWeixinSeconds(s => s + 1);
      }, 1000);
    } else {
      setCheckWeixinSeconds(0);
    }
    return () => clearInterval(interval);
  }, [weixinStatus]);

  const fetchData = async () => {
    try {
      const [statusRes, historyRes] = await Promise.all([
        api.get('/v1/openclaw/status'),
        api.get('/v1/stats/health'),
      ]);
      const newStatus = statusRes.data;
      const currentGatewayStatus = newStatus?.gateway?.status;

      // 检测目标状态以解除遮罩
      if (isTransitioning && targetStatus && currentGatewayStatus === targetStatus) {
        setIsTransitioning(false);
        setTargetStatus(null);
        message.success(`网关已成功切换至 ${targetStatus === 'Running' ? '运行' : '停止'} 状态`);
      }
      lastStatusRef.current = currentGatewayStatus;

      setStatus(newStatus);
      setHistory(historyRes.data);
    } catch (err) {
      console.error('Fetch error', err);
    } finally {
      setFetching(false);
    }
  };

  const fetchWeixinStatus = async () => {
    try {
      const res = await api.get('/v1/wechat/plugin/status');
      setWeixinStatus(res.data);
    } catch (err) {
      console.error('Fetch weixin status error', err);
    }
  };

  const handleInstallWeixin = async () => {
    try {
      setLoadingWeixin(true);
      await api.post('/v1/wechat/install');
      message.loading('微信插件安装指令已发出，请稍候约 30-60s...', 5);
      // 延时刷新状态
      setTimeout(fetchWeixinStatus, 30000);
    } catch (err) {
      message.error('安装指令发送失败');
    } finally {
      setLoadingWeixin(false);
    }
  };

  useEffect(() => {
    let timer: any;
    if (isTransitioning) {
      // 转换期间：2秒快速轮询，不显示倒计时
      timer = setInterval(fetchData, 2000);
      setRefreshCountdown(0);
    } else {
      // 正常期间：10秒倒计时
      setRefreshCountdown(10);
      timer = setInterval(() => {
        setRefreshCountdown(prev => {
          if (prev <= 1) {
            fetchData();
            fetchWeixinStatus();
            return 10;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [isTransitioning]);

  useEffect(() => {
    fetchData(); // 初始加载
  }, []);

  useEffect(() => {
    const tokenStr = localStorage.getItem('guardian_token');
    if (!tokenStr) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = import.meta.env.DEV
      ? `ws://localhost:3000/v1/ws/logs?token=${tokenStr}`
      : `${protocol}//${host}/v1/ws/logs?token=${tokenStr}`;
    const socket = new WebSocket(wsUrl);
    socket.onmessage = (event) => setWsLogs((prev) => [...prev.slice(-200), event.data]);
    return () => socket.close();
  }, []);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [wsLogs]);

  const handleControl = (action: string) => {
    if (action === 'wechat') {
      fetchWeChatQRCode();
      return;
    }
    const config: Record<string, { title: string, color: string }> = {
      'start': { title: '启动 OpenClaw 网关', color: '#2563eb' },
      'stop': { title: '停止 OpenClaw 网关', color: '#ef4444' },
      'restart': { title: '重启 OpenClaw 网关', color: '#6366f1' },
    };
    setConfirmModal({
      open: true,
      action,
      title: config[action].title,
      color: config[action].color
    });
  };

  const [selfHealingEnabled, setSelfHealingEnabled] = useState(false);
  const [healEvents, setHealEvents] = useState<any[]>([]);
  const [loadingSets, setLoadingSets] = useState(false);

  const fetchSelfHealingStatus = async () => {
    try {
      const res = await api.get('/v1/settings/self-healing');
      setSelfHealingEnabled(res.data.enabled);
    } catch (err) {
      console.error('Failed to fetch self-healing status', err);
    }
  };

  const fetchHealEvents = async () => {
    try {
      const res = await api.get('/v1/heal/events');
      setHealEvents(res.data);
    } catch (err) {
      console.error('Failed to fetch heal events', err);
    }
  };

  const toggleSelfHealing = async (checked: boolean) => {
    setLoadingSets(true);
    try {
      await api.post('/v1/settings/self-healing', { enabled: checked });
      setSelfHealingEnabled(checked);
      message.success(`自愈服务已${checked ? '开启' : '禁用'}`);
    } catch (err) {
      message.error('操作失败，请重试');
    } finally {
      setLoadingSets(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'tools') {
      fetchSelfHealingStatus();
      fetchHealEvents();
    }
  }, [activeTab]);

  const fetchWeChatQRCode = async () => {
    if (isGettingQR) return;
    
    setIsGettingQR(true);
    setQrSeconds(0);
    const interval = setInterval(() => {
      setQrSeconds(s => s + 1);
    }, 1000);

    try {
      const res = await api.get('/v1/wechat/qrcode?force=true');
      if (res.data && res.data.qrcode_url) {
        setQrData(res.data);
        setQrModalVisible(true);
      } else {
        message.warning('无法解析到二维码，请检查后端日志或确保微信插件已正确配置');
      }
    } catch (err: any) {
      message.error('获取微信授权码失败: ' + (err.response?.data?.error || '网络连接超时'));
    } finally {
      clearInterval(interval);
      setIsGettingQR(false);
    }
  };

  const executeControl = async () => {
    const { action } = confirmModal;
    setConfirmModal(prev => ({ ...prev, open: false }));
    
    // 根据动作预设目标状态
    if (action === 'start' || action === 'restart') {
      setTargetStatus('Running');
    } else if (action === 'stop') {
      setTargetStatus('Stopped');
    }
    
    setIsTransitioning(true); // 开启遮罩
    try {
      await api.post(`/v1/gateway/${action}`);
      message.loading(`正在执行 ${action} 指令...`, 2);
    } catch (err: any) {
      setIsTransitioning(false);
      message.error(`执行失败: ${err.response?.data?.error || '未知网络错误'}`);
    }
  };

  const navItems = [
    { key: 'dashboard', icon: <LayoutDashboard size={16} />, label: '系统概览' },
    { key: 'components', icon: <Boxes size={16} />, label: '渠道绑定' },
    { key: 'logs', icon: <Terminal size={16} />, label: '实时日志' },
    { key: 'tools', icon: <Zap size={16} />, label: '自愈管理' },
  ];

  const isRunning = status?.gateway?.status === 'Running';

  const sidebarContent = (onSelect?: () => void) => (
    <>
      {/* Logo */}
      <div style={{
        height: 56, display: 'flex', alignItems: 'center',
        borderBottom: '1px solid rgba(51,65,85,0.6)',
        padding: collapsed && !onSelect ? '0 18px' : '0 20px', gap: 10,
        overflow: 'hidden', whiteSpace: 'nowrap',
      }}>
        <div style={{ fontSize: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          🦞
        </div>
        {(!collapsed || onSelect) && (
          <span style={{ color: '#fff', fontWeight: 700, fontSize: 14, letterSpacing: '-0.01em' }}>
            Lobster Guardian
          </span>
        )}
      </div>

      {/* Nav */}
      <div style={{ padding: '12px 0', flex: 1, overflowY: 'auto' }}>
        {(!collapsed || onSelect) && (
          <div style={{ padding: '4px 20px 8px', fontSize: 10, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
            Monitor
          </div>
        )}
        <Menu
          mode="inline"
          selectedKeys={[activeTab]}
          onClick={({ key }) => { setActiveKey(key); onSelect?.(); }}
          items={navItems}
          theme="dark"
          className="border-none"
          style={{ background: 'transparent', padding: '0 8px' }}
        />
      </div>

      {/* Logout */}
      <div style={{ padding: '0 8px 16px' }}>
        <Tooltip title={collapsed && !onSelect ? '退出登录' : ''} placement="right">
          <Button
            block
            icon={<LogOut size={14} />}
            onClick={() => { localStorage.removeItem('guardian_token'); window.location.reload(); }}
            style={{
              background: 'transparent', border: '1px solid #334155',
              color: '#64748b', height: 38, borderRadius: 8,
              display: 'flex', alignItems: 'center',
              justifyContent: collapsed && !onSelect ? 'center' : 'flex-start',
              paddingLeft: collapsed && !onSelect ? 0 : 12, gap: 8,
            }}
          >
            {(!collapsed || onSelect) && <span style={{ fontSize: 12 }}>退出登录</span>}
          </Button>
        </Tooltip>
      </div>
    </>
  );

  const renderContent = () => {
    if (fetching && !status) return <CrayfishLoading />;

    switch (activeTab) {
      case 'dashboard':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Row gutter={[20, 20]}>
              <Col xs={24} lg={12}>
                <Card styles={{ body: { padding: 24 } }} style={{ height: '100%', borderRadius: 12, border: '1px solid #e2e8f0' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#64748b', fontSize: 13, fontWeight: 500 }}>
                      <Server size={15} color={isRunning ? '#22c55e' : '#ef4444'} />
                      网关核心状态
                    </div>
                    <Tag color={isRunning ? 'success' : 'error'} style={{ borderRadius: 20, border: 'none', margin: 0, fontWeight: 600, padding: '0 10px' }}>
                      {isRunning ? '运行中' : '已停止'}
                    </Tag>
                  </div>
                  <div style={{ marginBottom: 20 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 4 }}>
                      <div style={{ fontSize: 11, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>运行时长</div>
                      <div style={{ fontSize: 10, color: '#10b981', fontWeight: 600, fontFamily: 'monospace' }}>{status?.version}</div>
                    </div>
                    <div style={{ fontSize: 20, fontWeight: 700, color: '#1e293b', fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.3 }}>
                      {status?.gateway?.runtime || '—'}
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>PID</div>
                      <div style={{ fontFamily: 'monospace', color: '#334155', fontWeight: 600, fontSize: 13 }}>{status?.gateway?.pid || '—'}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 10, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>最近更新</div>
                      <div style={{ fontFamily: 'monospace', color: '#64748b', fontSize: 13 }}>{dayjs().format('HH:mm:ss')}</div>
                    </div>
                  </div>
                </Card>
              </Col>
              <Col xs={24} lg={12}>
                <Card
                  title={<span style={{ fontSize: 13, fontWeight: 500, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}><Activity size={15} color="#3b82f6" />响应延迟统计（近 24 小时）</span>}
                  styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 52 }, body: { padding: '12px 20px 16px' } }}
                  style={{ height: '100%', borderRadius: 12, border: '1px solid #e2e8f0' }}
                >
                  <div style={{ height: 160 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={history}>
                        <defs>
                          <linearGradient id="colorL" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="timestamp" hide />
                        <YAxis hide />
                        <ChartTooltip
                          contentStyle={{ borderRadius: 8, border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', fontSize: 12 }}
                          labelFormatter={(v) => dayjs(v).format('HH:mm:ss')}
                          formatter={(v: any) => [v + ' ms', '响应时间']}
                        />
                        <Area type="monotone" dataKey="response_time_ms" stroke="#3b82f6" strokeWidth={2} fill="url(#colorL)" dot={false} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </Col>
            </Row>
            
            <Row style={{ marginTop: 20 }}>
              <Col span={24}>
                <Card
                  title={<span style={{ fontSize: 13, fontWeight: 500, color: '#475569', display: 'flex', alignItems: 'center', gap: 6 }}><Cpu size={15} color="#8b5cf6" /> 服务器负载监控</span>}
                  styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 48 }, body: { padding: '24px 20px' } }}
                  style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
                >
                  <Row gutter={24} justify="space-around">
                    <Col span={8} style={{ textAlign: 'center' }}>
                      <Progress type="dashboard" percent={Math.round(status?.metrics?.cpu_usage || 0)} size={window.innerWidth < 768 ? 60 : 80} strokeColor="#ef4444" />
                      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500, marginTop: 8 }}>CPU 使用率</div>
                    </Col>
                    <Col span={8} style={{ textAlign: 'center' }}>
                      <Progress type="dashboard" percent={Math.round(status?.metrics?.memory_usage || 0)} size={window.innerWidth < 768 ? 60 : 80} strokeColor="#3b82f6" />
                      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500, marginTop: 8 }}>内存占用率</div>
                    </Col>
                    <Col span={8} style={{ textAlign: 'center' }}>
                      <Progress type="dashboard" percent={Math.round(status?.metrics?.disk_usage || 0)} size={window.innerWidth < 768 ? 60 : 80} strokeColor="#d946ef" />
                      <div style={{ fontSize: 12, color: '#64748b', fontWeight: 500, marginTop: 8 }}>磁盘利用率</div>
                    </Col>
                  </Row>
                </Card>
              </Col>
            </Row>

            <Card
              style={{ marginTop: 20, borderRadius: 12, border: '1px solid #e2e8f0' }}
              title={<span style={{ fontSize: 13, fontWeight: 500, color: '#475569' }}>快捷操作</span>}
              styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 52 }, body: { padding: '16px 24px' } }}
            >
              <div style={{ 
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: 12,
                width: '100%'
              }}>
                <Button
                  type="primary"
                  size="large"
                  icon={<Play size={14} />}
                  onClick={() => handleControl('start')}
                  disabled={isRunning}
                  style={{ 
                    fontWeight: 500, 
                    flex: window.innerWidth < 768 ? '1 1 calc(50% - 6px)' : 'none',
                    minWidth: window.innerWidth < 768 ? 0 : 120
                  }}
                >
                  启动网关
                </Button>
                <Button
                  danger
                  size="large"
                  icon={<Square size={14} />}
                  onClick={() => handleControl('stop')}
                  disabled={!isRunning}
                  style={{ 
                    fontWeight: 500, 
                    flex: window.innerWidth < 768 ? '1 1 calc(50% - 6px)' : 'none',
                    minWidth: window.innerWidth < 768 ? 0 : 120
                  }}
                >
                  停止网关
                </Button>
                <Button
                  size="large"
                  icon={<RefreshCw size={14} />}
                  onClick={() => handleControl('restart')}
                  style={{ 
                    fontWeight: 500, 
                    flex: window.innerWidth < 768 ? '1 1 100%' : 'none',
                    minWidth: window.innerWidth < 768 ? 0 : 120
                  }}
                >
                  重启网关
                </Button>
              </div>
            </Card>
            {/* 自定义确认弹窗已迁移至全局，此处移除 */}
          </div>
        );

      case 'components':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* 微信插件状态卡片 */}
            <Card
              styles={{ body: { padding: 20 } }}
              style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ padding: 12, background: '#eef2ff', borderRadius: 12, flexShrink: 0 }}><Cloud size={24} color="#4f46e5" /></div>
                  <div>
                    <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 15, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                      微信官方插件 (openclaw-weixin)
                      {weixinStatus === null ? (
                        <Tag color="processing" icon={<RefreshCw size={10} style={{ animation: 'spin 2s linear infinite' }} />} style={{ borderRadius: 4, fontSize: 11 }}>监测中 ({checkWeixinSeconds}s)</Tag>
                      ) : weixinStatus.installed ? (
                        <Tag color="success" style={{ borderRadius: 4, fontSize: 11 }}>已安装 v{weixinStatus.version}</Tag>
                      ) : (
                        <Tag color="error" style={{ borderRadius: 4, fontSize: 11 }}>未安装</Tag>
                      )}
                    </div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>
                      {weixinStatus === null 
                        ? '正在连接插件系统并检索状态...'
                        : weixinStatus.installed 
                          ? (
                            <span>
                              运行状态: {weixinStatus.status} (已托管至配置中心)
                              {weixinStatus.last_check && (
                                <span style={{ marginLeft: 8, opacity: 0.6 }}>
                                  [上次检测: {dayjs(weixinStatus.last_check).format('HH:mm:ss')}]
                                </span>
                              )}
                            </span>
                          )
                          : '核心组件缺失，需完成安装后方可获取登录码'}
                    </div>
                  </div>
                </div>
                {weixinStatus !== null && !weixinStatus.installed && (
                  <Button 
                    type="primary" 
                    icon={<Zap size={14} />} 
                    loading={loadingWeixin}
                    onClick={handleInstallWeixin}
                    style={{ borderRadius: 8, height: 36 }}
                  >
                    一键安装插件
                  </Button>
                )}
              </div>
            </Card>

            {/* 微信登录卡片优化 */}
            <Card
              onClick={() => {
                if (isGettingQR) return;
                if (!weixinStatus?.installed) {
                  message.warning('请先完成微信插件安装');
                  return;
                }
                handleControl('wechat');
              }}
              styles={{ body: { padding: 20 } }}
              style={{ 
                borderRadius: 12, border: '1px solid #e2e8f0', 
                cursor: (weixinStatus?.installed && !isGettingQR) ? 'pointer' : 'not-allowed', 
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                background: weixinStatus?.installed ? 'white' : '#f8fafc',
                opacity: (weixinStatus?.installed && !isGettingQR) ? 1 : 0.6,
                transform: (weixinStatus?.installed && !isGettingQR) ? 'none' : 'scale(0.995)',
                boxShadow: (weixinStatus?.installed && !isGettingQR) ? '0 1px 2px rgba(0,0,0,0.03)' : 'none'
              }}
              hoverable={weixinStatus?.installed && !isGettingQR}
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
                      获取微信登录码
                    </div>
                    <div style={{ color: '#64748b', fontSize: 12 }}>生成用于身份授权的微信二维码，用于绑定个人微信，有效期 5 分钟</div>
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
                    立即获取 <RefreshCw size={12} />
                  </div>
                )}
              </div>
            </Card>

          </div>
        );

      case 'logs':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', background: '#0d1117', borderRadius: 12, overflow: 'hidden', border: '1px solid #21262d', height: 'calc(100vh - 160px)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', background: '#161b22', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'rgba(255,95,86,0.7)' }} />
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'rgba(255,189,46,0.7)' }} />
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: 'rgba(39,201,63,0.7)' }} />
                </div>
                <span style={{ color: '#8b949e', fontSize: 12, fontFamily: 'monospace' }}>guardian.log</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', animation: 'pulse 2s infinite' }} />
                <span style={{ color: '#22c55e', fontSize: 10, fontFamily: 'monospace', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Live</span>
              </div>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16, fontFamily: 'monospace', fontSize: 12, color: '#c9d1d9', lineHeight: 1.6 }}>
              {wsLogs.length === 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#484f58', height: '100%', justifyContent: 'center' }}>
                  <Spin size="small" />正在连接日志流...
                </div>
              ) : wsLogs.map((log, i) => (
                <div key={i} style={{ display: 'flex', gap: 12 }}>
                  <span style={{ color: '#30363d', width: 28, textAlign: 'right', flexShrink: 0, userSelect: 'none' }}>
                    {(i + 1).toString().padStart(3, '0')}
                  </span>
                  <span style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{log}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        );

      case 'tools':
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* 软开关卡片 */}
            <Card
              styles={{ body: { padding: '24px 28px' } }}
              style={{ borderRadius: 16, border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.02)' }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
                  <div style={{ 
                    width: 52, height: 52, borderRadius: 14, 
                    background: selfHealingEnabled ? '#f0f9ff' : '#f8fafc',
                    display: 'flex', alignItems: 'center', justifyContent: 'center'
                  }}>
                    <Zap size={26} color={selfHealingEnabled ? '#3b82f6' : '#94a3b8'} fill={selfHealingEnabled ? '#3b82f6' : 'none'} style={{ opacity: selfHealingEnabled ? 1 : 0.5 }} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 800, color: '#1e293b', fontSize: 17, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                      自动自愈服务
                      <Badge status={selfHealingEnabled ? 'processing' : 'default'} />
                    </div>
                    <div style={{ color: '#64748b', fontSize: 13, maxWidth: 500, lineHeight: 1.5 }}>
                      开启后，当巡检发现网关宕机或响应超时，系统将自动尝试执行 `Doctor Fix`、配置回滚并重启服务。
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, fontWeight: 600 }}>
                    当前状态: <span style={{ color: selfHealingEnabled ? '#16a34a' : '#ef4444' }}>{selfHealingEnabled ? '运行中' : '已禁用'}</span>
                  </div>
                  <Button 
                    type={selfHealingEnabled ? "default" : "primary"}
                    size="large"
                    loading={loadingSets}
                    onClick={() => toggleSelfHealing(!selfHealingEnabled)}
                    style={{ 
                      borderRadius: 10, minWidth: 100, fontWeight: 700,
                      background: selfHealingEnabled ? 'transparent' : '#2563eb',
                      borderColor: selfHealingEnabled ? '#e2e8f0' : '#2563eb',
                      color: selfHealingEnabled ? '#475569' : '#fff'
                    }}
                  >
                    {selfHealingEnabled ? '禁用服务' : '立即开启'}
                  </Button>
                </div>
              </div>
            </Card>


            {/* 自愈日志列表 */}
            <Card
              title={<span style={{ fontSize: 14, fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: 8 }}><Terminal size={16} /> 历史自愈事件</span>}
              styles={{ header: { borderBottom: '1px solid #f1f5f9', minHeight: 48 }, body: { padding: '0 24px' } }}
              style={{ borderRadius: 12, border: '1px solid #e2e8f0' }}
            >
              {healEvents.length === 0 ? (
                <div style={{ padding: '60px 0', textAlign: 'center', color: '#94a3b8' }}>
                  <div style={{ fontSize: 40, marginBottom: 16 }}>☕</div>
                  <div style={{ fontSize: 13 }}>暂无自愈事件记录，系统运行平稳</div>
                </div>
              ) : (
                <List
                  dataSource={healEvents}
                  renderItem={(item: any) => (
                    <List.Item style={{ padding: '20px 0', borderBottom: '1px solid #f8fafc' }}>
                      <div style={{ width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                          <Tag color="warning" style={{ borderRadius: 4, fontWeight: 600 }}>{item.reason}</Tag>
                          <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>{dayjs(item.timestamp).format('YYYY-MM-DD HH:mm:ss')}</span>
                        </div>
                        <div style={{ background: '#f8fafc', padding: '12px 16px', borderRadius: 8, border: '1px solid #f1f5f9' }}>
                          <div style={{ display: 'flex', gap: 12, fontSize: 13 }}>
                            <span style={{ color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>恢复方法:</span>
                            <span style={{ color: '#1e293b' }}>{item.method}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 12, fontSize: 13, marginTop: 4 }}>
                            <span style={{ color: '#64748b', fontWeight: 500, whiteSpace: 'nowrap' }}>处置结果:</span>
                            <span style={{ color: item.result === 'Success' ? '#16a34a' : '#ef4444', fontWeight: 600 }}>{item.result === 'Success' ? '✅ 已恢复' : '❌ 失败'}</span>
                          </div>
                        </div>
                      </div>
                    </List.Item>
                  )}
                />
              )}
            </Card>
          </div>
        );

      default:
        return null;
    }
  };

  const headerEl = (onMenuClick?: () => void) => (
    <Header style={{
      background: '#fff', height: 56, padding: '0 24px',
      borderBottom: '1px solid #e2e8f0',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 20, flexShrink: 0,
      lineHeight: 'normal',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {onMenuClick && <Button type="text" icon={<MenuIcon size={20} />} onClick={onMenuClick} style={{ marginLeft: -8 }} />}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#64748b' }}>
          <span style={{ fontWeight: 600, color: '#1e293b' }}>控制台</span>
          <span>/</span>
          <span style={{ color: '#2563eb', fontWeight: 500 }}>
            {navItems.find(i => i.key === activeTab)?.label}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Badge
          status={isRunning ? 'success' : 'error'}
          text={
            <span style={{ color: '#64748b', fontSize: 12, fontWeight: 500 }}>
              Gateway {isRunning ? '在线' : '离线'}
              {isRunning && <span style={{ color: '#3b82f6', marginLeft: 4 }}>({refreshCountdown}s)</span>}
            </span>
          }
        />
      </div>
    </Header>
  );

  const transitionMask = isTransitioning && (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(8px)',
      zIndex: 9999, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div style={{
        padding: isMobile ? '24px 20px' : '32px 40px', 
        background: '#fff', 
        borderRadius: 24,
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
        width: isMobile ? '100%' : 'auto',
        maxWidth: 340,
        minWidth: isMobile ? 0 : 320
      }}>
        <div style={{ position: 'relative' }}>
          <Spin size="large" />
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 16 }}>正在同步网关状态</div>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 6, padding: '0 10px' }}>
            指令已确认，正在等待网关反馈状态...
          </div>
          <div style={{
            marginTop: 16, padding: '6px 16px', background: '#eff6ff',
            borderRadius: 20, fontSize: 13, color: '#2563eb',
            fontWeight: 700, display: 'inline-block', border: '1px solid #dbeafe',
            boxShadow: '0 2px 4px rgba(37,99,235,0.1)'
          }}>
            已等待 {transitionSeconds}s
          </div>
        </div>

        {transitionSeconds > 60 && (
          <div style={{ 
            marginTop: 8, display: 'flex', gap: 12, width: '100%',
            paddingTop: 20, borderTop: '1px solid #f1f5f9'
          }}>
            <Button 
              block 
              onClick={() => setIsTransitioning(false)}
              style={{ borderRadius: 8 }}
            >
              关闭遮罩
            </Button>
            <Button 
              block 
              type="primary" 
              icon={<RefreshCw size={14} />}
              onClick={() => window.location.reload()}
              style={{ borderRadius: 8, background: '#2563eb' }}
            >
              强制刷新
            </Button>
          </div>
        )}
      </div>
    </div>
  );

  // 渲染逻辑整合
  return (
    <>
      {transitionMask}
      
      {isMobile ? (
        <Layout style={{ minHeight: '100vh', background: '#f8fafc' }}>
          {headerEl(() => setMobileMenuOpen(true))}
          <Content style={{ padding: 16, background: '#f8fafc' }}>
            {renderContent()}
          </Content>
          <Drawer
            placement="left"
            closable={false}
            onClose={() => setMobileMenuOpen(false)}
            open={mobileMenuOpen}
            styles={{ body: { padding: 0, background: '#0f172a', display: 'flex', flexDirection: 'column', height: '100%' } }}
            width={240}
          >
            {sidebarContent(() => setMobileMenuOpen(false))}
          </Drawer>
        </Layout>
      ) : (
        <Layout style={{ minHeight: '100vh', background: '#f8fafc' }}>
          <Sider
            width={220}
            collapsedWidth={64}
            collapsed={collapsed}
            onCollapse={setCollapsed}
            style={{ background: '#0f172a', position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 30, display: 'flex', flexDirection: 'column' }}
          >
            {sidebarContent()}
          </Sider>
          <Layout style={{ marginLeft: collapsed ? 64 : 220, transition: 'margin-left 0.2s', display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            {headerEl()}
            <Content style={{ padding: 24, background: '#f8fafc', flex: 1 }}>
              <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                {renderContent()}
              </div>
            </Content>
          </Layout>
        </Layout>
      )}

      {/* 全局业务模态框 */}
      
      {/* 指令确认 */}
      <Modal
        title={null}
        open={confirmModal.open}
        footer={null}
        onCancel={() => setConfirmModal(prev => ({ ...prev, open: false }))}
        centered
        width={isMobile ? '92%' : 400}
        styles={{ body: { padding: 0, overflow: 'hidden', borderRadius: 16 } }}
      >        <div style={{ background: '#fff', padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ 
            width: 56, height: 56, borderRadius: '50%',
            background: `${confirmModal.color}15`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            marginBottom: 16, margin: '0 auto 16px'
          }}>
            {confirmModal.action === 'start' && <Play size={24} color={confirmModal.color} />}
            {confirmModal.action === 'stop' && <Square size={24} color={confirmModal.color} />}
            {confirmModal.action === 'restart' && <RefreshCw size={24} color={confirmModal.color} />}
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>{confirmModal.title}</h3>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 24, lineHeight: 1.6 }}>
            {confirmModal.action === 'stop'
              ? '确定要停止 OpenClaw 网关吗？这将导致所有渠道通信中断。'
              : `您正在请求 ${confirmModal.title} 指令，系统将异步处理。`}
          </p>
          <div style={{ display: 'flex', gap: 12, width: '100%' }}>
            <Button block size="large" onClick={() => setConfirmModal(prev => ({ ...prev, open: false }))} style={{ borderRadius: 8 }}>取消</Button>
            <Button block type="primary" size="large" onClick={executeControl} style={{ borderRadius: 8, background: confirmModal.color, borderColor: confirmModal.color, fontWeight: 600 }}>确认指令</Button>
          </div>
        </div>
      </Modal>

      {/* 微信二维码获取遮罩 */}
      <Modal
        open={isGettingQR}
        footer={null}
        closable={false}
        centered
        styles={{ body: { padding: '40px 24px', textAlign: 'center' } }}
        width={isMobile ? '80%' : 320}
      >
        <Spin size="large" />
        <div style={{ marginTop: 24, fontWeight: 600, color: '#1e293b' }}>正在请求微信登录指令...</div>
        <div style={{ marginTop: 8, color: '#64748b', fontSize: 13 }}>后端处理中 ({qrSeconds}s)</div>
        <div style={{ marginTop: 16, fontSize: 12, color: '#94a3b8' }}>初始化微信连接可能需要 10-20 秒</div>
      </Modal>

      {/* 微信二维码弹窗 (移动至顶层以保证稳定性) */}
      <Modal
        title={null}
        open={qrModalVisible}
        footer={null}
        onCancel={() => setQrModalVisible(false)}
        centered
        width={340}
        styles={{ body: { padding: 0, overflow: 'hidden', borderRadius: 16 } }}
      >
        <div style={{ background: '#fff', padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🦞</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>微信授权登录</h3>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 24, lineHeight: 1.6 }}>
            请使用需要绑定的微信扫码<br />授权后 OpenClaw 将自动完成同步
          </p>
          <div style={{ background: '#f8fafc', padding: 16, borderRadius: 12, border: '1px solid #f1f5f9', display: 'inline-block', marginBottom: 16 }}>
            {qrData && <QRCode value={qrData.qrcode_url} size={180} bordered={false} color="#1e293b" />}
          </div>
          <div style={{ padding: '0 24px', marginBottom: 24 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>备选链接 (可直接在浏览器打开)</div>
              <div style={{ fontSize: 12, background: '#f1f5f9', padding: '8px 12px', borderRadius: 8, wordBreak: 'break-all', color: '#475569', fontFamily: 'monospace', border: '1px solid #e2e8f0' }}>
                {qrData?.qrcode_url}
              </div>
              <Button type="link" size="small" onClick={() => window.open(qrData?.qrcode_url, '_blank')} style={{ marginTop: 8 }}>在浏览器中打开连接</Button>
          </div>
          <div style={{ fontSize: 11, color: '#94a3b8', padding: '12px 0', borderTop: '1px solid #f1f5f9', background: '#fafafa' }}>
            二维码有效期至: {qrData?.expires_at ? dayjs(qrData.expires_at).format('HH:mm:ss') : '--:--'}
          </div>
          <Button block type="primary" size="large" onClick={() => setQrModalVisible(false)} style={{ marginTop: 24, borderRadius: 10, fontWeight: 700 }}>已完成扫码</Button>
        </div>
      </Modal>
    </>
  );
};

// ─── App Root ──────────────────────────────────────────────────────────────────
export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('guardian_token'));

  return (
    <ConfigProvider theme={{
      token: {
        colorPrimary: '#2563eb',
        borderRadius: 8,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        colorBgContainer: '#ffffff',
        colorText: '#334155',
        fontSize: 14,
      },
      components: {
        Menu: {
          darkItemBg: 'transparent',
          darkItemSelectedBg: '#1d4ed8',
          darkItemHoverBg: '#1e293b',
          darkItemColor: '#94a3b8',
          darkItemSelectedColor: '#fff',
          itemHeight: 40,
        },
      },
    }}>
      {token ? <Dashboard /> : <LoginPage onLoginSuccess={setToken} />}
    </ConfigProvider>
  );
}
