import { useState, useEffect, useRef, useMemo, lazy, Suspense } from 'react';
import { Layout, Button, message, Spin, Modal, ConfigProvider, Drawer, Badge, QRCode, theme } from 'antd';
import { useTranslation } from 'react-i18next';
import {
  Menu as MenuIcon, Play, Square, RefreshCw, ExternalLink, MessageSquare,
  Puzzle, LayoutDashboard, Terminal, Zap, Boxes, ToyBrick, Smartphone, Rocket,
  ShieldCheck, Clock, Activity, Sun, Moon, Users, Settings, Bot, AlertCircle
} from 'lucide-react';
import api from './api';
import axios from 'axios';
import storage from './utils/storage';

// Components（登录与壳层同步加载；业务 Tab 按需懒加载以降低首包）
import LoginView from './views/LoginView';
import Sidebar from './components/layout/Sidebar';
const DashboardOverview = lazy(() => import('./views/DashboardOverview'));
const AuditDashboard = lazy(() => import('./views/AuditDashboard'));
const BotsManager = lazy(() => import('./views/BotsManager'));
const ChannelsManager = lazy(() => import('./views/ChannelsManager'));
const DeviceManager = lazy(() => import('./views/DeviceManager'));
const LogsViewer = lazy(() => import('./views/LogsViewer'));
const SelfHealing = lazy(() => import('./views/SelfHealing'));
/** 同步加载：子路径部署时 lazy chunk 配套 CSS preload 易指向 `/assets/...` 导致聊天页崩溃 */
import OnlineChat from './views/OnlineChat';
import LanguageSwitcher from './components/LanguageSwitcher';
import TaskTray from './components/common/TaskTray';
const SkillManagement = lazy(() => import('./views/SkillManagement'));
const ExpertMarket = lazy(() => import('./views/ExpertMarket'));
const PluginManagement = lazy(() => import('./views/PluginManagement'));
const SecurityManager = lazy(() => import('./views/SecurityManager'));
const CronJobsView = lazy(() => import('./views/CronJobsView'));
const TuiView = lazy(() => import('./views/TuiView'));
const ShellView = lazy(() => import('./views/ShellView'));
const UserManagerView = lazy(() => import('./views/UserManagerView'));
import CrayfishLoading from './components/common/CrayfishLoading';
import ErrorBoundary from './components/common/ErrorBoundary';
import CommandPalette from './components/common/CommandPalette';
import { TooltipDisabledProvider } from './components/common/AppTooltip';
import Tooltip from './components/common/AppTooltip';

// Hooks
import { useStatusPolling } from './hooks/useStatusPolling';
import { useWebSocketLogs } from './hooks/useWebSocketLogs';
import { useTaskCenter, type Task } from './hooks/useTaskCenter';
import { V3GatewayProvider, useV3Gateway } from './context/V3GatewayContext';

const { Content, Sider, Header } = Layout;

