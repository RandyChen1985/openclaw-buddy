import { useState, useEffect, useRef } from 'react';
import { Layout, Button, message, Spin, Modal, ConfigProvider, Drawer, Badge, QRCode } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  Menu as MenuIcon, Play, Square, RefreshCw, ExternalLink, MessageSquare,
  Puzzle, LayoutDashboard, Terminal, Zap, Boxes, ToyBrick, Smartphone, Rocket
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
import OnlineChat from './views/OnlineChat';
import LanguageSwitcher from './components/LanguageSwitcher';
import TaskTray from './components/common/TaskTray';
import SkillManagement from './views/SkillManagement';
import ExpertMarket from './views/ExpertMarket';
import PluginManagement from './views/PluginManagement';
import TuiView from './views/TuiView';
import ShellView from './views/ShellView';
import CrayfishLoading from './components/common/CrayfishLoading';
import ErrorBoundary from './components/common/ErrorBoundary';
import CommandPalette from './components/common/CommandPalette';

// Hooks
import { useStatusPolling } from './hooks/useStatusPolling';
import { useWebSocketLogs } from './hooks/useWebSocketLogs';
import { useTaskCenter, type Task } from './hooks/useTaskCenter';

const { Content, Sider, Header } = Layout;

// --- Dashboard Component (Internal Layout) ---------------------------------------
const Dashboard = () => {
  const { t } = useTranslation();
  const queryParams = new URLSearchParams(window.location.search);
  const isEmbed = queryParams.get('embed') === 'true';
  const initialPage = queryParams.get('page');

  const [activeTab, setActiveTab] = useState(initialPage || 'dashboard');
  const [collapsed, setCollapsed] = useState(window.innerWidth < 1200 || isEmbed);
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
  const [modelsConfig, setModelsConfig] = useState<any>(null);
  const [loadingModelsConfig, setLoadingModelsConfig] = useState(false);
  const [healEvents, setHealEvents] = useState<any[]>([]);
  const [globalLoadingMessage, setGlobalLoadingMessage] = useState<string | null>(null);
  const [globalLoadingCountdown, setGlobalLoadingCountdown] = useState<number>(0);
  const [devices, setDevices] = useState<any>(null);
  const [loadingDevices, setLoadingDevices] = useState(false);
  const [selfHealingEnabled, setSelfHealingEnabled] = useState(false);
  const [loadingSets, setLoadingSets] = useState(false);
  const [commandPaletteVisible, setCommandPaletteVisible] = useState(false);
  const [versionUpdate, setVersionUpdate] = useState<{ latest: string, current: string, release_url: string } | null>(null);
  const [systemEvents, setSystemEvents] = useState<any[]>([]);
  const [topBots, setTopBots] = useState<any[]>([]);
  const [loadingTopBots, setLoadingTopBots] = useState(false);
  const [plugins, setPlugins] = useState<any[]>([]);
  const [loadingPlugins, setLoadingPlugins] = useState(false);
  const [pluginsUpdatedAt, setPluginsUpdatedAt] = useState('');
  const [ocInstalled, setOcInstalled] = useState<boolean | null>(null);
  const [dashboardProcessing, setDashboardProcessing] = useState(false);
  const [dashboardAbortCtrl, setDashboardAbortCtrl] = useState<AbortController | null>(null);

  // Hooks
  const { tasks: activeTasks, updateTask: baseUpdateTask, loading: tasksLoading, fetchActiveTasks } = useTaskCenter();
  const { status, history, fetching, refreshCountdown, fetchData } = useStatusPolling(
    isTransitioning, targetStatus, () => {
      setIsTransitioning(false);
      setTargetStatus(null);
      setTransitionSeconds(0);
    }
  );

  const processedTaskIds = useRef<Set<string>>(new Set());
  const isInitialProcessed = useRef(false);

  // --- 核心：任务副作用中控台 (Task Side Effect Orchestrator) ---
  // 无论任务是从 WS 还是 Polling 回来的，只要状态变为完成，就触发业务刷新
  useEffect(() => {
    if (activeTasks.length > 0 && !isInitialProcessed.current) {
      // 页面首次加载/同步时，将现有已完成的任务直接标记为处理过，避免旧任务触发业务刷新风暴
      activeTasks.forEach(task => {
        if (task.status === 'Completed' || task.status === 'Failed') {
          processedTaskIds.current.add(task.id);
        }
      });
      isInitialProcessed.current = true;
      return;
    }

    activeTasks.forEach(task => {
      if ((task.status === 'Completed' || task.status === 'Failed') && !processedTaskIds.current.has(task.id)) {
        processedTaskIds.current.add(task.id);
        
        console.log(`🎯 [Task Observer] 侦测到任务完成: ${task.id} (${task.module}/${task.action})`);

        if (task.module === 'gateway') {
          fetchData();
          fetchSystemEvents();
        } else if (task.module === 'plugins') {
          fetchPlugins();
        } else if (task.module === 'bots') {
          // 如果是模型相关变更（添加、删除、设置默认、新增渠道），触发物理对账
          const modelActions = ['delete-model', 'add-model', 'add-provider', 'set-default-model'];
          if (modelActions.includes(task.action || '')) {
            console.log('🔄 [Task Observer] 模型变更任务完成，正在物理刷新模型规格...');
            fetchModelsConfig(); // 按用户建议，物理刷新模型规格
            fetchBotsModels(true); // 同步刷新机器人资产
          }
          
          if (task.action === 'delete' && task.status === 'Completed' && task.target) {
            setBotsModels((prev: any) => {
              if (!prev?.data?.bots) return prev;
              return {
                ...prev,
                data: {
                  ...prev.data,
                  bots: prev.data.bots.filter((b: any) => b.id !== task.target)
                }
              };
            });
          }
        }
      }
    });
  }, [activeTasks]);

  const handleTaskUpdate = (task: Task) => {
    baseUpdateTask(task);
    // 业务刷新逻辑已移至全局 useEffect 监听，此处仅负责分发任务状态更新
  };

  const [logSource, setLogSource] = useState('buddy');
  const { wsLogs } = useWebSocketLogs(localStorage.getItem('guardian_token'), logSource, handleTaskUpdate);

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
    if (activeTab === 'dashboard') {
      fetchSystemEvents();
      fetchTopBots();
    }
    if (activeTab === 'bots' || activeTab === 'bots-models' || activeTab === 'chat') {
      fetchBotsModels();
      if (activeTab === 'bots' || activeTab === 'bots-models') fetchModelsConfig();
    }
    if (activeTab === 'components') {
      fetchChatChannels();
      // 仅在状态未知时重置并触发检测
      if (!weixinStatus) {
        setCheckWeixinSeconds(0);
        checkWeixinPlugin();
      }
    }
    if (activeTab === 'devices') fetchDevices();
    if (activeTab === 'skills' || activeTab === 'plugins') fetchPlugins();
    if (activeTab === 'tools') fetchSelfHealing();
  }, [activeTab]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteVisible(true);
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    
    // 首次加载检查版本更新
    checkVersionUpdate();
    checkOpenClawStatus();
    
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const checkOpenClawStatus = async () => {
    try {
      const res = await api.get('/v1/openclaw/version');
      // 增加 800ms 的感知延迟，确保环境监测动画能被肉眼看到，增加专业感
      setTimeout(() => {
        setOcInstalled(res.data.installed);
      }, 800);
    } catch (err) {
      setTimeout(() => {
        setOcInstalled(false);
      }, 800);
    }
  };

  const handleCommandAction = (action: string, params?: any) => {
    if (action === 'nav') {
      setActiveTab(params);
      if (isMobile) setMobileMenuOpen(false);
    } else if (action === 'select-bot') {
      setActiveTab('chat');
      // 延迟一点确保在线聊天页面已加载，由于 activeTab 切换后 OnlineChat 会渲染
      // 这里通过 URL 参数同步 bot 选定状态是一种解法
      const newUrl = new URL(window.location.href);
      newUrl.searchParams.set('bot', params);
      window.history.replaceState({}, '', newUrl.toString());
    }
  };

  // 微信插件检测定时器逻辑 (1s UI计数, 5s 接口轮询)
  useEffect(() => {
    let counter: any;
    let poller: any;
    
    if (activeTab === 'components' && weixinStatus === null) {
      counter = setInterval(() => setCheckWeixinSeconds(s => s + 1), 1000);
      poller = setInterval(() => checkWeixinPlugin(), 5000);
    }

    return () => {
      if (counter) clearInterval(counter);
      if (poller) clearInterval(poller);
    };
  }, [activeTab, weixinStatus]);

  // Methods
  const fetchBotsModels = async (force = false) => {
    setLoadingBots(true);
    try {
      const res = await api.get(`/v1/openclaw/bots-models${force ? '?refresh=true' : ''}`);
      setBotsModels(res.data);
    } catch (e) {
      message.error(t('chat.syncAssetsError'));
    } finally {
      setLoadingBots(false);
    }
  };

  const fetchModelsConfig = async () => {
    setLoadingModelsConfig(true);
    try {
      const res = await api.get('/v1/openclaw/models/config');
      setModelsConfig(res.data);
    } catch (err) {
      console.error('Failed to fetch models config:', err);
    } finally {
      setLoadingModelsConfig(false);
    }
  };

  const fetchChatChannels = async (force = false) => {
    setLoadingChannels(true);
    try {
      const res = await api.get(`/v1/wechat/config/status${force ? '?refresh=true' : ''}`);
      setChatChannels(res.data);
    } catch (e) {
      console.warn(t('chat.syncChannelsError'), e);
    } finally {
      setLoadingChannels(false);
    }
  };

  const checkWeixinPlugin = async () => {
    try {
      const res = await api.get('/v1/wechat/plugin/status');
      setWeixinStatus(res.data);
    } catch (err) {
      setWeixinStatus({ installed: false, status: 'Detection Failed', version: 'N/A' });
    }
  };

  const fetchDevices = async (force = false) => {
    setLoadingDevices(true);
    try {
      const res = await api.get(`/v1/openclaw/devices${force ? '?refresh=true' : ''}`);
      setDevices(res.data);
    } catch (err) {
      message.error(t('chat.syncDevicesError'));
    } finally {
      setLoadingDevices(false);
    }
  };

  const fetchSelfHealing = async () => {
    try {
      const [historyRes, settingsRes] = await Promise.all([
        api.get('/v1/heal/events'),
        api.get('/v1/settings/self-healing')
      ]);
      setHealEvents(Array.isArray(historyRes.data) ? historyRes.data : historyRes.data?.events || []);
      setSelfHealingEnabled(settingsRes.data?.enabled || false);
    } catch (err) {}
  };
  
  const fetchSystemEvents = async () => {
    try {
      const res = await api.get('/v1/system/events');
      setSystemEvents(res.data);
    } catch (err) {}
  };

  const fetchTopBots = async () => {
    setLoadingTopBots(true);
    try {
      const res = await api.get('/v1/openclaw/bots/top');
      setTopBots(res.data);
    } catch (err) {
    } finally {
      setLoadingTopBots(false);
    }
  };

  const fetchPlugins = async () => {
    setLoadingPlugins(true);
    try {
      const res = await api.get('/v1/openclaw/plugins');
      const data = res.data.data || res.data || [];
      setPlugins(data);
      // 记录同步时间
      setPluginsUpdatedAt(new Date().toLocaleString());
    } catch (err) {
    } finally {
      setLoadingPlugins(false);
    }
  };

  const onShowGlobalLoading = (message: string, duration: number = 3000) => {
    setGlobalLoadingMessage(message);
    setGlobalLoadingCountdown(Math.ceil(duration / 1000)); // 初始化倒计时秒数
  };

  const checkVersionUpdate = async () => {
    try {
      const res = await api.get('/v1/system/version');
      if (res.data) setVersionUpdate(res.data);
    } catch (e) {
      console.warn(t('common.versionCheckFailed'), e);
    }
  };

  // 管理全局加载倒计时
  useEffect(() => {
    if (globalLoadingMessage && globalLoadingCountdown > 0) {
      const timer = setInterval(() => {
        setGlobalLoadingCountdown(prev => {
          if (prev <= 1) { // 倒计时结束
            clearInterval(timer);
            setGlobalLoadingMessage(null);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [globalLoadingMessage, globalLoadingCountdown]);


  const handleControl = (action: string) => {
    const config: any = {
      start: { title: t('common.start'), color: '#22c55e' },
      stop: { title: t('common.stop'), color: '#ef4444' },
      restart: { title: t('common.restart'), color: '#3b82f6' },
      wechat: { title: t('chat.wechatAuth'), color: '#16a34a' }
    };
    setConfirmModal({ open: true, action, ...config[action] });
  };

  const executeControl = async () => {
    const { action, title } = confirmModal;
    setConfirmModal(prev => ({ ...prev, open: false }));

    if (action === 'wechat') {
      setIsGettingQR(true);
      setQrSeconds(0);
      try {
        const res = await api.get('/v1/wechat/qrcode?force=true');
        setQrData(res.data);
        setQrModalVisible(true);
      } catch (err: any) {
        message.error(err.response?.data?.error || t('chat.getQrFailed'));
      } finally {
        setIsGettingQR(false);
      }
      return;
    }

    try {
      const res = await api.post(`/v1/gateway/${action}`);
      const taskID = res.data?.taskID;
      
      // 设置过渡状态以确保 UI 立即响应
      if (action !== 'wechat') {
        setIsTransitioning(true);
        setTargetStatus(action === 'start' ? 'running' : 'stopped');
      }

      if (taskID) {
        baseUpdateTask({
          id: taskID,
          name: title,
          module: 'gateway',
          action: action,
          target: '',
          status: 'Running',
          progress: 0,
          startTime: new Date().toISOString()
        });
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      message.error(err.response?.data?.error || t('common.commandFailed'));
    }
  };

  const restartGateway = async () => {
    try {
      const res = await api.post('/v1/gateway/restart');
      const taskID = res.data?.taskID;
      
      setIsTransitioning(true);
      // 重启通常先变 stopped 再变 running，这里我们先设为过渡态，由 polling 最终恢复

      if (taskID) {
        baseUpdateTask({
          id: taskID,
          name: t('common.restart'),
          module: 'gateway',
          action: 'restart',
          target: '',
          status: 'Running',
          progress: 0,
          startTime: new Date().toISOString()
        });
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      message.error(err.response?.data?.error || t('common.restartFailed'));
      throw err;
    }
  };

  const handleInstallWeixin = async () => {
    setLoadingWeixin(true);
    try {
      const res = await api.post('/v1/wechat/install');
      const taskID = res.data?.taskID;
      if (taskID) {
        baseUpdateTask({
          id: taskID,
          name: t('channels.weixinPlugin'),
          module: 'wechat',
          action: 'install',
          target: '',
          status: 'Running',
          progress: 0,
          startTime: new Date().toISOString()
        });
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err: any) {
      message.error(err.response?.data?.error || t('common.error'));
    } finally {
      setLoadingWeixin(false);
    }
  };

  const handleApproveDevice = async (requestId: string) => {
    try {
      await api.post('/v1/openclaw/devices/approve', { requestId });
      // 不再设置全屏遮罩
    } catch (err: any) {
      message.error(err.response?.data?.error || t('common.error'));
    }
  };

  const toggleSelfHealing = async (enabled: boolean) => {
    setLoadingSets(true);
    try {
      await api.post('/v1/settings/self-healing', { enabled });
      setSelfHealingEnabled(enabled);
      message.success(t('heal.toggleSuccess', { status: enabled ? t('heal.recovered') : t('heal.disabled') }));
    } catch (err) {
      message.error(t('common.updateFailed'));
    } finally {
      setLoadingSets(false);
    }
  };

  const handleAddBot = async (id: string, model: string) => {
    const pendingId = `pending-add-${id}`;
    baseUpdateTask({
      id: pendingId,
      name: `${t('bots.addingBot')}: ${id} (${t('common.waiting')})`,
      module: 'bots',
      action: 'add',
      target: id,
      status: 'Running',
      progress: 0,
      startTime: new Date().toISOString()
    });

    try {
      const res = await api.post('/v1/openclaw/bots/add', { id, model });
      const taskID = res.data?.taskID;
      if (taskID) {
        baseUpdateTask({
          id: taskID,
          name: `${t('bots.addingBot')}: ${id}`,
          module: 'bots',
          action: 'add',
          target: id,
          status: 'Running',
          progress: 5,
          startTime: new Date().toISOString()
        });
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || t('bots.createFailed');
      baseUpdateTask({
        id: pendingId,
        name: `${t('bots.addBot')}: ${id}`,
        module: 'bots',
        action: 'add',
        target: id,
        status: 'Failed',
        error: msg,
        progress: 0,
        startTime: new Date().toISOString()
      });
      message.error(msg);
      throw err;
    }
  };

  const handleUpdateBot = async (id: string, name?: string, model?: string) => {
    const pendingId = `pending-update-${id}`;
    baseUpdateTask({
      id: pendingId,
      name: `${t('bots.updatingConfig')}: ${id} (${t('common.waiting')})`,
      module: 'bots',
      action: 'update',
      target: id,
      status: 'Running',
      progress: 0,
      startTime: new Date().toISOString()
    });

    try {
      const res = await api.post('/v1/openclaw/bots/update', { id, name, model });
      const taskID = res.data?.taskID;
      if (taskID) {
        baseUpdateTask({
          id: taskID,
          name: `${t('bots.updatingConfig')}: ${id}`,
          module: 'bots',
          action: 'update',
          target: id,
          status: 'Running',
          progress: 5,
          startTime: new Date().toISOString()
        });
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || t('bots.updateFailed');
      baseUpdateTask({
        id: pendingId,
        name: `${t('bots.updatingConfig')}: ${id}`,
        module: 'bots',
        action: 'update',
        target: id,
        status: 'Failed',
        error: msg,
        progress: 0,
        startTime: new Date().toISOString()
      });
      message.error(msg);
      throw err;
    }
  };

  const handleDeleteBot = async (id: string) => {
    // 1. 立即发起 Pending 任务提供视觉反馈 (0ms 延迟)
    const pendingId = `pending-delete-${id}`;
    baseUpdateTask({
      id: pendingId,
      name: `${t('bots.removingBot')}: ${id} (${t('common.waiting')})`,
      module: 'bots',
      action: 'delete',
      target: id,
      status: 'Running',
      progress: 0,
      startTime: new Date().toISOString()
    });

    try {
      const res = await api.post('/v1/openclaw/bots/delete', { id });
      const taskID = res.data?.taskID;
      if (taskID) {
        // 2. 拿到真实 ID 后更新，触发 useTaskCenter 的接力逻辑
        baseUpdateTask({
          id: taskID,
          name: `${t('bots.removingBot')}: ${id}`,
          module: 'bots',
          action: 'delete',
          target: id,
          status: 'Running',
          progress: 5,
          startTime: new Date().toISOString()
        });
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || t('bots.removeFailed');
      // 失败清理：将 Pending 任务转为失败状态，触发错误提示
      baseUpdateTask({
        id: pendingId,
        name: `${t('bots.removeBotTitle')}: ${id}`,
        module: 'bots',
        action: 'delete',
        target: id,
        status: 'Failed',
        error: msg,
        progress: 0,
        startTime: new Date().toISOString()
      });
      message.error(msg);
      throw err;
    }
  };

  const handleSetDefaultModel = async (modelId: string) => {
    const pendingId = `pending-default-model-${modelId}`;
    baseUpdateTask({
      id: pendingId,
      name: `${t('bots.settingDefaultModel')}: ${modelId} (${t('common.waiting')})`,
      module: 'bots',
      action: 'set-default-model',
      target: modelId,
      status: 'Running',
      progress: 0,
      startTime: new Date().toISOString()
    });

    try {
      const res = await api.post('/v1/openclaw/models/set-default', { modelId });
      const taskID = res.data?.taskID;
      if (taskID) {
        baseUpdateTask({
          id: taskID,
          name: `${t('bots.settingDefaultModel')}: ${modelId}`,
          module: 'bots',
          action: 'set-default-model',
          target: modelId,
          status: 'Running',
          progress: 5,
          startTime: new Date().toISOString()
        });
      }
    } catch (err: any) {
      const msg = err.response?.data?.error || t('bots.setDefaultFailed');
      baseUpdateTask({
        id: pendingId,
        name: `${t('bots.defaultModel')}: ${modelId}`,
        module: 'bots',
        action: 'set-default-model',
        target: modelId,
        status: 'Failed',
        error: msg,
        progress: 0,
        startTime: new Date().toISOString()
      });
      message.error(msg);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('guardian_token');
    window.location.reload();
  };
  
  const handleOpenDashboard = async () => {
    if (dashboardProcessing) return; // 防抖：如果已有任务在处理，则忽略新点击

    const ctrl = new AbortController();
    setDashboardAbortCtrl(ctrl);
    setDashboardProcessing(true);

    try {
      const res = await api.get('/v1/openclaw/dashboard-url', { signal: ctrl.signal });
      if (res.data.url) {
        window.open(res.data.url, '_blank');
      }
    } catch (e: any) {
      if (e.name === 'CanceledError' || e.name === 'AbortError') {
        console.log('Dashboard URL request cancelled by user');
        return;
      }
      message.error(t('chat.getDashboardUrlError'));
    } finally {
      setDashboardProcessing(false);
      setDashboardAbortCtrl(null);
    }
  };

  const isRunning = status?.gateway?.status?.toLowerCase() === 'running';

  // --- Menu Configuration ---
  const menuItems = [
    {
      key: 'grp-monitor',
      label: t('common.monitor_center'),
      type: 'group',
      children: [
        { key: 'dashboard', label: t('common.dashboard'), icon: <LayoutDashboard size={14} /> },
        { 
          key: 'logs', 
          label: (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
              <span>{t('common.logs')}</span>
              {wsLogs.length > 0 && <Badge status="processing" size="small" style={{ marginLeft: 8 }} />}
            </div>
          ), 
          icon: <Terminal size={14} /> 
        },
        { 
          key: 'tools', 
          label: (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 4 }}>
              <span>{t('common.tools')}</span>
              {healEvents.length > 0 && <Badge count={healEvents.length} size="small" styles={{ indicator: { backgroundColor: '#3b82f6' } }} />}
            </div>
          ), 
          icon: <Zap size={14} /> 
        },
        { key: 'shell', label: t('common.shell'), icon: <Terminal size={14} /> },
      ]
    },
    {
      key: 'grp-assets',
      label: t('common.assets'),
      type: 'group',
      children: [
        { key: 'chat', label: t('common.chat'), icon: <MessageSquare size={14} /> },
        { key: 'tui', label: t('common.tuiChat'), icon: <Terminal size={14} /> },
        { key: 'bots-models', label: t('common.bots'), icon: <Boxes size={14} /> },
        { key: 'skills', label: t('common.skills'), icon: <Puzzle size={14} /> },
        { key: 'plugins', label: t('plugins.title'), icon: <Zap size={14} /> },
        { key: 'experts', label: t('common.expertMarket'), icon: <Rocket size={14} /> },
      ]
    },
    {
      key: 'grp-binding',
      label: t('common.binding'),
      type: 'group',
      children: [
        { key: 'components', label: t('common.channels'), icon: <ToyBrick size={14} /> },
        { key: 'devices', label: t('common.devices'), icon: <Smartphone size={14} /> },
      ]
    },
    {
      key: 'grp-external',
      label: t('common.external'),
      type: 'group',
      children: [
        { key: 'lobster-panel', label: t('common.lobsterPanel'), icon: <ExternalLink size={14} /> },
      ]
    }
  ];

  // Helper to find label for breadcrumb
  const getActiveLabel = (key: string) => {
    for (const group of menuItems) {
      const item = group.children?.find(i => i.key === key);
      if (item) {
        if (typeof item.label === 'string') return item.label;
        // Handle complex labels like Logs with badges
        if (item.key === 'logs') return t('common.logs');
        if (item.key === 'tools') return t('common.tools');
        return key;
      }
    }
    return '';
  };

  const renderContent = () => {
    const viewMap: Record<string, React.ReactNode> = {
      'dashboard': (
        <DashboardOverview
          status={status}
          history={history}
 
          wsLogs={wsLogs} 
          isRunning={isRunning} 
          onControl={handleControl} 
          onNavigate={setActiveTab}
          systemEvents={systemEvents}
          topBots={topBots}
          loading={loadingTopBots}
          ocInstalled={ocInstalled}
          activeTasks={activeTasks}
          isTransitioning={isTransitioning}
        />
      ),
      'bots-models': (
        <BotsManager 
          modelsConfig={modelsConfig}
          loadingConfig={loadingModelsConfig}
          onRefresh={fetchModelsConfig}
          botsModels={botsModels} 
          loadingBots={loadingBots} 
          isMobile={isMobile} 
          onRefreshBots={() => fetchBotsModels(true)}
          onAddBot={handleAddBot}
          onUpdateBot={handleUpdateBot}
          onDeleteBot={handleDeleteBot}
          onSetDefaultModel={handleSetDefaultModel}
          activeTasks={activeTasks}
        />
      ),
      'components': (
        <ChannelsManager 
          chatChannels={chatChannels} weixinStatus={weixinStatus} loadingChannels={loadingChannels} 
          loadingWeixin={loadingWeixin} checkWeixinSeconds={checkWeixinSeconds}
          isGettingQR={isGettingQR} onInstallWeixin={handleInstallWeixin} onGetQRCode={() => handleControl('wechat')}
          onRefreshChannels={() => fetchChatChannels(true)}
          isMobile={isMobile}
        />
      ),
      'devices': (
        <DeviceManager 
          devices={devices} loadingDevices={loadingDevices} 
          onApproveDevice={handleApproveDevice} 
          onRefresh={() => fetchDevices(true)}
          isMobile={isMobile}
        />
      ),
      'logs': <LogsViewer wsLogs={wsLogs} activeSource={logSource} onSourceChange={setLogSource} />,
      'tools': <SelfHealing selfHealingEnabled={selfHealingEnabled} healEvents={healEvents} loadingSets={loadingSets} onToggle={toggleSelfHealing} ocInstalled={ocInstalled} />,
      'chat': <OnlineChat botsModels={botsModels} loadingBots={loadingBots} onRefreshBots={fetchBotsModels} isMobile={isMobile} onRestartGateway={restartGateway} />,
      'tui': <TuiView />,
      'shell': <ShellView />,
      'skills': <SkillManagement isMobile={isMobile} />,
      'plugins': <PluginManagement 
        isMobile={isMobile} 
        plugins={plugins} 
        loading={loadingPlugins} 
        onRefresh={fetchPlugins} 
        updatedAt={pluginsUpdatedAt} 
      />,
      'experts': <ExpertMarket isMobile={isMobile} onShowGlobalLoading={onShowGlobalLoading} onNavigate={setActiveTab} />
    };

    return (
      <ErrorBoundary key={activeTab}>
        {viewMap[activeTab] || <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" tip={t('common.loading')} /></div>}
      </ErrorBoundary>
    );
  };

  if (fetching && !status) return <CrayfishLoading />;

  const globalLoadingMask = (globalLoadingMessage || dashboardProcessing) && (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(2px)',
      zIndex: 9999, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 20,
      animation: 'fadeIn 0.3s ease-out'
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
          {isTransitioning ? (
            <>
              <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 16 }}>
                {targetStatus && t(`chat.status.${targetStatus}`)}
                {!targetStatus && t('chat.status.syncing')}
              </div>
              <div style={{ color: '#64748b', fontSize: 13, marginTop: 6 }}>
                {targetStatus && t(`chat.status.${targetStatus}_desc`)}
                {!targetStatus && t('common.waitingGateway')}
              </div>
              <div style={{
                marginTop: 16, padding: '6px 16px', background: '#eff6ff',
                borderRadius: 20, fontSize: 13, color: '#2563eb',
                fontWeight: 700, display: 'inline-block', border: '1px solid #dbeafe'
              }}>
                {t('common.secondsElapsed', { seconds: transitionSeconds })}
              </div>
            </>
          ) : globalLoadingMessage ? (
            <>
              <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 16 }}>{globalLoadingMessage}</div>
              <div style={{ color: '#64748b', fontSize: 13, marginTop: 6 }}>{t('common.waiting')}</div>
              <div style={{
                marginTop: 16, padding: '6px 16px', background: '#eff6ff',
                borderRadius: 20, fontSize: 13, color: '#2563eb',
                fontWeight: 700, display: 'inline-block', border: '1px solid #dbeafe'
              }}>
                {globalLoadingCountdown > 0 ? t('common.loadingCountdown', { seconds: globalLoadingCountdown }) : t('common.syncing')}
              </div>
            </>
          ) : dashboardProcessing ? (
            <>
              <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 18, marginBottom: 4 }}>
                {t('common.lobsterPanel')}
              </div>
              <div style={{ color: '#64748b', fontSize: 13, lineHeight: 1.6 }}>
                正在提取安全管理地址...<br />
                这可能需要几秒钟时间
              </div>
              <Button 
                danger 
                style={{ marginTop: 24, borderRadius: 12, height: 40 }}
                onClick={() => {
                  dashboardAbortCtrl?.abort();
                  setDashboardProcessing(false);
                }}
              >
                {t('common.cancel')}
              </Button>
            </>
          ) : null}
        </div>
        {/* 在 isTransitioning 超过 60 秒时才显示手动关闭/刷新的按钮 */}
        {isTransitioning && transitionSeconds > 60 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 12, width: '100%', paddingTop: 20, borderTop: '1px solid #f1f5f9' }}>
            <Button block onClick={() => setIsTransitioning(false)}>{t('common.close')}</Button>
            <Button block type="primary" icon={<RefreshCw size={14} />} onClick={() => window.location.reload()}>{t('common.refresh')}</Button>
          </div>
        )}
      </div>
    </div>
  );

  const headerEl = (onMenuClick?: () => void) => (
    <Header style={{
      background: '#fff', height: 56, padding: isMobile ? '0 12px' : '0 24px', borderBottom: '1px solid #e2e8f0',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      position: 'sticky', top: 0, zIndex: 20, flexShrink: 0, lineHeight: 'normal',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button 
          type="text" 
          icon={<MenuIcon size={20} />} 
          onClick={onMenuClick} 
          style={{ marginLeft: -8, color: '#64748b' }} 
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: '#64748b' }}>
          <span 
            style={{ fontWeight: 600, color: '#1e293b', cursor: 'pointer', transition: 'color 0.2s' }} 
            onClick={() => setActiveTab('dashboard')}
            onMouseEnter={(e) => (e.currentTarget.style.color = '#2563eb')}
            onMouseLeave={(e) => (e.currentTarget.style.color = '#1e293b')}
          >
            {t('common.console')}
          </span>
          <span>/</span>
          <span style={{ color: '#2563eb', fontWeight: 500 }}>
            {getActiveLabel(activeTab)}
          </span>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12, flexShrink: 0 }}>
        <TaskTray 
          tasks={activeTasks} 
          isMobile={isMobile} 
          loading={tasksLoading} 
          onRefresh={() => fetchActiveTasks(false, true)}
        />
        <LanguageSwitcher isMobile={isMobile} />
        <Badge
          status={isRunning ? 'success' : 'error'}
          text={
            <span style={{ color: '#64748b', fontSize: 12, fontWeight: 500, whiteSpace: 'nowrap' }}>
              {!isMobile && 'Gateway '}{isRunning ? t('dashboard.running') : t('dashboard.stopped')}
              {isRunning && <span style={{ color: '#3b82f6', marginLeft: 4 }}>({refreshCountdown}s)</span>}
            </span>
          }
        />
      </div>
    </Header>
  );

  return (
    <>
      {globalLoadingMask}
      
      {isEmbed ? (
        <div style={{ 
          height: '100vh', 
          background: '#f8fafc', 
          display: 'flex', 
          flexDirection: 'column',
          padding: activeTab === 'chat' || activeTab === 'logs' || activeTab === 'tui' || activeTab === 'shell' ? 0 : 24,
          overflow: activeTab === 'chat' || activeTab === 'logs' || activeTab === 'tui' || activeTab === 'shell' ? 'hidden' : 'auto'
        }}>
          {renderContent()}
        </div>
      ) : isMobile ? (
        <Layout style={{ 
          height: (activeTab === 'chat' || activeTab === 'logs' || activeTab === 'tui' || activeTab === 'shell') ? '100vh' : 'auto', 
          minHeight: '100vh',
          background: '#f8fafc', 
          overflow: (activeTab === 'chat' || activeTab === 'logs' || activeTab === 'tui' || activeTab === 'shell') ? 'hidden' : 'auto' 
        }}>
          {headerEl(() => setMobileMenuOpen(true))}
          <Content style={{ 
            padding: activeTab === 'tui' || activeTab === 'shell' || activeTab === 'chat' || activeTab === 'logs' ? 0 : 16, 
            background: (activeTab === 'tui' || activeTab === 'shell') ? '#0f172a' : '#f8fafc' 
          }}>
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
              onLogout={handleLogout} navItems={menuItems} 
              versionUpdate={versionUpdate}
            />
          </Drawer>
        </Layout>
      ) : (
        <Layout style={{ 
          height: (activeTab === 'chat' || activeTab === 'logs' || activeTab === 'tui' || activeTab === 'shell') ? '100vh' : 'auto', 
          minHeight: '100vh',
          background: '#f8fafc', 
          overflow: (activeTab === 'chat' || activeTab === 'logs' || activeTab === 'tui' || activeTab === 'shell') ? 'hidden' : 'auto' 
        }}>
          <Sider
            width={220} collapsedWidth={64} collapsed={collapsed} onCollapse={setCollapsed}
            style={{ background: '#0f172a', position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 30 }}
          >
            <Sidebar 
              activeTab={activeTab} collapsed={collapsed} onSelect={(k) => {
                if (k === 'lobster-panel') { handleOpenDashboard(); return; }
                setActiveTab(k);
              }} 
              onLogout={handleLogout} navItems={menuItems} 
              versionUpdate={versionUpdate}
            />
          </Sider>
          <Layout style={{ 
            marginLeft: collapsed ? 64 : 220, 
            transition: 'margin-left 0.2s', 
            height: (activeTab === 'chat' || activeTab === 'logs' || activeTab === 'tui' || activeTab === 'shell') ? '100vh' : 'auto', 
            minHeight: 0,
            display: 'flex', 
            flexDirection: 'column', 
            overflow: (activeTab === 'chat' || activeTab === 'logs' || activeTab === 'tui' || activeTab === 'shell') ? 'hidden' : 'auto' 
          }}>
            {headerEl(() => setCollapsed(!collapsed))}
            <Content style={{ 
              padding: activeTab === 'logs' || activeTab === 'chat' || activeTab === 'tui' || activeTab === 'shell' ? 0 : 24, 
              background: '#f8fafc', 
              flex: 1,
              display: 'flex', 
              flexDirection: 'column', 
              minHeight: 0
            }}>
              <div style={{ 
                maxWidth: 'none', 
                margin: '0 auto', 
                flex: 1,
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0
              }}>
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
            {confirmModal.action === 'stop' && t('chat.stopGatewayWarning')}
            {confirmModal.action === 'wechat' && (
              <span style={{ textAlign: 'left', display: 'inline-block', whiteSpace: 'pre-line' }}>
                {t('chat.wechatLoginConfirm')}
              </span>
            )}
            {['start', 'restart'].includes(confirmModal.action) && t('chat.asyncCommandTip', { title: confirmModal.title })}
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button block onClick={() => setConfirmModal(prev => ({ ...prev, open: false }))}>{t('common.cancel')}</Button>
            <Button block type="primary" onClick={executeControl} style={{ background: confirmModal.color, borderColor: confirmModal.color }}>{t('common.confirmAction')}</Button>
          </div>
        </div>
      </Modal>

      {/* QR Code Modals */}
      <Modal open={isGettingQR} footer={null} closable={false} centered width={320}>
        <div style={{ textAlign: 'center', padding: 20 }}>
          <Spin size="large" />
          <div style={{ marginTop: 24, fontWeight: 600 }}>{t('chat.requestingWechat')}</div>
          <div style={{ marginTop: 8, color: '#64748b' }}>{t('common.waiting')} ({qrSeconds}s)</div>
        </div>
      </Modal>

      <Modal
        title={null}
        open={qrModalVisible}
        footer={null}
        onCancel={() => setQrModalVisible(false)}
        centered
        width={isMobile ? '90%' : 340}
        styles={{ body: { padding: 0, overflow: 'hidden', borderRadius: 16 } }}
      >
        <div style={{ background: '#fff', padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🦞</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1e293b', marginBottom: 8 }}>{t('chat.wechatAuth')}</h3>
          <p style={{ fontSize: 13, color: '#64748b', marginBottom: 24, lineHeight: 1.6 }}>
            {t('chat.wechatAuthDesc')}
          </p>
          <div style={{ background: '#f8fafc', padding: 16, borderRadius: 12, border: '1px solid #f1f5f9', display: 'inline-block', marginBottom: 12 }}>
            {qrData && <QRCode value={qrData.qrcode_url} size={isMobile ? 160 : 180} bordered={false} color="#1e293b" />}
          </div>
          <div style={{ marginBottom: 20 }}>
              <Button type="link" size="small" onClick={() => window.open(qrData?.qrcode_url, '_blank')}>{t('chat.openInBrowser')}</Button>
          </div>
          <Button 
            block 
            type="primary" 
            size="large" 
            onClick={() => {
              setQrModalVisible(false);
              fetchChatChannels(true);
            }} 
            style={{ borderRadius: 10, fontWeight: 700 }}
          >
            {t('chat.scanCompleted')}
          </Button>
        </div>
      </Modal>

      <CommandPalette 
        visible={commandPaletteVisible} 
        onClose={() => setCommandPaletteVisible(false)} 
        onAction={handleCommandAction}
        bots={botsModels?.data?.bots || []}
      />
    </>
  );
};

// --- App Root ---------------------------------------------------------------------
export default function App() {
  const { t } = useTranslation();
  const [token, setToken] = useState<string | null>(localStorage.getItem('guardian_token'));

  useEffect(() => {
    const interceptor = api.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.response?.status === 401) {
          localStorage.removeItem('guardian_token');
          setToken(null);
          if (token) message.error(t('common.sessionExpired'));
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
      
      // 仅移除 token 参数，保留其他参数（如 embed, page 等）
      params.delete('token');
      const newSearch = params.toString();
      const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
      window.history.replaceState({}, '', newUrl);
      
      message.success(t('common.autoLogin'));
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
