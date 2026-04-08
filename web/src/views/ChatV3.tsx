import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Select, Input, Button, Spin, message, Tag, Badge, Modal, Form, Tooltip, Drawer, Switch } from 'antd';
import { useTranslation } from 'react-i18next';
import { Bot, RefreshCw, ShieldCheck, Cpu, Plus, Trash2, History, LayoutPanelLeft, Activity, Settings, ChevronUp, ChevronDown, Clock, Key, Sparkles, Save, X, Zap, Quote, Wand2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import * as nacl from 'tweetnacl';
import { sha256 } from 'js-sha256';
import storage from '../utils/storage';
import GatewayOfflineMask from '../components/GatewayOfflineMask';
import V3SessionList from '../components/Chat/V3SessionList';
import V3InputArea from '../components/Chat/V3InputArea';
import V3MessageItem from '../components/Chat/V3MessageItem';
import { getWsUrl } from '../utils/url';
import { getTicket, summarizeSession } from '../api';


// --- Types ---
interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  metrics?: {
    ttft?: number;
    tps?: number;
    duration?: number;
  }
}

interface ChatV3Props {
  botsModels: any;
  loadingBots: boolean;
  onRefreshBots: () => void;
  isMobile?: boolean;
  isRunning?: boolean;
  onNavigateToDashboard?: () => void;
}

// --- Utils ---
const base64URLNoPadding = (data: Uint8Array): string => {
  const base64 = btoa(String.fromCharCode(...data));
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
};

const hexToUint8Array = (hex: string): Uint8Array => {
  const matched = hex.match(/.{1,2}/g);
  return new Uint8Array(matched ? matched.map(byte => parseInt(byte, 16)) : []);
};