// --- Dashboard Component (Internal Layout) ---------------------------------------
const Dashboard = ({ isDarkMode, toggleTheme }: { isDarkMode: boolean, toggleTheme: () => void }) => {
  const { t } = useTranslation();
  const queryParams = new URLSearchParams(window.location.search);
  const isEmbed = queryParams.get('embed') === 'true';
  const initialPage = queryParams.get('page');
  const tag = storage.getItem('guardian_tag') || undefined;

  const [activeTab, setActiveTab] = useState(initialPage || 'dashboard');
  const [authMe, setAuthMe] = useState<{
    is_superadmin: boolean;
    permissions: string[];
    username?: string;
    real_name?: string;
    role_keys?: string[];
    login_type?: string;
    /** 普通用户：允许访问的 bot id 列表；为空表示无权限；未返回则表示不限制（admin/superadmin） */
    bot_ids?: string[] | null;
  }>({ is_superadmin: false, permissions: [] });
  const [collapsed, setCollapsed] = useState(window.innerWidth < 1200 || isEmbed);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

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
  const [refreshingWeixin, setRefreshingWeixin] = useState(false);
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
  const [versionUpdate, setVersionUpdate] = useState<{ latest: string, current: string, release_url: string, gui_disable_features?: string, show_external_tools?: boolean } | null>(null);
  const [systemEvents, setSystemEvents] = useState<any[]>([]);
  const [topBots, setTopBots] = useState<any[]>([]);
  const [loadingTopBots, setLoadingTopBots] = useState(false);
  const [plugins, setPlugins] = useState<any[]>([]);
  const [loadingPlugins, setLoadingPlugins] = useState(false);
  const [pluginsUpdatedAt, setPluginsUpdatedAt] = useState('');
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [skills, setSkills] = useState<any[]>([]);

  /** 短缓存 + 请求互斥，减轻 Tab 切换与轮询叠加时的请求风暴 */
  const RESOURCE_TTL_MS = 25_000;
  const botsCacheRef = useRef<{ data: any; at: number } | null>(null);
  const botsAbortRef = useRef<AbortController | null>(null);
  const devicesCacheRef = useRef<{ data: any; at: number } | null>(null);
  const devicesAbortRef = useRef<AbortController | null>(null);
  const skillsListCacheRef = useRef<{ list: any[]; at: number } | null>(null);
  const skillsAbortRef = useRef<AbortController | null>(null);
  const pluginsCacheRef = useRef<{ list: any[]; at: number } | null>(null);
  const pluginsAbortRef = useRef<AbortController | null>(null);

  const fetchSkills = async (force = false, isSilent = false) => {
    const now = Date.now();
    if (!force && skillsListCacheRef.current && now - skillsListCacheRef.current.at < RESOURCE_TTL_MS) {
      setSkills(skillsListCacheRef.current.list);
      if (!isSilent) setLoadingSkills(false);
      return;
    }
    if (!force && skillsListCacheRef.current) {
      setSkills(skillsListCacheRef.current.list);
    }
    skillsAbortRef.current?.abort();
    const ctrl = new AbortController();
    skillsAbortRef.current = ctrl;
    if (!isSilent) setLoadingSkills(true);
    try {
      if (force) {
        await api.post('/v1/openclaw/skills/reload', undefined, { signal: ctrl.signal });
      }
      const res = await api.get(`/v1/openclaw/skills${force ? '?refresh=true' : ''}`, { signal: ctrl.signal });
      const rawData = res.data;
      let skillsList: any[] = [];
      if (rawData.data) {
        skillsList = Array.isArray(rawData.data.skills) ? rawData.data.skills : [];
      } else {
        skillsList = Array.isArray(rawData.skills) ? rawData.skills : [];
      }
      skillsListCacheRef.current = { list: skillsList, at: Date.now() };
      setSkills(skillsList);
      if (force && !isSilent) message.success(t('skills.syncSuccess'));
    } catch (err) {
      if (axios.isCancel(err)) return;
      if (!isSilent) message.error(t('skills.fetchFailed'));
    } finally {
      if (!isSilent) setLoadingSkills(false);
    }
  };
  const [ocInstalled, setOcInstalled] = useState<boolean | null>(null);
  const [dashboardProcessing, setDashboardProcessing] = useState(false);
  const [dashboardAbortCtrl, setDashboardAbortCtrl] = useState<AbortController | null>(null);

  // Hooks
  const { tasks: activeTasks, updateTask: baseUpdateTask, loading: tasksLoading, fetchActiveTasks } = useTaskCenter();
  const { status, history, fetching, fetchData } = useStatusPolling(
    isTransitioning, targetStatus, activeTab, () => {
      setIsTransitioning(false);
      setTargetStatus(null);
      setTransitionSeconds(0);
    }
  );

  const { status: v3Status, lastHealth, connect: v3Connect, setConnectionPaused } = useV3Gateway();

  const gatewayWsDesired = useMemo(
    () => activeTab === 'chat' || activeTab === 'dashboard',
    [activeTab]
  );

  useEffect(() => {
    setConnectionPaused(!gatewayWsDesired);
  }, [gatewayWsDesired, setConnectionPaused]);

  // 核心：合并状态机。
  // WS health payload 不含 cpu/memory（验证过），所以 metrics 仍由 HTTP 提供。
  // gateway.status 不再使用（isRunning 基于 v3Status），此处仅保留结构完整性。
  const mergedStatus = useMemo(() => {
    if (!status) return null;
    return status;
  }, [status]);


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
          fetchPlugins(true);
        } else if (task.module === 'bots') {
          // 如果是模型相关变更（添加、删除、设置默认、新增渠道），触发物理对账
          const modelActions = ['delete-model', 'add-model', 'add-provider', 'delete-provider', 'update-provider', 'set-default-model', 'clone-expert', 'add', 'update'];
          if (modelActions.includes(task.action || '')) {
            console.log(`🔄 [Task Observer] 机器人/模型变更任务 (${task.action}) 完成，将在延迟后物理刷新...`);
            
            // 针对克隆这类包含重启网关的操作，增加延迟刷新，确保网关端口已完全就绪
            const delay = task.action === 'clone-expert' ? 1500 : 500;
            
            setTimeout(() => {
              fetchModelsConfig(); 
              fetchBotsModels(true); 
              // 如果存在全局遮罩，则物理重置
              onShowGlobalLoading && onShowGlobalLoading('', 1);
            }, delay);
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
        } else if (task.module === 'skills' || task.module === 'plugins') {
          // 4. 技能或插件任务落地后，触发全系统对账
          const syncActions = ['delete-skill', 'sync-skills', 'install-plugin', 'uninstall-plugin', 'delete-plugin'];
          if (syncActions.includes(task.action || '')) {
            console.log('🔄 [Task Observer] 监测到技能/插件任务完成，执行物理对账...');
            fetchSkills(true, true); // 强制获取最新数据，并静默执行
            fetchPlugins(true); // 同步刷新插件状态
          }
        } else if (task.module === 'wechat') {
          if (task.action === 'unbind' && task.status === 'Completed') {
            console.log('🔄 [Task Observer] 微信解绑任务完成，强制刷新渠道内容...');
            fetchChatChannels(true);
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
  const { wsLogs, wsConnectionState } = useWebSocketLogs(
    storage.getItem('guardian_token'),
    logSource,
    handleTaskUpdate,
    activeTab === 'logs'
  );

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
    if (activeTab === 'skills') fetchSkills();
    if (activeTab === 'plugins') fetchPlugins();
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
    fetchAuthMe();
    
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  const fetchAuthMe = async () => {
    try {
      const res = await api.get('/v1/auth/me');
      const d: any = res.data || {};
      setAuthMe({
        is_superadmin: !!d.is_superadmin,
        permissions: Array.isArray(d.permissions) ? d.permissions : [],
        username: d.username,
        real_name: d.real_name,
        role_keys: Array.isArray(d.role_keys) ? d.role_keys : [],
        login_type: d.login_type,
        bot_ids: Array.isArray(d.bot_ids) ? d.bot_ids : undefined,
      });
    } catch {
      setAuthMe({ is_superadmin: false, permissions: [] });
    }
  };

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

  useEffect(() => {
    let counter: any;
    let poller: any;
    
    if (activeTab === 'components' && (weixinStatus === null || refreshingWeixin)) {
      counter = setInterval(() => setCheckWeixinSeconds(s => s + 1), 1000);
      // 仅在初始加载（status 为 null）且未手动刷新时开启轮询
      if (weixinStatus === null && !refreshingWeixin) {
        poller = setInterval(() => checkWeixinPlugin(), 5000);
      }
    }

    return () => {
      if (counter) clearInterval(counter);
      if (poller) clearInterval(poller);
    };
  }, [activeTab, weixinStatus, refreshingWeixin]);

  // Methods
  const fetchBotsModels = async (force = false) => {
    const now = Date.now();
    if (!force && botsCacheRef.current && now - botsCacheRef.current.at < RESOURCE_TTL_MS) {
      setBotsModels(botsCacheRef.current.data);
      setLoadingBots(false);
      return;
    }
    if (!force && botsCacheRef.current) {
      setBotsModels(botsCacheRef.current.data);
    }
    botsAbortRef.current?.abort();
    const ctrl = new AbortController();
    botsAbortRef.current = ctrl;
    setLoadingBots(true);
    try {
      const res = await api.get(`/v1/openclaw/bots-models${force ? '?refresh=true' : ''}`, { signal: ctrl.signal });
      botsCacheRef.current = { data: res.data, at: Date.now() };
      setBotsModels(res.data);
      if (force) message.success(t('chat.syncAssetsSuccess'));
    } catch (e) {
      if (axios.isCancel(e)) return;
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
      if (force) message.success(t('channels.syncSuccess', { defaultValue: '渠道列表已同步并更新' }));
    } catch (e) {
      console.warn(t('chat.syncChannelsError'), e);
    } finally {
      setLoadingChannels(false);
    }
  };

  const checkWeixinPlugin = async (force = false) => {
    if (force) {
      setRefreshingWeixin(true);
      setCheckWeixinSeconds(0);
    }
    try {
      const res = await api.get(`/v1/wechat/plugin/status${force ? '?refresh=true' : ''}`);
      setWeixinStatus(res.data);
      if (force) message.success(t('channels.weixinRefreshed'));
    } catch (err) {
      setWeixinStatus({ installed: false, status: 'Detection Failed', version: 'N/A' });
    } finally {
      if (force) setRefreshingWeixin(false);
    }
  };

  const fetchDevices = async (force = false) => {
    const now = Date.now();
    if (!force && devicesCacheRef.current && now - devicesCacheRef.current.at < RESOURCE_TTL_MS) {
      setDevices(devicesCacheRef.current.data);
      setLoadingDevices(false);
      return;
    }
    if (!force && devicesCacheRef.current) {
      setDevices(devicesCacheRef.current.data);
    }
    devicesAbortRef.current?.abort();
    const ctrl = new AbortController();
    devicesAbortRef.current = ctrl;
    setLoadingDevices(true);
    try {
      const res = await api.get(`/v1/openclaw/devices${force ? '?refresh=true' : ''}`, { signal: ctrl.signal });
      devicesCacheRef.current = { data: res.data, at: Date.now() };
      setDevices(res.data);
      if (force) message.success(t('common.refreshSuccess', { defaultValue: '列表已同步并刷新' }));
    } catch (err) {
      if (axios.isCancel(err)) return;
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

  const fetchPlugins = async (force = false) => {
    const now = Date.now();
    if (!force && pluginsCacheRef.current && now - pluginsCacheRef.current.at < RESOURCE_TTL_MS) {
      setPlugins(pluginsCacheRef.current.list);
      setLoadingPlugins(false);
      return;
    }
    if (!force && pluginsCacheRef.current) {
      setPlugins(pluginsCacheRef.current.list);
    }
    pluginsAbortRef.current?.abort();
    const ctrl = new AbortController();
    pluginsAbortRef.current = ctrl;
    setLoadingPlugins(true);
    try {
      const res = await api.get('/v1/openclaw/plugins', { signal: ctrl.signal });
      const data = res.data.data || res.data || [];
      pluginsCacheRef.current = { list: data, at: Date.now() };
      setPlugins(data);
      setPluginsUpdatedAt(new Date().toLocaleString());
    } catch (err) {
      if (axios.isCancel(err)) return;
    } finally {
      setLoadingPlugins(false);
    }
  };

  const onShowGlobalLoading = (message: string, duration: number = 3000) => {
    setGlobalLoadingMessage(message);
    setGlobalLoadingCountdown(Math.ceil(duration / 1000)); // 初始化倒计时秒数
  };

  const checkVersionUpdate = async (refresh = false) => {
    try {
      const res = await api.get(`/v1/system/version${refresh ? '?refresh=true' : ''}`);
      if (res.data) {
        setVersionUpdate(res.data);
        return res.data;
      }
      return null;
    } catch (e) {
      console.warn(t('common.versionCheckFailed'), e);
      return null;
    }
  };

  const handleUpgrade = async (version: string) => {
    try {
      const res = await api.post('/v1/system/upgrade', { version });
      const taskID = res.data?.taskID || res.data?.data?.taskID;
      if (taskID) {
        baseUpdateTask({
          id: taskID,
          name: `${t('common.systemUpgrade')}: v${version}`,
          module: 'system',
          action: 'upgrade',
          target: version,
          status: 'Running',
          progress: 5,
          startTime: new Date().toISOString()
        });
        message.loading(t('common.upgradeStarted'), 2);
      }
    } catch (err: any) {
      message.error(err.response?.data?.message || t('common.upgradeFailed'));
    }
  };

  const handleRestart = async () => {
    try {
      message.loading(t('common.restarting'), 0); 
      await api.post('/v1/system/restart');
      
      // 给几秒钟时间让进程重启，然后刷新页面
      setTimeout(() => {
        window.location.reload();
      }, 6000);
    } catch (err: any) {
      message.destroy();
      message.error(err.response?.data?.message || t('common.restartFailed'));
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

  const handleUnbindWeixin = async (id: string) => {
    try {
      const res = await api.delete(`/v1/wechat/unbind/${id}`);
      if (res.data.code === 200) {
        message.info(t('chat.asyncCommandTip', { title: t('tasks.unbind_wechat') }));
        // 强制刷新渠道列表以显示任务状态
        fetchChatChannels(true);
      }
    } catch (error: any) {
      message.error(t('common.error') + ": " + (error.response?.data?.message || error.message));
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
    api.post('/v1/auth/logout').catch(() => { /* ignore */ }).finally(() => {
      storage.removeItem('guardian_token');
      window.location.reload();
    });
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

  /** 聊天/仪表盘需要实时网关 WS；其它页面暂停 WS 时用工 HTTP gateway.status 兜底展示“运行中” */
  const isRunning =
    v3Status === 'authenticated' ||
    (!gatewayWsDesired && (status as any)?.gateway?.status === 'running');

  // 顶栏状态：连接中不应显示“已停止”
  const isConnecting = ['connecting', 'handshaking', 'challenging', 'authorizing', 'identifying'].includes((v3Status || '') as any);
  const gatewayStateText = isRunning
    ? t('dashboard.running')
    : (isConnecting ? t('chat.gatewayConnecting') : t('dashboard.stopped'));

  // [自动刷新] 连通性自愈：当 HTTP 轮询发现网关已启动，但 WebSocket 处于断开或错误状态时，主动拉起连接
  useEffect(() => {
    if (!gatewayWsDesired) return;
    // 仅在非过渡态且 HTTP 状态明确为 running 时触发
    if (!isTransitioning && status?.gateway?.status === 'running') {
      if (v3Status === 'disconnected' || v3Status === 'error') {
        console.log('🔄 [Connectivity] Gateway is running (HTTP), but WebSocket is inactive. Triggering auto-reconnect...');
        v3Connect();
      }
    }
  }, [gatewayWsDesired, status?.gateway?.status, v3Status, v3Connect, isTransitioning]);


  // --- Menu Configuration ---
  const disabledFeatures = versionUpdate?.gui_disable_features?.split(',') || [];

  const rawMenuItems = [
    {
      key: 'grp-monitor',
      label: t('common.monitor'),
      icon: <Activity size={16} />,
      children: [
        { key: 'dashboard', label: t('common.dashboard'), icon: <LayoutDashboard size={14} /> },
        { key: 'audit', label: t('audit.title'), icon: <ShieldCheck size={14} /> },
        {
          key: 'logs',
          label: (
            <span>
              {t('common.logs')}
              {wsLogs.length > 0 && <Badge status="processing" size="small" style={{ marginLeft: 8 }} />}
            </span>
          ),
          title: t('common.logs'),
          icon: <Terminal size={14} />
        },
        {
          key: 'tools',
          label: (
            <span>
              {t('common.tools')}
              {healEvents.length > 0 && (
                <Badge 
                  count={healEvents.length} 
                  size="small" 
                  style={{ marginLeft: 8, backgroundColor: '#3b82f6' }} 
                />
              )}
            </span>
          ),
          title: t('common.tools'),
          icon: <Zap size={14} />
        },        { key: 'shell', label: t('common.shell'), icon: <Terminal size={14} /> },
        { key: 'security', label: t('security.title'), icon: <ShieldCheck size={14} /> },
        { key: 'cron', label: t('common.cron'), icon: <Clock size={14} /> },
      ]
    },
    {
      key: 'grp-assets',
      label: t('common.assets'),
      icon: <Boxes size={16} />,
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
      icon: <ToyBrick size={16} />,
      children: [
        { key: 'components', label: t('common.channels'), icon: <ToyBrick size={14} /> },
        { key: 'devices', label: t('common.devices'), icon: <Smartphone size={14} /> },
      ]
    },
    {
      key: 'grp-system',
      label: t('common.systemAdmin'),
      icon: <Settings size={16} />,
      children: [
        { key: 'system.users', label: t('common.userManagement'), icon: <Users size={14} /> },
      ]
    },
    {
      key: 'grp-external',
      label: t('common.external'),
      icon: <ExternalLink size={16} />,
      children: [
        { key: 'lobster-panel', label: t('common.lobsterPanel'), icon: <ExternalLink size={14} /> },
      ]
    }
  ];

  // 菜单 key → 所需权限 key（仅对需要权限保护的页面登记；其余默认放行）
  const menuPermissionMap: Record<string, string> = {
    // 监控中心
    'dashboard': 'menu:monitor:dashboard:view',
    'audit': 'menu:monitor:audit:view',
    'logs': 'menu:monitor:logs:view',
    'tools': 'menu:monitor:self_healing:manage',
    'shell': 'menu:monitor:shell:manage',
    'security': 'menu:monitor:security:manage',
    'cron': 'menu:monitor:cron:view',
    // 资产管理
    'chat': 'menu:assets:chat:view',
    'tui': 'menu:assets:tui:view',
    'bots-models': 'menu:assets:bots:manage',
    'skills': 'menu:assets:skills:manage',
    'plugins': 'menu:assets:plugins:manage',
    'experts': 'menu:assets:experts:view',
    // 绑定中心
    'components': 'menu:binding:channels:manage',
    'devices': 'menu:binding:devices:manage',
    // 系统管理
    'system.users': 'menu:system:user:manage',
    // 外部工具
    'lobster-panel': 'menu:external:lobster_panel:open',
  };
  const hasMenuPerm = (key: string) => {
    const need = menuPermissionMap[key];
    if (!need) return true;
    if (authMe.is_superadmin) return true;
    return authMe.permissions.includes(need);
  };

  const menuItems = rawMenuItems
    .filter(group => {
      // 如果配置为不显示外部工具，则过滤掉 grp-external 组
      if (group.key === 'grp-external' && !versionUpdate?.show_external_tools) {
        return false;
      }
      return true;
    })
    .map(group => ({
      ...group,
      children: group.children?.filter(item => {
        // 核心功能 'chat' (在线聊天 Web 版) 不允许被隐藏
        if (item.key === 'chat') return true;
        if (disabledFeatures.includes(item.key)) return false;
        return hasMenuPerm(item.key);
      })
    })).filter(group => group.children && group.children.length > 0);

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
          status={mergedStatus}
          history={history}
 
          wsLogs={wsLogs} 
          v3Status={v3Status}
          isRunning={isRunning} 
          onControl={handleControl} 
          onNavigate={setActiveTab}
          canGatewayControl={hasMenuPerm('tools')}
          canWeChatManage={hasMenuPerm('components')}
          systemEvents={systemEvents}
          topBots={topBots}
          loading={loadingTopBots}
          ocInstalled={ocInstalled}
          activeTasks={activeTasks}
          isTransitioning={isTransitioning}
          onRefreshVersion={checkVersionUpdate}
          onUpgrade={handleUpgrade}
          onRestart={handleRestart}
          isDarkMode={isDarkMode}
          tag={tag}
          />
          ),
          'audit': <AuditDashboard isDarkMode={isDarkMode} />,
          'bots-models': (
          <BotsManager          modelsConfig={modelsConfig}
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
          isRunning={isRunning}
          isDarkMode={isDarkMode}
          onNavigateToDashboard={() => {
            setActiveTab('dashboard');
            window.location.hash = 'actions';
          }}
          onNavigateToChat={(botId: string) => {
            window.sessionStorage.setItem('v3_quick_chat_bot', `openclaw:${botId}`);
            setActiveTab('chat');
          }}
        />
      ),
      'components': (
        <ChannelsManager 
          chatChannels={chatChannels} weixinStatus={weixinStatus} loadingChannels={loadingChannels} 
          loadingWeixin={loadingWeixin} checkWeixinSeconds={checkWeixinSeconds}
          isGettingQR={isGettingQR} onInstallWeixin={handleInstallWeixin} onGetQRCode={() => handleControl('wechat')}
          onRefreshChannels={() => fetchChatChannels(true)}
          onRefreshWeixin={() => checkWeixinPlugin(true)}
          refreshingWeixin={refreshingWeixin}
          onUnbindWeixin={handleUnbindWeixin}
          activeTasks={activeTasks}
          isMobile={isMobile}
          isRunning={isRunning}
          isDarkMode={isDarkMode}
          onNavigateToDashboard={() => {
            setActiveTab('dashboard');
            window.location.hash = 'actions';
          }}
        />
      ),
      'devices': (
        <DeviceManager 
          devices={devices} loadingDevices={loadingDevices} 
          onApproveDevice={handleApproveDevice} 
          onRefresh={() => fetchDevices(true)}
          isMobile={isMobile}
          isRunning={isRunning}
          isDarkMode={isDarkMode}
          onNavigateToDashboard={() => {
            setActiveTab('dashboard');
            window.location.hash = 'actions';
          }}
        />
      ),
      'logs': <LogsViewer wsLogs={wsLogs} wsConnectionState={wsConnectionState} activeSource={logSource} onSourceChange={setLogSource} isRunning={isRunning} isDarkMode={isDarkMode} onNavigateToDashboard={() => {
            setActiveTab('dashboard');
            window.location.hash = 'actions';
          }} />,
      'tools': <SelfHealing selfHealingEnabled={selfHealingEnabled} healEvents={healEvents} loadingSets={loadingSets} onToggle={toggleSelfHealing} ocInstalled={ocInstalled} isDarkMode={isDarkMode} />,
      'chat': <OnlineChat
        botsModels={botsModels}
        loadingBots={loadingBots}
        onRefreshBots={fetchBotsModels}
        isMobile={isMobile}
        onRestartGateway={restartGateway}
        isRunning={isRunning}
        isDarkMode={isDarkMode}
        allowedBotIDs={authMe?.bot_ids}
        usernameForSessionKey={authMe?.username || null}
        usernameForSessionId={(authMe?.login_type || '') === 'password' ? (authMe?.username || null) : null}
        filterV3SessionsByUsername={
          !authMe?.is_superadmin &&
          (authMe?.login_type || '') !== 'token' &&
          !(authMe?.role_keys || []).includes('admin')
        }
        onNavigateToDashboard={() => {
          setActiveTab('dashboard');
          window.location.hash = 'actions';
        }}
      />,
      'tui': <TuiView isRunning={isRunning} isDarkMode={isDarkMode} onNavigateToDashboard={() => {
            setActiveTab('dashboard');
            window.location.hash = 'actions';
          }} />,
      'shell': <ShellView />,
      'skills': <SkillManagement 
        isMobile={isMobile} 
        onRefresh={fetchSkills} 
        loading={loadingSkills} 
        skills={skills}
        activeTasks={activeTasks}
        isRunning={isRunning}
        isDarkMode={isDarkMode}
        onNavigateToDashboard={() => {
            setActiveTab('dashboard');
            window.location.hash = 'actions';
          }}
      />,
      'plugins': <PluginManagement 
        isMobile={isMobile} 
        plugins={plugins} 
        loading={loadingPlugins} 
        onRefresh={fetchPlugins} 
        updatedAt={pluginsUpdatedAt} 
        onTaskUpdate={handleTaskUpdate}
        activeTasks={activeTasks}
        isRunning={isRunning}
        isDarkMode={isDarkMode}
        onNavigateToDashboard={() => {
            setActiveTab('dashboard');
            window.location.hash = 'actions';
          }}
      />,
      'experts': <ExpertMarket isMobile={isMobile} onNavigate={setActiveTab} isRunning={isRunning} isDarkMode={isDarkMode} onNavigateToDashboard={() => {
            setActiveTab('dashboard');
            window.location.hash = 'actions';
          }} />,
      'security': (
        <SecurityManager 
          isMobile={isMobile}
          isRunning={isRunning}
          bots={botsModels?.data?.bots || []}
          activeTasks={activeTasks}
          isDarkMode={isDarkMode}
          onNavigateToDashboard={() => {
            setActiveTab('dashboard');
            window.location.hash = 'actions';
          }}
        />
      ),
      'cron': <CronJobsView isDarkMode={isDarkMode} />,
      'system.users': <UserManagerView isDarkMode={isDarkMode} isMobile={isMobile} canManage={hasMenuPerm('system.users')} />,
    };

    return (
      <ErrorBoundary key={activeTab}>
        <Suspense
          fallback={
            <div style={{ padding: 40, textAlign: 'center', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Spin size="large" tip={t('common.loading')} />
            </div>
          }
        >
          {viewMap[activeTab] || <div style={{ padding: 40, textAlign: 'center' }}><Spin size="large" tip={t('common.loading')} /></div>}
        </Suspense>
      </ErrorBoundary>
    );
  };

  if (fetching && !status) return <CrayfishLoading isDarkMode={isDarkMode} />;

  /** 受控用户 bot_ids 为空时：仅盖住主内容区（侧栏不挡，可换页）；置于 Content 内 absolute */
  const showNoBotChatOverlay =
    activeTab === 'chat' && Array.isArray(authMe?.bot_ids) && authMe.bot_ids.length === 0;
  const noBotChatOverlay = showNoBotChatOverlay ? (
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
  ) : null;

  const globalLoadingMask = (globalLoadingMessage || dashboardProcessing) && (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: isDarkMode ? 'rgba(15, 23, 42, 0.8)' : 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(2px)',
      zIndex: 9999, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 20,
      animation: 'fadeIn 0.3s ease-out'
    }}>
      <div style={{
        padding: isMobile ? '24px 20px' : '32px 40px', 
        background: isDarkMode ? '#1e293b' : '#fff', borderRadius: 24,
        boxShadow: isDarkMode ? '0 25px 50px -12px rgba(0, 0, 0, 0.5)' : '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20,
        width: isMobile ? '100%' : 'auto', maxWidth: 340, minWidth: isMobile ? 0 : 320
      }}>
        <Spin size="large" />
        <div style={{ textAlign: 'center' }}>
          {isTransitioning ? (
            <>
              <div style={{ fontWeight: 700, color: isDarkMode ? '#f1f5f9' : '#1e293b', fontSize: 16 }}>
                {targetStatus && t(`chat.status.${targetStatus}`)}
                {!targetStatus && t('chat.status.syncing')}
              </div>
              <div style={{ color: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 13, marginTop: 6 }}>
                {targetStatus && t(`chat.status.${targetStatus}_desc`)}
                {!targetStatus && t('common.waitingGateway')}
              </div>
              <div style={{
                marginTop: 16, padding: '6px 16px', background: isDarkMode ? '#1e293b' : '#eff6ff',
                borderRadius: 20, fontSize: 13, color: '#2563eb',
                fontWeight: 700, display: 'inline-block', border: `1px solid ${isDarkMode ? '#334155' : '#dbeafe'}`
              }}>
                {t('common.secondsElapsed', { seconds: transitionSeconds })}
              </div>
            </>
          ) : globalLoadingMessage ? (
            <>
              <div style={{ fontWeight: 700, color: isDarkMode ? '#f1f5f9' : '#1e293b', fontSize: 16 }}>{globalLoadingMessage}</div>
              <div style={{ color: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 13, marginTop: 6 }}>{t('common.waiting')}</div>
              <div style={{
                marginTop: 16, padding: '6px 16px', background: isDarkMode ? '#1e293b' : '#eff6ff',
                borderRadius: 20, fontSize: 13, color: '#2563eb',
                fontWeight: 700, display: 'inline-block', border: `1px solid ${isDarkMode ? '#334155' : '#dbeafe'}`
              }}>
                {globalLoadingCountdown > 0 ? t('common.loadingCountdown', { seconds: globalLoadingCountdown }) : t('common.syncing')}
              </div>
            </>
          ) : dashboardProcessing ? (
            <>
              <div style={{ fontWeight: 700, color: isDarkMode ? '#f1f5f9' : '#1e293b', fontSize: 18, marginBottom: 4 }}>
                {t('common.lobsterPanel')}
              </div>
              <div style={{ color: isDarkMode ? '#94a3b8' : '#64748b', fontSize: 13, lineHeight: 1.6 }}>
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



  const headerEl = (onMenuClick?: () => void) => {
    const breadcrumbTitle = `${t('common.console')} / ${getActiveLabel(activeTab)}`;
    const gatewayTitle = [
      'Gateway',
      gatewayStateText,
      isRunning && lastHealth?.latency !== undefined ? `${lastHealth.latency}ms` : '',
    ].filter(Boolean).join(' · ');

    const gatewayBadgeText = (
      <span
        style={{
          color: isDarkMode ? '#94a3b8' : '#64748b',
          fontSize: isMobile ? 10 : 12,
          fontWeight: 500,
          whiteSpace: 'nowrap',
          maxWidth: isMobile ? 76 : undefined,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: 'inline-block',
          verticalAlign: 'middle',
        }}
      >
        {!isMobile && 'Gateway '}
        {gatewayStateText}
        {isRunning && lastHealth?.latency !== undefined && (
          <span style={{ color: '#10b981', marginLeft: isMobile ? 2 : 4, fontWeight: 700 }}>
            {isMobile ? `${lastHealth.latency}ms` : `(${lastHealth.latency}ms)`}
          </span>
        )}
      </span>
    );

    return (
    <Header style={{
      background: isDarkMode ? '#1e293b' : '#fff', height: 56, padding: isMobile ? '0 8px' : '0 24px', borderBottom: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
      position: 'sticky', top: 0, zIndex: 20, flexShrink: 0, lineHeight: 'normal',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 8, minWidth: 0, flex: 1, overflow: 'hidden' }}>
        <Button 
          type="text" 
          icon={<MenuIcon size={isMobile ? 18 : 20} />} 
          onClick={onMenuClick} 
          style={{ marginLeft: isMobile ? -4 : -8, color: isDarkMode ? '#94a3b8' : '#64748b', flexShrink: 0 }} 
        />
        {isMobile ? (
          <Tooltip title={breadcrumbTitle}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                color: isDarkMode ? '#94a3b8' : '#64748b',
                minWidth: 0,
                flex: 1,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
              >
                <span 
                  style={{ fontWeight: 600, color: isDarkMode ? '#f1f5f9' : '#1e293b', cursor: 'pointer', transition: 'color 0.2s' }} 
                  onClick={(e) => { e.stopPropagation(); setActiveTab('dashboard'); }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#2563eb')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = isDarkMode ? '#f1f5f9' : '#1e293b')}
                >
                  {t('common.console')}
                </span>
                <span> / </span>
                <span style={{ color: '#2563eb', fontWeight: 500 }}>
                  {getActiveLabel(activeTab)}
                </span>
              </div>
            </div>
          </Tooltip>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 14,
              color: isDarkMode ? '#94a3b8' : '#64748b',
              minWidth: 0,
              flex: 1,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              <span 
                style={{ fontWeight: 600, color: isDarkMode ? '#f1f5f9' : '#1e293b', cursor: 'pointer', transition: 'color 0.2s' }} 
                onClick={() => setActiveTab('dashboard')}
                onMouseEnter={(e) => (e.currentTarget.style.color = '#2563eb')}
                onMouseLeave={(e) => (e.currentTarget.style.color = isDarkMode ? '#f1f5f9' : '#1e293b')}
              >
                {t('common.console')}
              </span>
              <span> / </span>
              <span style={{ color: '#2563eb', fontWeight: 500 }}>
                {getActiveLabel(activeTab)}
              </span>
            </div>
          </div>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 12, flexShrink: 0 }}>
        <TaskTray 
          tasks={activeTasks} 
          isMobile={isMobile} 
          isDarkMode={isDarkMode}
          loading={tasksLoading} 
          onRefresh={() => fetchActiveTasks(false, true)}
        />
        <LanguageSwitcher isMobile={isMobile} />
        <Button
          type="text"
          icon={isDarkMode ? <Sun size={isMobile ? 16 : 18} /> : <Moon size={isMobile ? 16 : 18} />}
          onClick={toggleTheme}
          style={{ color: isDarkMode ? '#94a3b8' : '#64748b', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? '0 4px' : undefined }}
        />
        {isMobile ? (
          <Tooltip title={gatewayTitle}>
            <span style={{ display: 'inline-flex', alignItems: 'center' }}>
              <Badge
                status={
                  isRunning ? 'success' : 
                  (['challenging', 'authorizing'].includes(v3Status) ? 'processing' : 'error')
                }
                text={gatewayBadgeText}
              />
            </span>
          </Tooltip>
        ) : (
          <Badge
            status={
              isRunning ? 'success' : 
              (['challenging', 'authorizing'].includes(v3Status) ? 'processing' : 'error')
            }
            text={gatewayBadgeText}
          />
        )}
      </div>
    </Header>
    );
  };

  return (
    <>
      {globalLoadingMask}
      
      {isEmbed ? (
        <div style={{ 
          height: '100vh', 
          background: isDarkMode ? '#0f172a' : '#f8fafc', 
          display: 'flex', 
          flexDirection: 'column',
          padding: activeTab === 'chat' || activeTab === 'logs' || activeTab === 'tui' || activeTab === 'shell' ? 0 : 24,
          overflow: activeTab === 'chat' || activeTab === 'logs' || activeTab === 'tui' || activeTab === 'shell' ? 'hidden' : 'auto',
          position: 'relative',
        }}>
          {renderContent()}
          {noBotChatOverlay}
        </div>
      ) : isMobile ? (
        <Layout style={{ 
          height: (activeTab === 'chat' || activeTab === 'logs' || activeTab === 'tui' || activeTab === 'shell') ? '100vh' : 'auto', 
          minHeight: '100vh',
          background: isDarkMode ? '#0f172a' : '#f8fafc', 
          overflow: (activeTab === 'chat' || activeTab === 'logs' || activeTab === 'tui' || activeTab === 'shell') ? 'hidden' : 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}>
          {headerEl(() => setMobileMenuOpen(true))}
          <Content style={{ 
            padding: activeTab === 'tui' || activeTab === 'shell' || activeTab === 'chat' || activeTab === 'logs' ? 0 : 16, 
            background: isDarkMode
              ? '#0f172a'
              : (activeTab === 'tui' || activeTab === 'shell' ? '#0f172a' : '#f8fafc'),
            position: 'relative',
            flex: 1,
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
          }}>
            <div style={{ position: 'relative', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {renderContent()}
              {noBotChatOverlay}
            </div>
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
              onLogout={handleLogout}
              principalName={(authMe?.real_name || authMe?.username || '').trim() || undefined}
              navItems={menuItems} 
              versionUpdate={versionUpdate}
            />
          </Drawer>
        </Layout>
      ) : (
        <Layout style={{ 
          height: (activeTab === 'chat' || activeTab === 'logs' || activeTab === 'tui' || activeTab === 'shell') ? '100vh' : 'auto', 
          minHeight: '100vh',
          background: isDarkMode ? '#0f172a' : '#f8fafc', 
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
              onLogout={handleLogout}
              principalName={(authMe?.real_name || authMe?.username || '').trim() || undefined}
              navItems={menuItems} 
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
              background: isDarkMode ? '#0f172a' : '#f8fafc', 
              flex: 1,
              display: 'flex', 
              flexDirection: 'column', 
              minHeight: 0,
              position: 'relative',
            }}>
              <div style={{ 
                position: 'relative',
                maxWidth: 'none', 
                margin: '0 auto', 
                flex: 1,
                width: '100%',
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0
              }}>
                {renderContent()}
                {noBotChatOverlay}
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
        <div style={{ background: isDarkMode ? '#1e293b' : '#fff', padding: '32px 24px', textAlign: 'center', borderRadius: 16 }}>
          <div style={{ 
            width: 56, height: 56, borderRadius: '50%', background: `${confirmModal.color}15`,
            display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px'
          }}>
            {confirmModal.action === 'start' && <Play size={24} color={confirmModal.color} />}
            {confirmModal.action === 'stop' && <Square size={24} color={confirmModal.color} />}
            {confirmModal.action === 'restart' && <RefreshCw size={24} color={confirmModal.color} />}
            {confirmModal.action === 'wechat' && <Smartphone size={24} color={confirmModal.color} />}
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: isDarkMode ? '#f1f5f9' : '#1e293b', marginBottom: 8 }}>{confirmModal.title}</h3>
          <p style={{ fontSize: 13, color: isDarkMode ? '#94a3b8' : '#64748b', marginBottom: 24, lineHeight: 1.6 }}>
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
        <div style={{ background: isDarkMode ? '#1e293b' : '#fff', padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>🦞</div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: isDarkMode ? '#f1f5f9' : '#1e293b', marginBottom: 8 }}>{t('chat.wechatAuth')}</h3>
          <p style={{ fontSize: 13, color: isDarkMode ? '#94a3b8' : '#64748b', marginBottom: 24, lineHeight: 1.6 }}>
            {t('chat.wechatAuthDesc')}
          </p>
          <div style={{ background: isDarkMode ? '#0f172a' : '#f8fafc', padding: 16, borderRadius: 12, border: `1px solid ${isDarkMode ? '#334155' : '#f1f5f9'}`, display: 'inline-block', marginBottom: 12 }}>
            {qrData && <QRCode value={qrData.qrcode_url} size={isMobile ? 160 : 180} bordered={false} color={isDarkMode ? '#f1f5f9' : '#1e293b'} bgColor={isDarkMode ? '#0f172a' : '#fff'} />}
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
        isDarkMode={isDarkMode}
      />
    </>
  );
};

// --- App Root ---------------------------------------------------------------------
export default function App() {
  const { t } = useTranslation();
  // 只从持久化存储获取初始 Token (不再信任 URL 传来的未经验证的 Token)
  const [token, setToken] = useState<string | null>(storage.getItem('guardian_token'));
  const [isValidating, setIsValidating] = useState(false);
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1023px)').matches : false
  );

  // Theme state
  const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
    return storage.getItem('theme') === 'dark' || 
           (!storage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  const toggleTheme = () => {
    setIsDarkMode(prev => {
      const newVal = !prev;
      storage.setItem('theme', newVal ? 'dark' : 'light');
      return newVal;
    });
  };

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)');
    const apply = () => setIsMobile(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const interceptor = api.interceptors.response.use(
      (response) => response,
      (error) => {
        // 只有 HTTP 401 且之前有 token 时才触发清理（避免自动登录失败时的循环）
        if (error.response?.status === 401) {
          const hasToken = !!storage.getItem('guardian_token');
          storage.removeItem('guardian_token');
          setToken(null);
          // 仅在之前是成功登录状态时显示过期提示
          if (hasToken) message.error(t('common.sessionExpired'));
        }
        return Promise.reject(error);
      }
    );
    return () => api.interceptors.response.eject(interceptor);
  }, [token, t]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token')?.trim();
    const urlTag = params.get('tag')?.trim();

    const validateUrlToken = async (uToken: string, uTag?: string) => {
      setIsValidating(true);
      try {
        // 必须通过 /login 接口验证 Token 合法性，逻辑与 LoginView 保持一致
        const res = await api.post('/login', { token: uToken });
        if (res.data.status === 'success') {
          // 验证通过，持久化并更新状态
          storage.setItem('guardian_token', uToken);
          if (uTag) {
            if (uTag === 'none') {
              storage.removeItem('guardian_tag');
            } else {
              storage.setItem('guardian_tag', uTag);
            }
          }
          setToken(uToken);
          message.success(t('common.autoLogin'));
        }
      } catch (err: any) {
        // 验证失败，不更新 Token 状态，停留在 LoginView
        message.error(err.response?.data?.error || t('login.invalidCredentials'));
      } finally {
        setIsValidating(false);
        // 清理 URL 保持整洁
        params.delete('token');
        if (uTag) params.delete('tag');
        const newSearch = params.toString();
        const newUrl = window.location.pathname + (newSearch ? `?${newSearch}` : '');
        window.history.replaceState({}, '', newUrl);
      }
    };

    if (urlToken) {
      validateUrlToken(urlToken, urlTag);
    }
  }, [t]);

  if (isValidating) {
    return <CrayfishLoading isDarkMode={isDarkMode} />;
  }

  return (
    <ConfigProvider theme={{
      algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: '#2563eb',
        borderRadius: 8,
        fontFamily: "'Inter', sans-serif",
        colorBgContainer: isDarkMode ? '#1e293b' : '#ffffff',
        colorBgLayout: isDarkMode ? '#0f172a' : '#f5f5f5',
        colorText: isDarkMode ? '#f1f5f9' : '#334155',
      },
      components: {
        Menu: {
          darkItemBg: 'transparent',
          darkItemSelectedBg: '#1d4ed8',
          darkItemHoverBg: '#1e293b',
          darkItemColor: '#94a3b8',
          darkItemSelectedColor: '#fff',
        },
        ...(isDarkMode
          ? {
              Message: {
                contentBg: '#1e293b',
                colorText: '#f1f5f9',
                colorSuccess: '#4ade80',
                colorError: '#f87171',
                colorWarning: '#fbbf24',
                colorInfo: '#93c5fd',
              },
              Notification: {
                colorBgElevated: '#1e293b',
                colorText: '#f1f5f9',
              },
            }
          : {}),
      },
    }}>
      <TooltipDisabledProvider disabled={isMobile}>
        {token ? (
          <V3GatewayProvider>
            <Dashboard isDarkMode={isDarkMode} toggleTheme={toggleTheme} />
          </V3GatewayProvider>
        ) : (
          <LoginView onLoginSuccess={setToken} isDarkMode={isDarkMode} />
        )}
      </TooltipDisabledProvider>
    </ConfigProvider>
  );
}
