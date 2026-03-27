import { useState, useEffect } from 'react';
import { Layout, ConfigProvider, message, Modal, Spin, QRCode, Button, Drawer, Badge } from 'antd';
import { 
  LayoutDashboard, Boxes, ToyBrick, Smartphone, Terminal, Zap, 
  Menu as MenuIcon, Play, Square, RefreshCw, ExternalLink
} from 'lucide-react';
import api from './api';

// Components
import LoginView from './views/LoginView';
import Sidebar from './components/layout/Sidebar';
import DashboardOverview from './views/DashboardOverview';
import BotsManager from './views/BotsManager';
import ChannelsManager from './views/ChannelsManager';
import DeviceManager from './views/DeviceManager';
import LogsViewer from './views/LogsViewer';
import SelfHealing from './views/SelfHealing';
import CrayfishLoading from './components/common/CrayfishLoading';

// Hooks
import { useStatusPolling } from './hooks/useStatusPolling';
import { useWebSocketLogs } from './hooks/useWebSocketLogs';

const { Content, Sider, Header } = Layout;

// --- Dashboard Component (Internal Layout) ---------------------------------------
const Dashboard = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [collapsed, setCollapsed] = useState(window.innerWidth < 1200);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const isMobile = window.innerWidth < 1024;

  // States
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [targetStatus, setTargetStatus] = useState<string | null>(null);
  const [transitionSeconds, setTransitionSeconds] = useState(0);
  const [qrModalVisible, setQrModalVisible] = useState(false);
  const [qrData, setQrData] = useState<any>(null);
  const [isGettingQR, setIsGettingQR] = useState(false);
  const [qrSeconds, setQrSeconds] = useState(0);
  const [confirmModal, setConfirmModal] = useState({ open: false, title: '', action: '', color: '#2563eb' });
  
  const [chatChannels, setChatChannels] = useState<any>(null);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [weixinStatus, setWeixinStatus] = useState<any>(null);
  const [loadingWeixin, setLoadingWeixin] = useState(false);
  const [checkWeixinSeconds, setCheckWeixinSeconds] = useState(0);
  const [botsModels, setBotsModels] = useState<any>(null);
  const [loadingBots, setLoadingBots] = useState(false);
  const [healEvents, setHealEvents] = useState<any[]>([]);
  const [devices, setDevices] = useState<any>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [selfHealingEnabled, setSelfHealingEnabled] = useState(false);
  const [loadingSets, setLoadingSets] = useState(false);

  // Hooks
  const { status, history, fetching, refreshCountdown } = useStatusPolling(
    isTransitioning, targetStatus, (status) => {
      setIsTransitioning(false);
      setTargetStatus(null);
      setTransitionSeconds(0);
      message.success(`网关指令已成功生效 (当前状态: ${status})`);
    }
  );

  const { wsLogs } = useWebSocketLogs(localStorage.getItem('guardian_token'));

  // Side Effects
  useEffect(() => {
    if (isTransitioning) {
      const timer = setInterval(() => setTransitionSeconds(s => s + 1), 1000);
      return () => clearInterval(timer);
    }
  }, [isTransitioning]);

  useEffect(() => {
    if (isGettingQR) {
      const timer = setInterval(() => setQrSeconds(s => s + 1), 1000);
      return () => clearInterval(timer);
    }
  }, [isGettingQR]);

  useEffect(() => {
    if (activeTab === 'bots-models') fetchBotsModels();
    if (activeTab === 'components') {
      fetchChatChannels();
      checkWeixinPlugin();
    }
    if (activeTab === 'devices') fetchDevices();
    if (activeTab === 'tools') fetchSelfHealing();
  }, [activeTab]);

  // Methods
  const fetchBotsModels = async (force = false) => {
    setLoadingBots(true);
    try {
      const res = await api.get(`/v1/openclaw/bots-models${force ? '?refresh=true' : ''}`);
      setBotsModels(res.data);
      if (force) message.success('资产清单已强制同步并更新');
    } catch (e) {
      message.error('同步 OpenClaw 资产失败');
    } finally {
      setLoadingBots(false);
    }
  };

  const fetchChatChannels = async (force = false) => {
    setLoadingChannels(true);
    try {
      const res = await api.get(`/v1/openclaw/chat-channels${force ? '?refresh=true' : ''}`);
      setChatChannels(res.data);
    } catch (e) {
      message.error('同步渠道信息失败');
    } finally {
      setLoadingChannels(false);
    }
  };

  const checkWeixinPlugin = async () => {
    setCheckWeixinSeconds(0);
    const check = async () => {
      try {
        const res = await api.get('/v1/openclaw/plugins/weixin/status');
        setWeixinStatus(res.data);
      } catch (e) {}
    };
    check();
    const timer = setInterval(() => {
      setCheckWeixinSeconds(s => s + 1);
      check();
    }, 5000);
    return () => clearInterval(timer);
  };

  const fetchDevices = async (force = false) => {
    setLoadingDevices(true);
    try {
      const res = await api.get(`/v1/openclaw/devices${force ? '?refresh=true' : ''}`);
      setDevices(res.data);
    } catch (err) {
      message.error('同步设备清单失败');
    } finally {
      setLoadingDevices(false);
    }
  };

  const fetchSelfHealing = async () => {
    try {
      const [historyRes, settingsRes] = await Promise.all([
        api.get('/v1/openclaw/self-healing/history'),
        api.get('/v1/openclaw/self-healing/settings')
      ]);
      setHealEvents(historyRes.data?.events || []);
      setSelfHealingEnabled(settingsRes.data?.enabled || false);
    } catch (err) {}
  };

  const handleControl = (action: string) => {
    const config: any = {
      start: { title: '启动网关核心', color: '#22c55e' },
      stop: { title: '停止运行网关', color: '#ef4444' },
      restart: { title: '重启网关核心', color: '#3b82f6' },
      wechat: { title: '请求微信登录码', color: '#16a34a' }
    };
    setConfirmModal({ open: true, action, ...config[action] });
  };

  const executeControl = async () => {
    const { action } = confirmModal;
    setConfirmModal(prev => ({ ...prev, open: false }));

    if (action === 'wechat') {
      setIsGettingQR(true);
      setQrSeconds(0);
      try {
        const res = await api.post('/v1/openclaw/plugins/weixin/login');
        setQrData(res.data);
        setQrModalVisible(true);
      } catch (err: any) {
        message.error(err.response?.data?.error || '获取二维码失败');
      } finally {
        setIsGettingQR(false);
      }
      return;
    }

    try {
      await api.post(`/v1/gateway/${action}`);
      setIsTransitioning(true);
      setTargetStatus(action === 'stop' ? 'stopped' : 'running');
      setTransitionSeconds(0);
    } catch (err: any) {
      message.error(err.response?.data?.error || '网关指令发送失败');
    }
  };

  const handleInstallWeixin = async () => {
    setLoadingWeixin(true);
    try {
      await api.post('/v1/openclaw/plugins/weixin/install');
      message.loading('正在安装微信插件，请勿刷新...', 0);
      setTimeout(() => {
        message.destroy();
        message.success('插件安装指令已发送');
        checkWeixinPlugin();
      }, 3000);
    } catch (err: any) {
      message.error(err.response?.data?.error || '安装失败');
    } finally {
      setLoadingWeixin(false);
    }
  };

  const handleApproveDevice = async (requestId: string) => {
    try {
      await api.post(`/v1/openclaw/devices/approve/${requestId}`);
      message.success('设备已批准接入');
      fetchDevices();
    } catch (err: any) {
      message.error(err.response?.data?.error || '操作失败');
    }
  };

  const toggleSelfHealing = async (enabled: boolean) => {
    setLoadingSets(true);
    try {
      await api.post('/v1/openclaw/self-healing/settings', { enabled });
      setSelfHealingEnabled(enabled);
      message.success(enabled ? '自动自愈已开启' : '自愈服务已禁用');
    } catch (err) {
      message.error('设置更新失败');
    } finally {
      setLoadingSets(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('guardian_token');
    window.location.reload();
  };
  
  const handleOpenDashboard = async () => {
    try {
      const res = await api.get('/v1/openclaw/dashboard-url');
      if (res.data.url) {
        window.open(res.data.url, '_blank');
      }
    } catch (e) {
      message.error('无法获取龙虾面板地址');
    }
  };

  const isRunning = status?.gateway?.status?.toLowerCase() === 'running';

  const navItems = [
    { key: 'dashboard', label: '运行状态', icon: <LayoutDashboard size={14} /> },
    { key: 'lobster-panel', label: '龙虾面板', icon: <ExternalLink size={14} /> },
    { key: 'bots-models', label: '虾兵蟹将', icon: <Boxes size={14} /> },
    { key: 'components', label: '渠道绑定', icon: <ToyBrick size={14} /> },
    { key: 'devices', label: '设备绑定', icon: <Smartphone size={14} /> },
    { key: 'logs', label: '实时日志', icon: <Terminal size={14} /> },
    { key: 'tools', label: '自愈管理', icon: <Zap size={14} /> },
  ];

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard': return <DashboardOverview status={status} history={history} isRunning={isRunning} onControl={handleControl} />;
      case 'bots-models': return <BotsManager botsModels={botsModels} loadingBots={loadingBots} isMobile={isMobile} onRefresh={() => fetchBotsModels(true)} />;
      case 'components': return (
        <ChannelsManager 
          chatChannels={chatChannels} weixinStatus={weixinStatus} loadingChannels={loadingChannels} 
          loadingWeixin={loadingWeixin} checkWeixinSeconds={checkWeixinSeconds}
          isGettingQR={isGettingQR} onInstallWeixin={handleInstallWeixin} onGetQRCode={() => handleControl('wechat')}
        />
      );
      case 'devices': return <DeviceManager devices={devices} loadingDevices={loadingDevices} onApproveDevice={handleApproveDevice} />;
      case 'logs': return <LogsViewer wsLogs={wsLogs} />;
      case 'tools': return <SelfHealing selfHealingEnabled={selfHealingEnabled} healEvents={healEvents} loadingSets={loadingSets} onToggle={toggleSelfHealing} />;
      default: return null;
    }
  };

  if (fetching && !status) return <CrayfishLoading />;

  const transitionMask = isTransitioning && (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(8px)',
      zIndex: 9999, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 20
    }}>
      <div style={{
        padding: isMobile ? '24px 20px' : '32px 40px', 
        background: '#fff', borderRadius: 24,
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
        width: isMobile ? '100%' : 'auto', maxWidth: 340, minWidth: isMobile ? 0 : 320
      }}>
        <Spin size="large" />
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 16 }}>正在同步网关状态</div>
          <div style={{ color: '#64748b', fontSize: 13, marginTop: 6 }}>指令已确认，正在等待网关反馈状态...</div>
          <div style={{
            marginTop: 16, padding: '6px 16px', background: '#eff6ff',
            borderRadius: 20, fontSize: 13, color: '#2563eb',
            fontWeight: 700, display: 'inline-block', border: '1px solid #dbeafe'
          }}>
            已等待 {transitionSeconds}s
          </div>
        </div>
        {transitionSeconds > 60 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 12, width: '100%', paddingTop: 20, borderTop: '1px solid #f1f5f9' }}>
            <Button block onClick={() => setIsTransitioning(false)}>关闭遮罩</Button>
            <Button block type="primary" icon={<RefreshCw size={14} />} onClick={() => window.location.reload()}>强制刷新</Button>
          </div>
        )}
      </div>
    </div>
  );

  const headerEl = (onMenuClick?: () => void) => (
    <Header style={{
      background: '#fff', height: 56, padding: '0 24px', borderBottom: '1px solid #e2e8f0',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 20, flexShrink: 0, lineHeight: 'normal',
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
            placement="left" closable={false} width={240}
            onClose={() => setMobileMenuOpen(false)} open={mobileMenuOpen}
            styles={{ body: { padding: 0, background: '#0f172a', display: 'flex', flexDirection: 'column', height: '100%' } }}
          >
            <Sidebar 
              activeTab={activeTab} collapsed={false} onSelect={(k) => { 
                if (k === 'lobster-panel') { handleOpenDashboard(); return; }
                setActiveTab(k); 
                setMobileMenuOpen(false); 
              }} 
              onLogout={handleLogout} navItems={navItems} 
            />
          </Drawer>
        </Layout>
      ) : (
        <Layout style={{ minHeight: '100vh', background: '#f8fafc' }}>
          <Sider
            width={220} collapsedWidth={64} collapsed={collapsed} onCollapse={setCollapsed}
            style={{ background: '#0f172a', position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 30 }}
          >
            <Sidebar 
              activeTab={activeTab} collapsed={collapsed} onSelect={(k) => {
                if (k === 'lobster-panel') { handleOpenDashboard(); return; }
                setActiveTab(k);
              }} 
              onLogout={handleLogout} navItems={navItems} 
            />
          </Sider>
          <Layout style={{ marginLeft: collapsed ? 64 : 220, transition: 'margin-left 0.2s', minHeight: '100vh' }}>
            {headerEl()}
            <Content style={{ padding: 24, background: '#f8fafc', flex: 1 }}>
              <div style={{ maxWidth: 1100, margin: '0 auto' }}>
                {renderContent()}
              </div>
            </Content>
          </Layout>
        </Layout>
      )}

      {/* Confirm Modal */}
      <Modal
        title={null} open={confirmModal.open} footer={null}
        onCancel={() => setConfirmModal(prev => ({ ...prev, open: false }))}
        centered width={isMobile ? '92%' : 400}
        styles={{ body: { padding: 0 } }}
        style={{ borderRadius: 16 }}
      >
        <div style={{ background: '#fff', padding: '32px 24px', textAlign: 'center', borderRadius: 16 }}>
          <div style={{ 
            width: 56, height: 56, borderRadius: '50%', background: `${confirmModal.color}15`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px'
          }}>
            {confirmModal.action === 'start' && <Play size={24} color={confirmModal.color} />}
            {confirmModal.action === 'stop' && <Square size={24} color={confirmModal.color} />}
            {confirmModal.action === 'restart' && <RefreshCw size={24} color={confirmModal.color} />}
            {confirmModal.action === 'wechat' && <Smartphone size={24} color={confirmModal.color} />}
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>{confirmModal.title}</h3>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 24, lineHeight: 1.6 }}>
            {confirmModal.action === 'stop' && '确定要停止 OpenClaw 网关吗？这将导致所有渠道通信中断。'}
            {confirmModal.action === 'wechat' && '请确认已安装并正确配置微信插件后继续。'}
            {['start', 'restart'].includes(confirmModal.action) && `您正在请求 ${confirmModal.title} 指令，系统将异步处理。`}
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button block onClick={() => setConfirmModal(prev => ({ ...prev, open: false }))}>取消</Button>
            <Button block type="primary" onClick={executeControl} style={{ background: confirmModal.color, borderColor: confirmModal.color }}>确认指令</Button>
          </div>
        </div>
      </Modal>

      {/* QR Code Modals */}
      <Modal open={isGettingQR} footer={null} closable={false} centered width={320}>
        <div style={{ textAlign: 'center', padding: 20 }}>
          <Spin size="large" />
          <div style={{ marginTop: 24, fontWeight: 600 }}>正在请求微信登录指令...</div>
          <div style={{ marginTop: 8, color: '#64748b' }}>后端处理中 ({qrSeconds}s)</div>
        </div>
      </Modal>

      <Modal
        title={null} open={qrModalVisible} footer={null}
        onCancel={() => setQrModalVisible(false)} centered width={340}
        styles={{ body: { padding: 0 } }}
      >
        <div style={{ background: '#fff', padding: '32px 24px', textAlign: 'center', borderRadius: 16 }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🦞</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b' }}>微信授权登录</h3>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>使用手机微信扫码授权</p>
          <div style={{ background: '#f8fafc', padding: 16, borderRadius: 12, border: '1px solid #f1f5f9', marginBottom: 16 }}>
            {qrData && <QRCode value={qrData.qrcode_url} size={180} />}
          </div>
          <Button block type="primary" size="large" onClick={() => setQrModalVisible(false)}>完成并同步状态</Button>
        </div>
      </Modal>
    </>
  );
};

// --- App Root ---------------------------------------------------------------------
export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('guardian_token'));

  useEffect(() => {
    const interceptor = api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('guardian_token');
          setToken(null);
          if (token) message.error('会话已过期，请重新登录');
        }
        return Promise.reject(error);
      }
    );
    return () => api.interceptors.response.eject(interceptor);
  }, [token]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token');
    if (urlToken) {
      localStorage.setItem('guardian_token', urlToken);
      setToken(urlToken);
      window.history.replaceState({}, '', window.location.pathname);
      message.success('已自动登录');
    }
  }, []);

  return (
    <ConfigProvider theme={{
      token: {
        colorPrimary: '#2563eb',
        borderRadius: 8,
        fontFamily: "'Inter', sans-serif",
        colorBgContainer: '#ffffff',
        colorText: '#334155',
      },
      components: {
        Menu: {
          darkItemBg: 'transparent',
          darkItemSelectedBg: '#1d4ed8',
          darkItemHoverBg: '#1e293b',
          darkItemColor: '#94a3b8',
          darkItemSelectedColor: '#fff',
        },
      },
    }}>
      {token ? <Dashboard /> : <LoginView onLoginSuccess={setToken} />}
    </ConfigProvider>
  );
}