const ChatV3: React.FC<ChatV3Props> = ({ botsModels, loadingBots, isMobile, isRunning, onNavigateToDashboard }) => {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText] = useState('');
  const [selectedBot, setSelectedBot] = useState<string>('');
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error'>('disconnected');
  const [isTyping, setIsTyping] = useState(false);
  const [isStalled, setIsStalled] = useState(false);
  const stallTimerRef = useRef<any>(null);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [sessionLabel, setSessionLabel] = useState<string | null>(null);
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [editingLabelText, setEditingLabelText] = useState('');
  const [isUpdatingLabel, setIsUpdatingLabel] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [showThinking, setShowThinking] = useState<boolean>(() => storage.getItem('v3_show_thinking') === 'true');
  const [thinkingLevel, setThinkingLevel] = useState<'low' | 'medium' | 'high' | 'pro'>('medium');
  const [sessionModel, setSessionModel] = useState<string>('');
  const [lastHealth, setLastHealth] = useState<{ ok: boolean, latency: number, ts: number } | null>(null);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [pulse, setPulse] = useState(0);
  
  // --- Soul Quick Edit States ---
  const [isSoulDrawerOpen, setIsSoulDrawerOpen] = useState(false);
  const [soulContent, setSoulContent] = useState('');
  const [isSoulLoading, setIsSoulLoading] = useState(false);
  const [isSoulSaving, setIsSoulSaving] = useState(false);

  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showScrollTopBtn, setShowScrollTopBtn] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [tpsData, setTpsData] = useState<number[]>([]);
  const [editingMsgIndex, setEditingMsgIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');

  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  // @ts-ignore: Temporarily unused since pagination is disabled
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const [sessionSearch, setSessionSearch] = useState('');
  const [quickCommands, setQuickCommands] = useState<any[]>([]);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(() => storage.getItem('v3_show_quick_actions') === 'true');
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [form] = Form.useForm();
  const [showSider, setShowSider] = useState(!isMobile);
  const [quotedMsg, setQuotedMsg] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastScrollTopRef = useRef(0);
  const requestIdRef = useRef(1);
  const pendingRequests = useRef<Map<string, (res: any) => void>>(new Map());

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    
    // 1. 处理返回底部按钮逻辑
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 150;
    setShowScrollBtn(!isAtBottom);
    if (isAtBottom) {
      setHasNewMessages(false);
    }

    // 2. 处理返回顶部按钮逻辑 (仅当向上滚动且超过 150px 时显示)
    const isScrollingUp = scrollTop < lastScrollTopRef.current;
    setShowScrollTopBtn(isScrollingUp && scrollTop > 150);

    // 记录本次滚动位置
    lastScrollTopRef.current = scrollTop;
  };

  // --- Performance Tracking Refs ---
  const startTimeRef = useRef<number>(0);
  const ttftRecordedRef = useRef<boolean>(false);
  const tokenCountRef = useRef<number>(0);
  const firstTokenTimeRef = useRef<number>(0);

  // --- Key Management ---
  const [keyPair, setKeyPair] = useState<nacl.BoxKeyPair | null>(null);
  const [deviceId, setDeviceId] = useState<string>('');

  useEffect(() => {
    const initKeys = async () => {
      let seedHex = storage.getItem('openclaw_v3_seed');
      let seed: Uint8Array;
      if (!seedHex) {
        seed = nacl.randomBytes(32);
        storage.setItem('openclaw_v3_seed', Array.from(seed).map(b => b.toString(16).padStart(2, '0')).join(''));
      } else {
        seed = hexToUint8Array(seedHex);
      }
      
      const kp = nacl.sign.keyPair.fromSeed(seed);
      setKeyPair(kp as any);

      // SHA256 of raw public key bytes (与 Go 测试文件对齐)
      let hashArray: number[];
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', kp.publicKey.buffer as ArrayBuffer);
        hashArray = Array.from(new Uint8Array(hashBuffer));
      } else {
        // Fallback for non-secure contexts (e.g., LAN IP)
        const hashHex = sha256(kp.publicKey);
        hashArray = Array.from(hexToUint8Array(hashHex));
      }
      
      const did = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      setDeviceId(did);
    };
    initKeys();
    fetchQuickCommands();
  }, []);

  // 默认选中首个机器人
  useEffect(() => {
    if (!selectedBot && botsModels?.data?.bots?.length > 0) {
      const firstBot = botsModels.data.bots[0];
      setSelectedBot(`openclaw:${firstBot.id}`);
    }
  }, [botsModels, selectedBot]);

  const fetchQuickCommands = async () => {
    try {
      const res = await import('../api').then(m => m.default.get('/v1/openclaw/chat/quick-commands'));
      setQuickCommands(res.data || []);
    } catch (err) {
      console.error('Failed to fetch quick commands:', err);
    }
  };

  const handleOpenSoulEditor = async () => {
    if (!selectedBot) return;
    const botId = selectedBot.replace('openclaw:', '');
    try {
      setIsSoulLoading(true);
      setIsSoulDrawerOpen(true);
      const bot = botsModels?.data?.bots?.find((b: any) => b.id === botId);
      const workspaceParam = bot?.workspace ? `&workspace=${encodeURIComponent(bot.workspace)}` : '';
      const api = await import('../api').then(m => m.default);
      const res = await api.get(`/v1/openclaw/bots/file?id=${botId}&type=soul${workspaceParam}`);
      setSoulContent(res.data.content || '');
    } catch (err: any) {
      message.error(t('common.loadFailed'));
    } finally {
      setIsSoulLoading(false);
    }
  };

  const handleSaveSoulContent = async () => {
    if (!selectedBot) return;
    const botId = selectedBot.replace('openclaw:', '');
    try {
      setIsSoulSaving(true);
      const bot = botsModels?.data?.bots?.find((b: any) => b.id === botId);
      const api = await import('../api').then(m => m.default);
      await api.post('/v1/openclaw/bots/file', {
        id: botId,
        type: 'soul',
        content: soulContent,
        workspace: bot?.workspace
      });
      message.success(t('bots.saveSuccess'));
      setIsSoulDrawerOpen(false);
    } catch (err: any) {
      message.error(t('bots.saveFailed'));
    } finally {
      setIsSoulSaving(false);
    }
  };

  // 头像组件：稳定 img，不每次重新加载图片
  const BotAvatar = ({ provider, size = 34 }: { provider: string, size?: number }) => {
    const p = (provider || '').toLowerCase();
    const wrapStyle = { width: size, height: size, borderRadius: '50%', background: '#fff', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', flexShrink: 0 as const };
    
    if (p.includes('openai')) return <div style={wrapStyle}><Bot size={size * 0.55} color="#10a37f" /></div>;
    if (p.includes('anthropic') || p.includes('claude')) return <div style={{ ...wrapStyle, fontSize: size * 0.45, fontWeight: 900, color: '#d97706', fontFamily: 'serif' }}>A</div>;
    if (p.includes('google') || p.includes('gemini')) return <div style={wrapStyle}><Zap size={size * 0.55} color="#4285f4" fill="#4285f4" /></div>;
    if (p.includes('deepseek')) return <div style={wrapStyle}><Activity size={size * 0.55} color="#0891b2" /></div>;
    
    // 默认/OpenClaw：统一使用经典模式中的蓝白 Bot 图标风格
    return <div style={wrapStyle}><Bot size={size * 0.55} color="#2563eb" /></div>;
  };

  const handleAddQuickCommand = async (values: any) => {
    try {
      const res = await import('../api').then(m => m.default.post('/v1/openclaw/chat/quick-commands', values));
      if (res.data.status === 'success') {
        message.success(t('common.success'));
        form.resetFields();
        fetchQuickCommands();
      }
    } catch (err) {
      message.error(t('common.error'));
    }
  };

  const handleDeleteQuickCommand = async (id: number) => {
    try {
      const res = await import('../api').then(m => m.default.delete(`/v1/openclaw/chat/quick-commands/${id}`));
      if (res.data.status === 'success') {
        message.success(t('common.success'));
        fetchQuickCommands();
      }
    } catch (err) {
      message.error(t('common.error'));
    }
  };

  // --- WebSocket Logic ---
  const connect = useCallback(async () => {
    if (!keyPair || !deviceId) return;
    
    // Close existing
    if (wsRef.current) wsRef.current.close();

    setStatus('connecting');

    // 1. 获取认证票据 (Ticket)
    const ticket = await getTicket();
    const token = storage.getItem('guardian_token');
    
    let wsUrl = '';
    if (ticket) {
      wsUrl = getWsUrl(`/v1/ws/gateway?ticket=${ticket}`);
    } else {
      // 回退到长效 Token (确保嵌入或旧版本兼容)
      wsUrl = getWsUrl(`/v1/ws/gateway?token=${token}`);
    }
    
    console.log('🔌 [V3] Connecting to:', wsUrl);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('✅ [V3] Connection established, waiting for challenge...');
      setStatus('challenging');
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      
      // Handle Events
      if (data.type === 'event') {
        if (data.event === 'health') {
          const { ok, durationMs, ts } = data.payload;
          const latency = durationMs || 0;
          setLastHealth({ ok, latency, ts });
          setLatencyHistory(prev => [...prev.slice(-29), latency]);
          setPulse(p => p + 1);
          return;
        }
        if (['tick', 'presence'].includes(data.event)) return; // 过滤高频系统包
        
        console.log('📥 [V3] Received:', data);
        if (data.event === 'connect.challenge') {
          handleChallenge(data.payload.nonce);
        } else if (data.event === 'chat') {
          handleChatDelta(data.payload);
        } else if (data.event === 'sessions.changed') {
          fetchSessions();
        }
        return;
      }

      console.log('📥 [V3] Received:', data);

      // Handle Responses
      if (data.type === 'res') {
        const resolve = pendingRequests.current.get(data.id);
        if (resolve) {
          resolve(data);
          pendingRequests.current.delete(data.id);
        }
      }
    };

    ws.onclose = () => {
      console.log('🔌 [V3] Connection closed');
      setStatus('disconnected');
    };

    ws.onerror = (err) => {
      console.error('❌ [V3] WebSocket error:', err);
      setStatus('error');
    };
  }, [keyPair, deviceId, t]); // Add t for i18n stability

  const handleChallenge = async (nonce: string) => {
    if (!keyPair || !deviceId) return;

    // 从后端获取 OpenClaw Gateway 的真实 Token (而非 Buddy 的 guardian token)
    let gatewayToken = '';
    try {
      const res = await import('../api').then(m => m.default.get('/v1/openclaw/gateway-token'));
      gatewayToken = res.data?.token || '';
    } catch (e) {
      console.error('❌ [V3] 获取 Gateway Token 失败:', e);
      setStatus('error');
      return;
    }

    const signedAt = Date.now();
    const role = 'operator';
    const scopes = 'operator.admin,operator.read,operator.write';
    const clientId = 'openclaw-control-ui';
    const clientMode = 'cli';
    const platform = navigator.platform.toLowerCase().includes('mac') ? 'macos' : 'windows';

    // v3|{deviceId}|{clientId}|{clientMode}|{role}|{scopes}|{signedAtMs}|{token}|{nonce}|{platform}|{deviceFamily}
    const handshakeStr = `v3|${deviceId}|${clientId}|${clientMode}|${role}|${scopes}|${signedAt}|${gatewayToken}|${nonce}|${platform}|`;
    console.log('🔑 [V3] Handshake payload:', handshakeStr);
    const signature = nacl.sign.detached(new TextEncoder().encode(handshakeStr), (keyPair as any).secretKey);

    const authId = `auth-${Date.now()}`;
    const req = {
      type: 'req',
      id: authId,
      method: 'connect',
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        role,
        scopes: scopes.split(','),
        auth: { token: gatewayToken },
        client: {
          id: clientId,
          mode: clientMode,
          platform,
          version: '1.0.4'
        },
        device: {
          id: deviceId,
          publicKey: base64URLNoPadding(keyPair.publicKey),
          signature: base64URLNoPadding(signature),
          signedAt,
          nonce
        }
      }
    };

    // 注册到 pending requests，等待网关真正的认证响应
    pendingRequests.current.set(authId, (res: any) => {
      if (res.ok) {
        console.log('✅ [V3] 握手成功！');
        setStatus('authenticated');
        setTimeout(() => fetchSessions(), 300);
      } else {
        const errMsg = typeof res.error === 'object' ? JSON.stringify(res.error) : String(res.error);
        if (errMsg.includes('NOT_PAIRED') || errMsg.includes('NOT_AUTHORIZED')) {
            console.warn('🛡️ [V3] 设备未授权 (NOT_PAIRED)，触发静默授权重试...');
            setStatus('authorizing');
            // 等待后台自动 Approval 完成
            setTimeout(() => connect(), 1500);
        } else {
            console.error('❌ [V3] 握手失败:', res.error);
            setStatus('error');
        }
      }
    });

    wsRef.current?.send(JSON.stringify(req));
    console.log('📤 [V3] Handshake sent (id:', authId, ')');
  };

  const fetchSessions = async () => {
    setLoadingSessions(true);
    const res = await sendRPC('sessions.list', { limit: 50 });
    console.log('📋 [V3] sessions.list response:', res);
    if (res.ok) {
      // 兼容不同返回格式：items 数组 或直接是数组
      const list = res.payload?.items || res.payload?.sessions || (Array.isArray(res.payload) ? res.payload : []);
      setSessions(list);
      
      // 核心优化：默认加载最后一次会话
      if (!sessionKey && list.length > 0) {
        handleSelectSession(list[0].key, list[0].label);
      }
    }
    setLoadingSessions(false);
  };

  const parseHistoryMessages = (messagesData: any[]) => {
    return messagesData
        .sort((a: any, b: any) => {
            const timeA = new Date(a.createdAt || a.timestamp || 0).getTime();
            const timeB = new Date(b.createdAt || b.timestamp || 0).getTime();
            return timeA - timeB;
        })
        .map((item: any) => {
            let content = item.content;
            if (Array.isArray(content)) {
                content = content.map((c: any) => {
                    const textPart = c.text || '';
                    const thinkingPart = c.thinking ? `> :::thinking\n> ${c.thinking.replace(/\n/g, '\n> ')}\n> :::\n\n` : '';
                    if (c.type === 'toolCall') {
                        return `\n> :::toolCall\n> **${c.name}**\n> \`\`\`json\n> ${JSON.stringify(c.arguments, null, 2).replace(/\n/g, '\n> ')}\n> \`\`\`\n> :::\n`;
                    }
                    return thinkingPart + textPart;
                }).join('');
            }
            if (item.role === 'toolResult') {
                const toolName = item.toolName || 'unknown';
                const resultText = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
                content = `\n> :::toolResult\n> **${toolName}**\n> ${resultText.split('\n').join('\n> ')}\n> :::\n`;
            }
            return {
                role: item.role === 'toolResult' ? 'assistant' : item.role,
                content: content || '',
                timestamp: new Date(item.createdAt || item.timestamp || Date.now()).toLocaleTimeString()
            };
        });
  };

  const loadSessionHistory = async (key: string) => {
    setHasMoreHistory(true);
    // 调大 limit 到 500，弥补分页功能暂不可用的问题
    const res = await sendRPC('chat.history', { sessionKey: key, limit: 500 });
    if (res.ok) {
        const messagesData = res.payload.messages || res.payload.items || [];
        const history = parseHistoryMessages(messagesData);
        setMessages(history);
        // 如果返回的数据少于 500 条，说明已经到底了
        if (messagesData.length < 500) {
            setHasMoreHistory(false);
        }
    }
  };

  const loadMoreHistory = async () => {
    // 由于后端网关目前不支持 offset/before 分页参数，
    // 暂时停用此功能以避免无效请求报错。
    setHasMoreHistory(false);
    return;
  };

  const handleSelectSession = (key: string, initialLabel?: string) => {
    setSessionKey(key);
    
    // 从当前已加载的列表中查找该会话的完整对象
    const currentSession = sessions.find(s => s.key === key);

    // 如果有传入初始标题（自动加载场景），直接使用，否则从对象中提取
    if (initialLabel) {
      setSessionLabel(initialLabel);
    } else {
      setSessionLabel(currentSession?.label || null);
    }
    
    setSessionModel(currentSession?.model || '');

    loadSessionHistory(key);
    
    // 从 sessionKey 中解析 botId (格式: agent:botId:deviceId:timestamp)
    if (key.startsWith('agent:')) {
      const parts = key.split(':');
      if (parts.length >= 2) {
        setSelectedBot(`openclaw:${parts[1]}`);
      }
    }

    // 移动端选中会话后自动关闭侧边栏
    if (isMobile) {
      setShowSider(false);
    }
  };

  const handleUpdateLabel = async () => {
    if (!sessionKey || !editingLabelText.trim()) {
      setIsEditingLabel(false);
      return;
    }

    setIsUpdatingLabel(true);
    try {
      const res = await sendRPC('sessions.patch', { 
        key: sessionKey, 
        label: editingLabelText.trim() 
      });
      if (res.ok) {
        message.success(t('common.success'));
        setSessionLabel(editingLabelText.trim());
        setIsEditingLabel(false);
        fetchSessions(); // 刷新列表以同步新 Label
      } else {
        message.error('Failed to update label: ' + (res.error?.message || 'Unknown error'));
      }
    } catch (err) {
      console.error('Update label error:', err);
    } finally {
      setIsUpdatingLabel(false);
    }
  };

  const handleAutoSummarize = async () => {
    if (!sessionKey || messages.length === 0) return;
    
    setIsSummarizing(true);
    try {
      // 提取当前选中机器人的模型 ID
      const agentId = selectedBot.replace('openclaw:', '');
      const bot = botsModels?.data?.bots?.find((b: any) => b.id === agentId);
      const currentModelID = bot?.model || '';

      // 过滤掉“正在思考”等临时消息，并只取 role/content 字段
      const validMessages = messages
        .filter(m => m.content !== t('chat.thinking'))
        .map(m => ({ role: m.role, content: m.content }));
        
      const newTitle = await summarizeSession(validMessages, currentModelID);
      if (newTitle) {
        // 自动保存到后端
        const res = await sendRPC('sessions.patch', { key: sessionKey, label: newTitle });
        if (res.ok) {
          setSessionLabel(newTitle);
          message.success(t('chat.titleSummarized', { defaultValue: '标题已自动总结' }));
          fetchSessions();
        }
      }
    } catch (err) {
      console.error('Summarize error:', err);
      message.error(t('chat.summarizeFailed', { defaultValue: '总结标题失败' }));
    } finally {
      setIsSummarizing(false);
    }
  };

  const handleModelChange = async (newModel: string) => {
    setSessionModel(newModel);
    if (!sessionKey) return;

    try {
      const res = await sendRPC('sessions.patch', { 
        key: sessionKey, 
        model: newModel || null 
      });
      if (res.ok) {
        message.success(t('chat.modelSwitchSuccess', { defaultValue: '模型切换成功' }));
        fetchSessions(); // 刷新列表以同步新状态
      } else {
        message.error('Failed to switch model: ' + (res.error?.message || 'Unknown error'));
      }
    } catch (err) {
      console.error('Switch model error:', err);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success(t('chat.copySuccess', { defaultValue: '复制成功' }));
    });
  };

  const handleRegenerate = () => {
    // 找到最后一条用户消息
    const lastUserIndex = [...messages].reverse().findIndex(m => m.role === 'user');
    if (lastUserIndex !== -1) {
      const actualIndex = messages.length - 1 - lastUserIndex;
      const lastUserMsg = messages[actualIndex];
      // 移除该用户消息之后的所有 AI 消息
      setMessages(prev => prev.slice(0, actualIndex + 1));
      // 重新触发发送
      handleSend(lastUserMsg.content);
    }
  };

  const handleStopGeneration = () => {
    setIsTyping(false);
    clearStallTimer();
    streamContentRef.current = '';
    
    // 更新最后一条助手消息的状态
    setMessages(prev => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      if (last.role === 'assistant') {
        const stopLabel = t('chat.manuallyStopped', { defaultValue: '用户已手动停止' });
        // 情况 1: 还在思考中，直接替换
        if (last.content === t('chat.thinking') || last.content === '') {
          return [...prev.slice(0, -1), { ...last, content: stopLabel }];
        }
        // 情况 2: 已有内容输出，在末尾追加提示（带括号）
        const stopSuffix = ` (${stopLabel})`;
        if (!last.content.endsWith(stopSuffix)) {
          return [...prev.slice(0, -1), { ...last, content: last.content + stopSuffix }];
        }
      }
      return prev;
    });

    // 发送 /stop 指令到后端，相当于用户输入了 /stop
    handleSend('/stop');
    message.info(t('chat.stopGenerating', { defaultValue: '已发送停止指令' }));
  };

  const handleDeleteSession = (e: React.MouseEvent, key: string) => {
    e.stopPropagation();
    Modal.confirm({
      title: t('chat.deleteSessionConfirm', { defaultValue: '确认删除会话？' }),
      content: t('chat.deleteSessionContent', { defaultValue: '删除后无法找回，所有上下文都将被清理。' }),
      onOk: async () => {
        const res = await sendRPC('sessions.delete', { key });
        if (res.ok) {
          message.success(t('common.success'));
          if (sessionKey === key) {
            setSessionKey(null);
            setMessages([]);
          }
          fetchSessions();
        }
      }
    });
  };

  const handleClearAllHistory = () => {
    if (sessions.length === 0) {
      message.info(t('chat.noHistory', { defaultValue: '暂无历史会话' }));
      return;
    }
    
    Modal.confirm({
      title: t('chat.clearAllHistoryConfirm', { defaultValue: '确认清除全部会话？' }),
      content: t('chat.clearAllHistoryContent', { defaultValue: '此操作将物理删除所有历史记录，且无法恢复。' }),
      okText: t('common.confirm', { defaultValue: '确认清除' }),
      cancelText: t('common.cancel', { defaultValue: '取消' }),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          message.loading({ content: t('chat.clearingAll', { defaultValue: '正在清除...' }), key: 'clearingAll' });
          // 并发删除所有会话
          await Promise.all(sessions.map(s => sendRPC('sessions.delete', { key: s.key })));
          message.success({ content: t('chat.clearAllSuccess', { defaultValue: '已清除全部历史记录' }), key: 'clearingAll' });
          setSessionKey(null);
          setMessages([]);
          setSessions([]);
          fetchSessions();
        } catch (err) {
          message.error({ content: t('common.error'), key: 'clearingAll' });
        }
      }
    });
  };

  const startNewSession = () => {
    setSessionKey(null);
    setMessages([]);
  };

  const streamContentRef = useRef('');
  const lastUpdateRef = useRef(0);
  const scrollTimerRef = useRef<number | null>(null);

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    setIsStalled(false);
  }, []);

  const resetStallTimer = useCallback(() => {
    clearStallTimer();
    // 3.5 秒无数据则认为进入长考状态
    stallTimerRef.current = setTimeout(() => {
      setIsStalled(true);
    }, 3500);
  }, [clearStallTimer]);

  const handleChatDelta = (payload: any) => {
    if (payload.state === 'delta') {
      resetStallTimer();
      const now = Date.now();
      
      // 如果用户当前没有滚动到底部，显示“有新消息”提醒
      if (showScrollBtn) {
        setHasNewMessages(true);
      }

      if (!ttftRecordedRef.current) {
        ttftRecordedRef.current = true;
        firstTokenTimeRef.current = now;
      }

      // 深度提取内容
      const blocks = payload.message?.content || [];
      const fullText = blocks.map((c: any) => {
          const textPart = c.text || '';
          const thinkingPart = c.thinking ? `> :::thinking\n> ${c.thinking.replace(/\n/g, '\n> ')}\n> :::\n\n` : '';
          return thinkingPart + textPart;
      }).join('');

      streamContentRef.current = fullText;
      tokenCountRef.current = fullText.length;

      // 核心优化：节流合并更新 UI
      if (now - lastUpdateRef.current > 64) {
        lastUpdateRef.current = now;
        
        const elapsedFromFirst = (now - firstTokenTimeRef.current) / 1000;
        const currentTPS = elapsedFromFirst > 0 ? (tokenCountRef.current / elapsedFromFirst) : 0;
        const ttft = firstTokenTimeRef.current - startTimeRef.current;

        if (tokenCountRef.current % 5 === 0) {
          setTpsData(prev => [...prev.slice(-19), currentTPS]);
        }

        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant') {
            return [...prev.slice(0, -1), { 
              ...last, 
              content: fullText,
              metrics: { ttft, tps: currentTPS }
            }];
          }
          return prev;
        });

        // 智能滚动优化
        if (scrollRef.current) {
          const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
          const isNearBottom = scrollHeight - scrollTop - clientHeight < 150;
          if (isNearBottom) {
            if (scrollTimerRef.current) cancelAnimationFrame(scrollTimerRef.current);
            scrollTimerRef.current = requestAnimationFrame(() => {
              if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            });
          }
        }
      }
    } else if (payload.state === 'final' || payload.state === 'finished') {
        clearStallTimer();
        const now = Date.now();
        const duration = (now - startTimeRef.current) / 1000;
        const ttft = ttftRecordedRef.current ? (firstTokenTimeRef.current - startTimeRef.current) : 0;
        const finalTPS = duration > 0 ? (tokenCountRef.current / (duration - (ttft/1000))) : 0;

        console.log('✅ [V3] Stream completed, state:', payload.state);
        
        setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              return [...prev.slice(0, -1), { 
                ...last, 
                metrics: {
                    ttft,
                    duration,
                    tps: finalTPS
                }
              }];
            }
            return prev;
        });

        setIsTyping(false);
        streamContentRef.current = '';
        // 刷新会话列表（新会话可能会出现在列表中）
        fetchSessions();
    }
  };

  const sendRPC = (method: string, params: any): Promise<any> => {
    return new Promise((resolve) => {
      const id = `${method}-${requestIdRef.current++}`;
      const req = { type: 'req', id, method, params };
      pendingRequests.current.set(id, resolve);
      wsRef.current?.send(JSON.stringify(req));
    });
  };

  const handleSaveEdit = async () => {
    if (editingMsgIndex === null) return;
    const newText = editContent.trim();
    if (!newText) {
      setEditingMsgIndex(null);
      return;
    }
    
    // 截断数组：保留该条消息之前的所有消息
    setMessages(prev => prev.slice(0, editingMsgIndex));
    setEditingMsgIndex(null);
    setEditContent('');
    
    // 重新发送
    handleSend(newText);
  };

  const handleSend = async (content?: any) => {
    // 优先使用直接传入的内容
    const text = (typeof content === 'string' ? content : inputText).trim();
    
    if (!text || (!sessionKey && !selectedBot) || status !== 'authenticated') return;

    setIsTyping(true);
    setTpsData([]);
    streamContentRef.current = '';
    
    // Reset performance counters
    startTimeRef.current = Date.now();
    ttftRecordedRef.current = false;
    tokenCountRef.current = 0;
    firstTokenTimeRef.current = 0;

    const newUserMsg: Message = { role: 'user', content: text, timestamp: new Date().toLocaleTimeString() };
    // /stop 指令作为控制指令，不显示在聊天历史中
    if (text !== '/stop') {
      setMessages(prev => [...prev, newUserMsg]);
    }

    // Ensure session exists
    let currentKey = sessionKey;
    if (!currentKey) {
      const res = await sendRPC('sessions.create', { agentId: selectedBot.replace('openclaw:', '') });
      if (res.ok) {
        currentKey = res.payload.key;
        setSessionKey(currentKey);
        // Apply initial patch (using current thinkingLevel and sessionModel if selected)
        await sendRPC('sessions.patch', { key: currentKey, thinkingLevel, model: sessionModel });
      }
    }

    if (currentKey) {
      // 只有非控制指令才显示“思考中”占位
      if (text !== '/stop') {
        setMessages(prev => [...prev, { role: 'assistant', content: t('chat.thinking'), timestamp: new Date().toLocaleTimeString() }]);
        resetStallTimer();
      }
      
      const res = await sendRPC('chat.send', { 
        sessionKey: currentKey, 
        message: text,
        idempotencyKey: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
      });
      if (!res.ok) {
        const errMsg = typeof res.error === 'object' ? JSON.stringify(res.error) : (res.error || 'Unknown error');
        message.error('Failed to send message: ' + errMsg);
        setIsTyping(false);
        clearStallTimer();
      } else if (text === '/stop') {
        // /stop 指令成功返回后，立即释放状态，因为它不会产生流式响应
        setIsTyping(false);
        clearStallTimer();
      }
    }
  };

  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectCountRef = useRef(0);
  const MAX_RECONNECTS = 5;

  useEffect(() => {
    if (status === 'disconnected' && keyPair) {
      // 防止无限快速重连
      if (reconnectCountRef.current >= MAX_RECONNECTS) {
        console.warn('⚠️ [V3] 已达到最大重连次数，停止重连');
        setStatus('error');
        return;
      }
      // 首次连接立刻尝试，重连则按阶梯延迟
      const delay = reconnectCountRef.current === 0 ? 0 : Math.min(3000 * reconnectCountRef.current, 15000);
      
      if (delay > 0) {
        console.log(`🔄 [V3] 将在 ${delay / 1000}s 后重连 (${reconnectCountRef.current}/${MAX_RECONNECTS})`);
      }
      
      reconnectTimerRef.current = setTimeout(() => {
        reconnectCountRef.current++;
        connect();
      }, delay);
      
      return () => {
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      };
    }
    // 连接成功后重置计数
    if (status === 'authenticated') {
      reconnectCountRef.current = 0;
    }
  }, [status, keyPair, connect]);

  // 组件卸载清理：彻底切断连接
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        console.log('🧹 [V3] OnlineChat unmounted: closing WebSocket');
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <>
      <style>{`
        @keyframes v3-blob-animate {
          0% { transform: translate(0, 0) scale(1); }
          33% { transform: translate(30px, -50px) scale(1.1); }
          66% { transform: translate(-20px, 20px) scale(0.9); }
          100% { transform: translate(0, 0) scale(1); }
        }
        @keyframes v3-message-enter {
          from { opacity: 0; transform: translateY(12px) scale(0.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        .v3-blob {
          position: absolute; width: 500px; height: 500px; border-radius: 50%; filter: blur(80px); opacity: 0.12; animation: v3-blob-animate 20s infinite alternate;
        }
      `}</style>
      {!isRunning && <GatewayOfflineMask onNavigateToDashboard={onNavigateToDashboard} />}
      <div style={{ flex: 1, display: 'flex', background: '#f8fafc', overflowX: 'hidden', height: '100%', position: 'relative', width: '100%' }}>
        {/* 动态背景光斑 */}
        <div style={{ position: 'absolute', width: '100%', height: '100%', overflow: 'hidden', zIndex: 0, pointerEvents: 'none' }}>
          <div className="v3-blob" style={{ background: '#6366f1', top: '-10%', left: '-10%', animationDelay: '0s' }} />
          <div className="v3-blob" style={{ background: '#ec4899', bottom: '10%', right: '-5%', animationDelay: '-5s', width: 600, height: 600 }} />
          <div className="v3-blob" style={{ background: '#3b82f6', top: '40%', left: '30%', animationDelay: '-10s', opacity: 0.08 }} />
        </div>
      {/* Session Sider */}
      {showSider && (
        <>
          {isMobile && (
            <div 
              style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200, animation: 'v3-fade-in 0.3s' }} 
              onClick={() => setShowSider(false)} 
            />
          )}
          <div style={{ 
            width: isMobile ? 280 : 260, 
            height: '100%', 
            borderRight: '1px solid #f1f5f9', 
            display: 'flex', 
            flexDirection: 'column',
            background: '#fff',
            position: isMobile ? 'fixed' : 'relative',
            top: 0, left: 0, bottom: 0,
            zIndex: 201,
            boxShadow: isMobile ? '4px 0 20px rgba(0,0,0,0.15)' : 'none',
            flexShrink: 0
          }}>
            <V3SessionList
              sessions={sessions}
              sessionKey={sessionKey}
              loadingSessions={loadingSessions}
              sessionSearch={sessionSearch}
              setSessionSearch={setSessionSearch}
              onSelectSession={handleSelectSession}
              onNewSession={startNewSession}
              onDeleteSession={handleDeleteSession}
              onClearAll={handleClearAllHistory}
              fetchSessions={fetchSessions}
              isMobile={!!isMobile}
              setShowSider={setShowSider}
              copyToClipboard={copyToClipboard}
              t={t}
            />
          </div>
        </>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fafafa', position: 'relative', width: '100%', minWidth: 0, overflow: 'hidden' }}>
        <style>{`
            .session-item:hover { background: #f0f7ff; border-color: #dbeafe !important; }
            .session-item:hover .session-actions { opacity: 1 !important; }
            
            .typing-indicator { display: flex; align-items: center; gap: 4px; height: 12px; }
            .typing-dot { width: 5px; height: 5px; background: #2563eb; border-radius: 50%; opacity: 0.4; animation: typing-bounce 1.4s infinite ease-in-out; }
            .typing-dot:nth-child(1) { animation-delay: 0s; }
            .typing-dot:nth-child(2) { animation-delay: 0.2s; }
            .typing-dot:nth-child(3) { animation-delay: 0.4s; }
            @keyframes typing-bounce {
              0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
              40% { transform: translateY(-4px); opacity: 1; }
            }
            .message-in { animation: message-in 0.3s ease; }
            @keyframes message-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
            
            @keyframes v3-heartbeat {
              0% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); opacity: 1; }
              70% { box-shadow: 0 0 0 8px rgba(16, 185, 129, 0); opacity: 0.8; }
              100% { box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); opacity: 1; }
            }

            .input-container-v3:focus-within {
                border-color: #2563eb !important;
                box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.1), 0 8px 10px -6px rgba(37, 99, 235, 0.1) !important;
            }
            .msg-footer { opacity: 1; transition: opacity 0.2s; }
            .message-in:hover .msg-footer { opacity: 1; }

            @keyframes v3-cursor-blink {
              0%, 100% { opacity: 1; }
              50% { opacity: 0; }
            }
            .v3-mock-cursor {
              display: inline-block;
              width: 2px;
              height: 1.2em;
              background: #2563eb;
              margin-left: 2px;
              vertical-align: middle;
              animation: v3-cursor-blink 1s step-end infinite;
            }

            /* 思维链块样式 */
            .v3-thought-container {
              background: #f8fafc;
              border-left: 3px solid #cbd5e1;
              padding: 10px 14px;
              margin: 8px 0;
              border-radius: 0 8px 8px 0;
              font-size: 13px;
              color: #64748b;
              font-style: italic;
              max-width: 100%;
              overflow-x: auto;
            }
            .v3-thought-header {
              display: flex;
              align-items: center;
              gap: 6px;
              font-weight: 700;
              font-style: normal;
              margin-bottom: 4px;
              color: #94a3b8;
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 0.5px;
            }

            /* 工具调用块样式 */
            .v3-tool-call-container {
              background: #1e293b;
              border-radius: 8px;
              padding: 10px;
              margin: 10px 0;
              color: #e2e8f0;
              font-family: 'JetBrains Mono', monospace;
              border: 1px solid #334155;
              max-width: 100%;
              overflow-x: auto;
            }
            .v3-tool-header {
              display: flex;
              align-items: center;
              gap: 8px;
              font-size: 11px;
              color: #94a3b8;
              margin-bottom: 6px;
              border-bottom: 1px solid #334155;
              padding-bottom: 4px;
            }

            /* 工具结果块样式 */
            .v3-tool-result-container {
              background: #f0fdf4;
              border: 1px solid #dcfce7;
              border-radius: 8px;
              padding: 10px;
              margin: 10px 0;
              font-size: 12px;
              max-width: 100%;
              overflow-x: auto;
            }
            .v3-tool-result-header {
              display: flex;
              align-items: center;
              gap: 6px;
              color: #16a34a;
              font-weight: 700;
              margin-bottom: 6px;
              font-size: 11px;
            }

            /* 隐藏特殊的容器标记文本 */
            .v3-thought-container p:first-child,
            .v3-tool-call-container p:first-child,
            .v3-tool-result-container p:first-child {
               display: none;
            }
            .v3-thought-container blockquote,
            .v3-tool-call-container blockquote,
            .v3-tool-result-container blockquote {
               border: none !important;
               padding: 0 !important;
               margin: 0 !important;
               font-style: normal !important;
               color: inherit !important;
            }
        `}</style>
        
        <div style={{ padding: isMobile ? '6px 10px' : '10px 16px', background: '#fff', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, gap: 8, width: '100%', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 10, minWidth: 0, flex: 1 }}>
            <Button 
                type="text" 
                icon={<LayoutPanelLeft size={18} />} 
                onClick={() => setShowSider(!showSider)} 
                style={{ marginLeft: -6, color: showSider ? '#4f46e5' : '#64748b', flexShrink: 0 }}
            />
            {status !== 'authenticated' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <Badge status={status === 'error' ? 'error' : 'processing'} />
                <span style={{ fontSize: 11, color: status === 'error' ? '#ef4444' : '#94a3b8', fontWeight: 500 }}>
                    {status === 'error' ? '网关连接失败' : '网关连接中...'}
                </span>
              </div>
            )}
            
            {status === 'authenticated' && sessionKey ? (
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <Tooltip title={t('chat.clickToCopy', { defaultValue: '点击复制会话 ID' })}>
                  <span 
                    style={{ 
                      fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', cursor: 'pointer',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      maxWidth: isMobile ? 120 : 'none',
                      lineHeight: '12px'
                    }}
                    className="v3-session-id-header"
                    onClick={() => copyToClipboard(sessionKey)}
                  >
                    {sessionKey}
                  </span>
                </Tooltip>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                  {isEditingLabel ? (
                    <Input
                      size="small"
                      autoFocus
                      value={editingLabelText}
                      onChange={e => setEditingLabelText(e.target.value)}
                      onBlur={handleUpdateLabel}
                      onPressEnter={handleUpdateLabel}
                      disabled={isUpdatingLabel}
                      style={{ height: 20, fontSize: 12, width: isMobile ? 120 : 200 }}
                    />
                  ) : (
                    <>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: isMobile ? 150 : 300 }}>
                        {sessionLabel || t('chat.noLabel', { defaultValue: '未命名会话' })}
                      </span>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                        <Tooltip title={t('chat.autoSummarize', { defaultValue: 'AI 自动总结标题' })}>
                          <Button 
                            size="small" 
                            type="text" 
                            icon={isSummarizing ? <RefreshCw size={10} className="animate-spin" /> : <Wand2 size={10} />} 
                            onClick={handleAutoSummarize}
                            disabled={isSummarizing || messages.length === 0}
                            style={{ padding: 0, height: 16, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}
                          />
                        </Tooltip>
                        <Button 
                          size="small" 
                          type="text" 
                          icon={isUpdatingLabel ? <RefreshCw size={10} className="animate-spin" /> : <Save size={10} />} 
                          onClick={() => {
                            setEditingLabelText(sessionLabel || '');
                            setIsEditingLabel(true);
                          }}
                          style={{ padding: 0, height: 16, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}
                        />
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : (
              !isMobile && status === 'authenticated' && (
                <Tag color="blue" icon={<ShieldCheck size={11} />} style={{ borderRadius: 6, border: 'none', background: '#eff6ff', color: '#4f46e5', padding: '0 6px', fontSize: 11, flexShrink: 0, margin: 0 }}>
                  {t('chat.deviceVerified')}
                </Tag>
              )
            )}
            
            {status === 'authenticated' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 8, flexShrink: 0, marginLeft: 4 }}>
                <div style={{ height: 12, width: 1, background: '#f1f5f9', marginRight: 2 }}></div>
                <span style={{ fontSize: 11, color: lastHealth?.ok === false ? '#f59e0b' : '#10b981', fontWeight: 600, marginRight: 2 }}>
                    {lastHealth?.ok === false ? '网关波动' : '网关已连接'}
                </span>
                <div key={pulse} style={{ 
                  width: 7, height: 7, borderRadius: '50%', 
                  background: lastHealth?.ok === false ? '#f59e0b' : (lastHealth?.ok ? '#10b981' : '#94a3b8'),
                  animation: lastHealth?.ok ? 'v3-heartbeat 0.8s ease-out' : 'none',
                  flexShrink: 0
                }} />
                {!isMobile && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', width: 35 }}>
                      {lastHealth ? `${lastHealth.latency}ms` : '---'}
                    </span>
                    {/* 微型延迟趋势图 */}
                    <svg width="30" height="12" style={{ opacity: 0.6 }}>
                      <polyline
                        fill="none" stroke="#10b981" strokeWidth="1"
                        points={latencyHistory.map((l, i) => `${(i / 29) * 30},${12 - (Math.min(l, 200) / 200) * 12}`).join(' ')}
                      />
                    </svg>
                  </div>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 2 : 6, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: 4 }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{t('chat.showThinking', { defaultValue: '显示思考' })}</span>
                  <Switch 
                      size="small" 
                      checked={showThinking} 
                      onChange={(val) => {
                          setShowThinking(val);
                          storage.setItem('v3_show_thinking', val ? 'true' : 'false');
                      }} 
                  />
              </div>
              {!isMobile && (
                <>
                  <div style={{ width: 1, height: 12, background: '#f1f5f9', marginRight: 2 }}></div>
                  <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>{t('chat.thinkingLevel', { defaultValue: '思考等级' })}:</span>
                  <Select size="small" value={thinkingLevel} onChange={setThinkingLevel} style={{ width: 100 }} dropdownStyle={{ borderRadius: 8 }}>
                      <Select.Option value="low">Low</Select.Option>
                      <Select.Option value="medium">Medium</Select.Option>
                      <Select.Option value="high">High</Select.Option>
                      <Select.Option value="pro">Pro</Select.Option>
                  </Select>
                </>
              )}
              <Button size="small" type="text" icon={<RefreshCw size={13} />} onClick={connect} title={t('common.restart')} />
          </div>
        </div>
  
        <div ref={scrollRef} onScroll={handleScroll} style={{ 
            flex: 1, 
            overflowY: 'auto', 
            overflowX: 'hidden',
            padding: isMobile ? '12px' : '24px', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: 20,
            justifyContent: messages.length === 0 ? 'center' : 'flex-start',
            width: '100%',
            boxSizing: 'border-box',
            position: 'relative'
        }}>
          {messages.length === 0 && (
            <div style={{ margin: '0 auto', textAlign: 'center', maxWidth: isMobile ? '100%' : 400, padding: isMobile ? '20px 0' : '40px', width: '100%', boxSizing: 'border-box' }}>
              <div style={{ background: '#eff6ff', width: isMobile ? 64 : 80, height: isMobile ? 64 : 80, borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', color: '#2563eb' }}>
                <Cpu size={isMobile ? 32 : 40} />
              </div>
              <h3 style={{ fontSize: isMobile ? 18 : 20, fontWeight: 800, color: '#1e293b', marginBottom: 12 }}>{t('chat.v3Ready')}</h3>
              <p style={{ color: '#64748b', lineHeight: 1.6, fontSize: isMobile ? 13 : 14, padding: isMobile ? '0 10px' : 0 }}>{t('chat.v3ReadyDesc')}</p>
              
              {sessions.length > 0 && (
                <div style={{ marginTop: 24, animation: 'v3-fade-in 0.8s ease-out' }}>
                  <Button 
                    type="primary" 
                    icon={<History size={18} />} 
                    onClick={() => setShowSider(true)}
                    style={{ 
                      height: 44, borderRadius: 12, background: '#4f46e5', border: 'none', 
                      padding: '0 24px', fontWeight: 600, boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)' 
                    }}
                  >
                    {t('chat.continueFromHistory', { defaultValue: '从历史会话中继续' })}
                  </Button>
                </div>
              )}

              <div style={{ marginTop: 24, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                <Tag style={{ borderRadius: 10, padding: isMobile ? '2px 8px' : '4px 12px', fontSize: isMobile ? 11 : 12, margin: 0 }}>{t('chat.v3LowLatency', { defaultValue: '⚡ 低延迟' })}</Tag>
                <Tag style={{ borderRadius: 10, padding: isMobile ? '2px 8px' : '4px 12px', fontSize: isMobile ? 11 : 12, margin: 0 }}>{t('chat.v3Secure', { defaultValue: '🔒 Ed25519' })}</Tag>
                <Tag style={{ borderRadius: 10, padding: isMobile ? '2px 8px' : '4px 12px', fontSize: isMobile ? 11 : 12, margin: 0 }}>{t('chat.v3CloudSync', { defaultValue: '🌐 云同步' })}</Tag>
              </div>
            </div>
          )}
          
          {hasMoreHistory && messages.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20, marginTop: 10 }}>
                <Button 
                    size="small" 
                    type="text" 
                    loading={loadingMore} 
                    onClick={loadMoreHistory}
                    icon={<Clock size={14} />}
                    style={{ fontSize: 12, color: '#94a3b8', background: '#f8fafc', borderRadius: 20, padding: '0 16px', height: 28 }}
                >
                    {loadingMore ? '正在拉取历史...' : '查看更早的消息'}
                </Button>
            </div>
          )}

          {messages.map((msg, index) => (
            <V3MessageItem
              key={index}
              msg={msg}
              index={index}
              isMobile={!!isMobile}
              showThinking={showThinking}
              selectedBot={selectedBot}
              editingMsgIndex={editingMsgIndex}
              editContent={editContent}
              setEditContent={setEditContent}
              onEdit={(idx, content) => {
                setEditingMsgIndex(idx);
                setEditContent(content);
              }}
              onSaveEdit={handleSaveEdit}
              onCancelEdit={() => setEditingMsgIndex(null)}
              onDelete={(idx) => setMessages(prev => prev.filter((_, i) => i !== idx))}
              onQuote={setQuotedMsg}
              onRegenerate={handleRegenerate}
              copyToClipboard={copyToClipboard}
              isTyping={isTyping}
              isLast={index === messages.length - 1}
              isStalled={isStalled}
              tpsData={tpsData}
              t={t}
            />
          ))}
        </div>

        {/* 返回顶部浮动按钮 */}
        {showScrollTopBtn && (
            <div style={{ position: 'absolute', top: 80, right: isMobile ? 16 : 32, zIndex: 100, animation: 'v3-fade-in 0.3s' }}>
                <Button
                    shape="round"
                    onClick={() => {
                        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    icon={<ChevronUp size={14} />}
                    style={{ 
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        background: '#fff',
                        color: '#64748b',
                        border: '1px solid #e2e8f0',
                        height: 32,
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '0 10px'
                    }}
                >
                    返回顶部
                </Button>
            </div>
        )}

        {/* 返回底部浮动按钮 */}
        {showScrollBtn && (
            <div style={{ 
                position: 'absolute', 
                bottom: isMobile ? (showQuickActions ? 170 : 130) : (showQuickActions ? 210 : 160), 
                left: '50%', 
                transform: 'translateX(-50%)', 
                zIndex: 100, 
                animation: 'v3-fade-in 0.3s' 
            }}>
                <Button
                    shape="round"
                    type={hasNewMessages ? 'primary' : 'default'}
                    onClick={() => {
                        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
                        setHasNewMessages(false);
                    }}
                    icon={hasNewMessages ? <Activity size={14} className="animate-pulse" /> : <ChevronDown size={14} />}
                    style={{ 
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        background: hasNewMessages ? '#2563eb' : '#fff',
                        color: hasNewMessages ? '#fff' : '#64748b',
                        border: hasNewMessages ? 'none' : '1px solid #e2e8f0',
                        height: 32,
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: hasNewMessages ? '0 12px' : '0 10px'
                    }}
                >
                    {hasNewMessages && '有新消息'}
                </Button>
            </div>
        )}

        {status !== 'authenticated' && (
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            background: '#f8fafc', // 洁净的浅色背景
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
            <style>{`
              @keyframes v3-pulse-ring {
                0% { transform: scale(0.8); opacity: 0.5; box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.3); }
                70% { transform: scale(1.2); opacity: 0; box-shadow: 0 0 0 20px rgba(37, 99, 235, 0); }
                100% { transform: scale(0.8); opacity: 0; box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
              }
              @keyframes v3-fade-in { from { opacity: 0; } to { opacity: 1; } }
              @keyframes v3-scan-line { 
                0% { transform: translateY(-100%); opacity: 0; } 
                50% { opacity: 0.8; }
                100% { transform: translateY(400%); opacity: 0; } 
              }
              @keyframes v3-grid-move {
                0% { background-position: 0 0; }
                100% { background-position: 40px 40px; }
              }
              @keyframes v3-glow-light {
                0%, 100% { box-shadow: 0 10px 30px rgba(37, 99, 235, 0.05); }
                50% { box-shadow: 0 15px 45px rgba(37, 99, 235, 0.15); }
              }
              
              .v3-auth-container {
                position: relative;
                width: 100%;
                height: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                background-image: 
                  linear-gradient(rgba(37, 99, 235, 0.03) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(37, 99, 235, 0.03) 1px, transparent 1px);
                background-size: 40px 40px;
                animation: v3-grid-move 6s linear infinite;
              }

              .v3-auth-card {
                position: relative;
                padding: ${isMobile ? '32px 24px' : '48px'};
                background: rgba(255, 255, 255, 0.7);
                backdrop-filter: blur(20px) saturate(180%);
                border-radius: ${isMobile ? '24px' : '32px'};
                border: 1px solid rgba(37, 99, 235, 0.15);
                text-align: center;
                max-width: ${isMobile ? '280px' : '380px'};
                width: 85%;
                box-sizing: border-box;
                animation: v3-glow-light 4s ease-in-out infinite;
                overflow: hidden;
              }

              .v3-scan-line-element {
                position: absolute;
                top: 0; left: 0; right: 0;
                height: 2px;
                background: linear-gradient(90deg, transparent, #2563eb, transparent);
                box-shadow: 0 0 10px rgba(37, 99, 235, 0.5);
                z-index: 1;
                animation: v3-scan-line 3.5s linear infinite;
              }

              .v3-icon-box {
                width: ${isMobile ? '64px' : '80px'}; 
                height: ${isMobile ? '64px' : '80px'};
                border-radius: ${isMobile ? '20px' : '24px'};
                margin: 0 auto 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
                background: rgba(37, 99, 235, 0.05);
                border: 1px solid rgba(37, 99, 235, 0.1);
              }

              .v3-tech-label {
                font-family: 'JetBrains Mono', 'Fira Code', monospace;
                font-size: 10px;
                color: #2563eb;
                text-transform: uppercase;
                letter-spacing: 2px;
                opacity: 0.5;
                margin-bottom: 8px;
              }
            `}</style>
            
            <div className="v3-auth-container">
              <div className="v3-auth-card">
                <div className="v3-scan-line-element" />
                
                <div className="v3-tech-label">System Protocol Hook</div>
                
                <div className="v3-icon-box">
                  {status !== 'error' && (
                    <div style={{
                      position: 'absolute',
                      top: -4, left: -4, right: -4, bottom: -4,
                      borderRadius: 'inherit',
                      border: '2px solid #2563eb',
                      animation: 'v3-pulse-ring 2s cubic-bezier(0.24, 0, 0.38, 1) infinite'
                    }} />
                  )}
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
                    onClick={connect} 
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
            </div>
            
            <div style={{ position: 'absolute', bottom: 24, fontSize: 10, color: 'rgba(37, 99, 235, 0.2)', fontWeight: 600, letterSpacing: '4px', fontFamily: 'monospace' }}>
              OPENCLAW_SECURE_TUNNEL_V3.0
            </div>
          </div>
        )}

        <div style={{ padding: isMobile ? '8px 12px' : '0 24px 20px', background: '#fafafa', borderTop: '1px solid #f1f5f9', width: '100%', boxSizing: 'border-box' }}>

           <div style={{ display: 'flex', gap: 8, marginBottom: showQuickActions ? 12 : 8, alignItems: 'center', transition: 'all 0.3s ease', paddingTop: 12, width: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>
             {showQuickActions ? (
               <>
                 <div style={{ display: 'flex', gap: 8, overflowX: 'auto', flex: 1, paddingBottom: 6, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', whiteSpace: 'nowrap', minWidth: 0 } as React.CSSProperties}>
                   {quickCommands.map((item: any) => (
                     <Button
                       key={item.id}
                       size="small"
                       style={{ borderRadius: 16, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, background: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0', flexShrink: 0 }}
                       onClick={() => handleSend(item.prompt)}
                       disabled={status !== 'authenticated' || isTyping}
                     >
                       {item.label}
                     </Button>
                   ))}
                 </div>
                 <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                   <Button
                     type="text" size="small" icon={<Settings size={14} />}
                     style={{ color: '#94a3b8', background: '#f1f5f9', borderRadius: 12, height: 24, width: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                     onClick={() => setIsManageModalOpen(true)}
                   />
                   <Button
                     type="text" size="small" icon={<ChevronUp size={16} />}
                     style={{ color: '#94a3b8', background: '#f1f5f9', borderRadius: 12, height: 24, width: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                     onClick={() => { setShowQuickActions(false); storage.setItem('v3_show_quick_actions', 'false'); }}
                   />
                 </div>
               </>
             ) : (
               <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                 <div style={{ height: 1, flex: 1, background: '#f1f5f9' }}></div>
                 <Button
                   type="text" size="small" icon={<ChevronDown size={14} style={{ marginRight: 4 }} />}
                   onClick={() => { setShowQuickActions(true); storage.setItem('v3_show_quick_actions', 'true'); }}
                   style={{ fontSize: 11, color: '#94a3b8', height: 20, padding: '0 8px', borderRadius: 10, background: '#f8fafc', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                 >
                   {t('chat.expandQuickCommands', { defaultValue: '快捷指令' })}
                 </Button>
                 <div style={{ height: 1, flex: 1, background: '#f1f5f9' }}></div>
               </div>
             )}
           </div>

            <div style={{ 
              display: 'flex', 
              background: '#fff', 
              borderRadius: 20, 
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 0 0 2px rgba(99, 102, 241, 0.1)', 
              border: '1.5px solid #6366f1', 
              flexDirection: 'column',
              overflow: 'hidden',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              width: '100%',
              boxSizing: 'border-box'
            }} className="input-container-v3">
              <div style={{ width: '100%', display: 'flex', alignItems: 'center', padding: isMobile ? '6px 12px 0' : '12px 16px 0', gap: 8, boxSizing: 'border-box' }}>
                 <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    background: '#f8fafc', 
                    borderRadius: 10, 
                    border: '1px solid #e2e8f0',
                    padding: '2px 4px',
                    height: 38,
                    flex: isMobile ? 1 : '0 0 auto',
                    width: isMobile ? 'auto' : 420,
                    minWidth: 0,
                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.01)'
                 }}>
                   <Select
                       placeholder={t('chat.selectBotTip')}
                       style={{ width: isMobile ? '45%' : 220, fontSize: isMobile ? 11 : 13 }}
                       value={selectedBot}
                       onChange={setSelectedBot}
                       loading={loadingBots}
                       disabled={isTyping}
                       variant="borderless"
                       dropdownStyle={{ borderRadius: 10, minWidth: 240 }}
                       dropdownMatchSelectWidth={false}
                       listHeight={400}
                   >
                       {botsModels?.data?.bots?.map((bot: any) => (
                           <Select.Option key={bot.id} value={`openclaw:${bot.id}`}>
                               <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                                   <div style={{ flexShrink: 0 }}>
                                       <BotAvatar provider={bot.provider || (bot.id === 'main' ? 'openai' : '')} size={20} />
                                   </div>
                                   <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2', minWidth: 0 }}>
                                       <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                           {bot.name || bot.id}
                                       </span>
                                       <span style={{ fontSize: 9, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                           {bot.model || '---'} {t('chat.defaultSuffix', { defaultValue: '(默认)' })}
                                       </span>
                                   </div>
                               </div>
                           </Select.Option>
                       ))}
                   </Select>
                    <div style={{ width: 1, height: 16, background: "#bfdbfe", margin: "0 4px" }}></div>
                    <Select
                        placeholder={t("chat.sessionModelPlaceholder", { defaultValue: "自由切换会话模型" })}
                        style={{ flex: 1, fontSize: isMobile ? 11 : 13, minWidth: 0 }}
                        value={sessionModel}
                        onChange={handleModelChange}
                        loading={loadingBots}
                        disabled={isTyping}
                        variant="borderless"
                        dropdownStyle={{ borderRadius: 10, minWidth: 200 }}
                        dropdownMatchSelectWidth={false}
                    >
                        <Select.Option value="">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8' }}>
                                <RefreshCw size={14} />
                                <span style={{ fontSize: 13 }}>{t('chat.defaultModel', { defaultValue: '使用默认模型' })}</span>
                            </div>
                        </Select.Option>
                        {(() => {
                            const groups = (botsModels?.data?.models || []).reduce((acc: Record<string, any[]>, m: any) => {
                                // 核心修复：解析 id 中的 provider 部分 (e.g. "aliyun/qwen" -> "aliyun")
                                let p = 'Others';
                                if (m.id && m.id.includes('/')) {
                                    p = m.id.split('/')[0];
                                } else if (m.provider) {
                                    p = m.provider;
                                }
                                
                                if (!acc[p]) acc[p] = [];
                                acc[p].push(m);
                                return acc;
                            }, {});
                            
                            // 按照提供商名称排序，让列表更稳定
                            return Object.keys(groups).sort().map(provider => (
                                <Select.OptGroup label={provider.toUpperCase()} key={provider}>
                                    {groups[provider].map((m: any) => (
                                        <Select.Option key={m.id} value={m.id}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <Cpu size={14} style={{ color: '#6366f1' }} />
                                                <span style={{ fontSize: 13 }}>{m.name || m.id}</span>
                                            </div>
                                        </Select.Option>
                                    ))}
                                </Select.OptGroup>
                            ));
                        })()}
                    </Select>
                 </div>
                 
                 <Button 
                   type="text" 
                   size="small" 
                   icon={<Sparkles size={18} color="#eab308" />} 
                   onClick={handleOpenSoulEditor}
                   disabled={!selectedBot || status !== 'authenticated'}
                   style={{ 
                     display: 'flex', alignItems: 'center', justifyContent: 'center',
                     background: '#fffbeb', 
                     border: '1px solid #fef3c7',
                     borderRadius: 10, 
                     height: 38, 
                     width: 38, 
                     padding: 0,
                     boxShadow: '0 2px 4px rgba(234, 179, 8, 0.05)'
                   }}
                 />
               </div>
              
              {quotedMsg && (
                 <div style={{ padding: isMobile ? '6px 12px 0' : '8px 16px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, boxSizing: 'border-box', width: '100%', overflow: 'hidden' }}>
                   <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: '#64748b', background: '#f1f5f9', padding: '4px 8px', borderRadius: 6, minWidth: 0, flex: 1, overflow: 'hidden' }}>
                     <Quote size={12} style={{ flexShrink: 0, marginTop: 2 }} />
                     <span style={{ overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, wordBreak: 'break-all' } as React.CSSProperties}>{quotedMsg}</span>
                   </div>
                   <Button type="text" size="small" icon={<Plus size={14} style={{ transform: 'rotate(45deg)' }} />} onClick={() => setQuotedMsg(null)} style={{ flexShrink: 0 }} />
                 </div>
               )}

              <V3InputArea
                status={status}
                isMobile={!!isMobile}
                isTyping={isTyping}
                onSend={handleSend}
                onStop={handleStopGeneration}
                t={t}
                isComposing={isComposing}
                setIsComposing={setIsComposing}
                isFocused={isFocused}
                setIsFocused={setIsFocused}
              />
            </div>

          </div>
        </div>
      </div>

      {/* 管理快捷指令 Modal */}
      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Settings size={20} color="#2563eb" /><span>{t('chat.manageQuickCommands', { defaultValue: '管理快捷指令' })}</span></div>}
        open={isManageModalOpen}
        onCancel={() => setIsManageModalOpen(false)}
        footer={null}
        width={500}
      >
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>{t('chat.currentCommands', { defaultValue: '已添加' })}</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {quickCommands.map((cmd: any) => (
              <div key={cmd.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 14 }}>{cmd.label}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd.prompt}</div>
                </div>
                {!cmd.is_system && (
                  <Button type="text" danger icon={<Trash2 size={14} />} size="small" onClick={() => handleDeleteQuickCommand(cmd.id)} />
                )}
              </div>
            ))}
          </div>
        </div>
        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 24 }}>
          <h4 style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>{t('chat.addCommand', { defaultValue: '添加新指令' })}</h4>
          <Form form={form} layout="vertical" onFinish={handleAddQuickCommand}>
            <Form.Item name="label" label={t('chat.commandLabel', { defaultValue: '按钮名称' })} rules={[{ required: true }]}>
              <Input placeholder={t('chat.commandLabelPlaceholder', { defaultValue: '例如：写一首诗' })} style={{ borderRadius: 8 }} />
            </Form.Item>
            <Form.Item name="prompt" label={t('chat.commandPrompt', { defaultValue: '指令内容' })} rules={[{ required: true }]}>
              <Input.TextArea placeholder={t('chat.commandPromptPlaceholder', { defaultValue: '输入该按钮触发的内容...' })} autoSize={{ minRows: 2 }} style={{ borderRadius: 8 }} />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<Plus size={16} />} block style={{ borderRadius: 8, height: 40 }}>
              {t('chat.addCommandBtn', { defaultValue: '添加快捷指令' })}
            </Button>
          </Form>
        </div>
      </Modal>

      {/* 专家灵魂快捷编辑器 (Quick Soul Editor) */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ background: '#fffbeb', padding: 6, borderRadius: 10, border: '1px solid #fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Sparkles size={18} color="#d97706" />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>{t('bots.editSoul', { defaultValue: '编辑专家灵魂' })}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{selectedBot?.replace('openclaw:', '')}</div>
              </div>
            </div>
          </div>
        }
        placement="right"
        onClose={() => setIsSoulDrawerOpen(false)}
        open={isSoulDrawerOpen}
        width={isMobile ? '100%' : 600}
        extra={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button icon={<X size={16} />} onClick={() => setIsSoulDrawerOpen(false)} />
            <Button 
                type="primary" 
                icon={<Save size={16} />} 
                loading={isSoulSaving} 
                onClick={handleSaveSoulContent}
                style={{ background: '#2563eb', borderRadius: 8, height: 32 }}
            >
              {t('common.save', { defaultValue: '保存并应用' })}
            </Button>
          </div>
        }
        styles={{ 
          header: { borderBottom: '1px solid #f1f5f9', padding: '16px 24px' },
          body: { padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
        }}
        closable={false}
      >
        {isSoulLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: '#f8fafc' }}>
            <Spin size="large" />
            <div style={{ color: '#94a3b8', fontSize: 13, fontFamily: 'monospace' }}>RECOVERING_SOUL_FRAGMENTS...</div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: isMobile ? 'column' : 'row', height: '100%' }}>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: isMobile ? 'none' : '1px solid #f1f5f9' }}>
                    <div style={{ padding: '8px 16px', background: '#f8fafc', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Soul Source (Markdown)
                    </div>
                    <Input.TextArea
                        value={soulContent}
                        onChange={e => setSoulContent(e.target.value)}
                        placeholder="Enter expert's soul (Prompt)..."
                        style={{ 
                          flex: 1, 
                          border: 'none', 
                          borderRadius: 0, 
                          resize: 'none', 
                          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                          fontSize: 13,
                          padding: 20,
                          background: '#fff',
                          lineHeight: 1.6
                        }}
                    />
                </div>
                {!isMobile && (
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fafafa' }}>
                      <div style={{ padding: '8px 16px', background: '#f1f5f9', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
                          Live Preview
                      </div>
                      <div style={{ flex: 1, padding: 20, overflowY: 'auto', background: '#fafafa' }}>
                          <ReactMarkdown 
                            remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} 
                            rehypePlugins={[rehypeSanitize, rehypeKatex]}
                          >
                            {soulContent}
                          </ReactMarkdown>
                      </div>
                  </div>
                )}
            </div>
            <div style={{ padding: '12px 20px', background: '#fff', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fbbf24', animation: 'v3-heartbeat 1.5s infinite' }} />
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
                    修改后点击保存，网关将立即应用最新的专家人格设置。
                </div>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
};

export default ChatV3;
