import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Select, Input, Button, Avatar, Spin, message, Tag, Badge, Modal, Form, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';
import { Send, Bot, User, RefreshCw, ShieldCheck, Cpu, Plus, Trash2, History, LayoutPanelLeft, Zap, Activity, Settings, ChevronUp, ChevronDown, Key, Copy, Square, Quote } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import nacl from 'tweetnacl';
import storage from '../utils/storage';
import { Mermaid, CodeBlock } from '../components/ChatComponents';
import { getWsUrl } from '../utils/url';
import { getTicket } from '../api';


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

const ChatV3: React.FC<ChatV3Props> = ({ botsModels, loadingBots, isMobile }) => {
  const { t } = useTranslation();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState('');
  const [selectedBot, setSelectedBot] = useState<string>('');
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error'>('disconnected');
  const [isTyping, setIsTyping] = useState(false);
  const [sessionKey, setSessionKey] = useState<string | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<'low' | 'medium' | 'high' | 'pro'>('medium');
  
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');
  const [quickCommands, setQuickCommands] = useState<any[]>([]);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(() => storage.getItem('v3_show_quick_actions') !== 'false');
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const [form] = Form.useForm();
  const [showSider, setShowSider] = useState(false);
  const [quotedMsg, setQuotedMsg] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const requestIdRef = useRef(1);
  const pendingRequests = useRef<Map<string, (res: any) => void>>(new Map());

  // 响应式处理：进入 V3 模式时默认折叠侧边栏
  useEffect(() => {
    setShowSider(false);
  }, []);

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
      const hashBuffer = await crypto.subtle.digest('SHA-256', kp.publicKey.buffer as ArrayBuffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
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
      console.log('📥 [V3] Received:', data);

      // Handle Events
      if (data.type === 'event') {
        if (data.event === 'connect.challenge') {
          handleChallenge(data.payload.nonce);
        } else if (data.event === 'chat') {
          handleChatDelta(data.payload);
        } else if (data.event === 'sessions.changed') {
          fetchSessions();
        }
        return;
      }

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
    }
    setLoadingSessions(false);
  };

  const loadSessionHistory = async (key: string) => {
    const res = await sendRPC('chat.history', { sessionKey: key, limit: 50 });
    if (res.ok) {
        const messagesData = res.payload.messages || res.payload.items || [];
        const history = messagesData.reverse().map((item: any) => {
            // V3 历史内容通常为 Blocks 数组，需要提取 text
            let content = item.content;
            if (Array.isArray(content)) {
                content = content.map((c: any) => c.text || '').join('');
            }
            return {
                role: item.role,
                content: content || '',
                timestamp: new Date(item.createdAt || Date.now()).toLocaleTimeString()
            };
        });
        setMessages(history);
    }
  };

  const handleSelectSession = (key: string) => {
    setSessionKey(key);
    loadSessionHistory(key);
    
    // 从 sessionKey 中解析 botId (格式: agent:botId:deviceId:timestamp)
    if (key.startsWith('agent:')) {
      const parts = key.split(':');
      if (parts.length >= 2) {
        setSelectedBot(`openclaw:${parts[1]}`);
      }
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
    streamContentRef.current = '';
    message.info(t('chat.stopGenerating', { defaultValue: '已停止生成' }));
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

  const startNewSession = () => {
    setSessionKey(null);
    setMessages([]);
  };

  const streamContentRef = useRef('');

  const handleChatDelta = (payload: any) => {
    if (payload.state === 'delta') {
      const delta = payload.message?.content?.[0]?.text || '';
      streamContentRef.current += delta;
      const currentContent = streamContentRef.current;
      
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant') {
          return [...prev.slice(0, -1), { ...last, content: currentContent }];
        }
        return prev;
      });
    } else if (payload.state === 'final' || payload.state === 'finished') {
        console.log('✅ [V3] Stream completed, state:', payload.state);
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

  const handleSend = async (content?: any) => {
    // 兼容快捷指令直接发送和手动输入发送
    const text = (typeof content === 'string' ? content : inputText).trim();
    
    // 如果没有 sessionKey，则必须有 selectedBot 才能创建新会话
    if (!text || (!sessionKey && !selectedBot) || status !== 'authenticated') return;

    // 只有点击发送按钮（非快捷指令）时清空输入框
    if (typeof content !== 'string') {
        setInputText('');
    }
    setIsTyping(true);
    streamContentRef.current = '';

    const newUserMsg: Message = { role: 'user', content: text, timestamp: new Date().toLocaleTimeString() };
    setMessages(prev => [...prev, newUserMsg]);

    // Ensure session exists
    let currentKey = sessionKey;
    if (!currentKey) {
      const res = await sendRPC('sessions.create', { agentId: selectedBot.replace('openclaw:', '') });
      if (res.ok) {
        currentKey = res.payload.key;
        setSessionKey(currentKey);
        // Apply initial patch
        await sendRPC('sessions.patch', { sessionKey: currentKey, thinkingLevel });
      }
    }

    if (currentKey) {
      // Add thinking placeholder
      // 立即挂载“思考中”占位，统一提示文本
      setMessages(prev => [...prev, { role: 'assistant', content: t('chat.thinking'), timestamp: new Date().toLocaleTimeString() }]);
      
      const res = await sendRPC('chat.send', { 
        sessionKey: currentKey, 
        message: text,
        idempotencyKey: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
      });
      if (!res.ok) {
        const errMsg = typeof res.error === 'object' ? JSON.stringify(res.error) : (res.error || 'Unknown error');
        message.error('Failed to send message: ' + errMsg);
        setIsTyping(false);
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
      const delay = Math.min(3000 * (reconnectCountRef.current + 1), 15000);
      console.log(`🔄 [V3] 将在 ${delay / 1000}s 后重连 (${reconnectCountRef.current + 1}/${MAX_RECONNECTS})`);
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

  useEffect(() => {
    if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <>
      <div style={{ flex: 1, display: 'flex', background: '#fff', overflow: 'hidden', height: '100%' }}>
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
            boxShadow: isMobile ? '4px 0 20px rgba(0,0,0,0.15)' : 'none'
          }}>
            <div style={{ padding: '16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: 8 }}>
              <Button 
                  type="primary" 
                  icon={<Plus size={16} />} 
                  style={{ flex: 1, borderRadius: 8, height: 38, background: '#2563eb' }}
                  onClick={startNewSession}
              >
                {t('chat.v3NewSession', { defaultValue: '开启新会话' })}
              </Button>
              <Button icon={<RefreshCw size={14} />} onClick={fetchSessions} loading={loadingSessions} />
              {isMobile && <Button icon={<Plus size={14} rotate={45} />} onClick={() => setShowSider(false)} />}
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
              <div style={{ padding: '4px 8px 8px' }}>
                <Input
                  size="small"
                  prefix={<Copy size={12} style={{ color: '#94a3b8' }} />}
                  placeholder="搜索会话 ID..."
                  value={sessionSearch}
                  onChange={e => setSessionSearch(e.target.value)}
                  allowClear
                  style={{ borderRadius: 8, fontSize: 12 }}
                />
              </div>
              {loadingSessions && <div style={{ textAlign: 'center', padding: 20 }}><Spin size="small" /></div>}
              {!loadingSessions && sessions.length === 0 && (
                  <div style={{ padding: '40px 20px', textAlign: 'center', color: '#cbd5e1' }}>
                      <History size={32} style={{ margin: '0 auto 12px', opacity: 0.5 }} />
                      <div style={{ fontSize: 13 }}>{t('chat.noHistory', { defaultValue: '暂无历史会话' })}</div>
                  </div>
              )}
              {sessions.filter(s => !sessionSearch || (s.key || '').toLowerCase().includes(sessionSearch.toLowerCase())).map(s => (
                  <Tooltip title={s.key} key={s.key} placement="right" mouseEnterDelay={0.5}>
                      <div 
                          onClick={() => handleSelectSession(s.key)}
                          style={{ 
                              padding: '12px', 
                              borderRadius: 10, 
                              cursor: 'pointer',
                              marginBottom: 4,
                              transition: 'all 0.2s',
                              background: sessionKey === s.key ? '#eff6ff' : 'transparent',
                              border: '1px solid',
                              borderColor: sessionKey === s.key ? '#bfdbfe' : 'transparent',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              position: 'relative'
                          }}
                          className="session-item"
                      >
                          <Avatar size={32} src={s.avatar} icon={<Bot size={16} />} style={{ background: s.key === sessionKey ? '#2563eb' : '#f1f5f9', color: s.key === sessionKey ? '#fff' : '#64748b', flexShrink: 0 }} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, color: sessionKey === s.key ? '#1e40af' : '#1e293b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                  {s.label || s.key}
                              </div>
                              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{new Date(s.updatedAt || s.createdAt || Date.now()).toLocaleDateString()}</div>
                          </div>
                          <div className="session-actions" style={{ display: 'flex', gap: 4, opacity: 0, transition: '0.2s' }}>
                              <Button 
                                  size="small" 
                                  type="text" 
                                  icon={<Copy size={12} />} 
                                  onClick={(e) => { e.stopPropagation(); copyToClipboard(s.key); }}
                              />
                              <Button 
                                  size="small" 
                                  type="text" 
                                  icon={<Trash2 size={12} />} 
                                  onClick={(e) => handleDeleteSession(e, s.key)}
                              />
                          </div>
                      </div>
                  </Tooltip>
              ))}
            </div>
          </div>
        </>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fafafa', position: 'relative' }}>
        <style>{`
            .session-item:hover { background: #f8fafc; }
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
            
            .input-container-v3:focus-within {
                border-color: #2563eb !important;
                box-shadow: 0 10px 25px -5px rgba(37, 99, 235, 0.1), 0 8px 10px -6px rgba(37, 99, 235, 0.1) !important;
            }
            .msg-footer { opacity: 1; transition: opacity 0.2s; }
            .message-in:hover .msg-footer { opacity: 1; }
        `}</style>
        
        <div style={{ padding: isMobile ? '6px 10px' : '10px 16px', background: '#fff', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 10, minWidth: 0 }}>
            <Button 
                type="text" 
                icon={<LayoutPanelLeft size={18} />} 
                onClick={() => setShowSider(!showSider)} 
                style={{ marginLeft: -6, color: showSider ? '#4f46e5' : '#64748b', flexShrink: 0 }}
            />
            <Badge status={status === 'authenticated' ? 'success' : (status === 'error' ? 'error' : 'processing')} />
            {status === 'authenticated' && sessionKey ? (
              <Tooltip title={t('chat.clickToCopy', { defaultValue: '点击复制会话 ID' })}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex' }}>
                    <span 
                        style={{ 
                            fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', cursor: 'pointer',
                            whiteSpace: 'nowrap', overflowX: 'auto', scrollbarWidth: 'none',
                            msOverflowStyle: 'none', maxWidth: isMobile ? 100 : 'none'
                        }}
                        className="v3-session-id-header"
                        onClick={() => copyToClipboard(sessionKey)}
                    >
                        {sessionKey}
                    </span>
                </div>
              </Tooltip>
            ) : (
              <Tag color="blue" icon={<ShieldCheck size={11} />} style={{ borderRadius: 6, border: 'none', background: '#eff6ff', color: '#4f46e5', padding: '0 6px', fontSize: 11, flexShrink: 0 }}>
                {status === 'authenticated' ? (isMobile ? 'V3' : t('chat.deviceVerified')) : 'V3 RPC'}
              </Tag>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 2 : 6, flexShrink: 0 }}>
              {!isMobile && <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>Thinking:</span>}
              <Select size="small" value={thinkingLevel} onChange={setThinkingLevel} style={{ width: isMobile ? 72 : 90 }} dropdownStyle={{ borderRadius: 8 }}>
                  <Select.Option value="low">Low</Select.Option>
                  <Select.Option value="medium">Medium</Select.Option>
                  <Select.Option value="high">High</Select.Option>
                  <Select.Option value="pro">Pro</Select.Option>
              </Select>
              <Button size="small" type="text" icon={<RefreshCw size={13} />} onClick={connect} title={t('common.restart')} />
          </div>
        </div>
  
        <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: isMobile ? '12px' : '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
          {messages.length === 0 && (
            <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 400, padding: 40 }}>
              <div style={{ background: '#eff6ff', width: 80, height: 80, borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', color: '#2563eb' }}>
                <Cpu size={40} />
              </div>
              <h3 style={{ fontSize: 20, fontWeight: 800, color: '#1e293b', marginBottom: 12 }}>{t('chat.v3Ready')}</h3>
              <p style={{ color: '#64748b', lineHeight: 1.6, fontSize: 14 }}>{t('chat.v3ReadyDesc')}</p>
              <div style={{ marginTop: 24, display: 'flex', gap: 8, justifyContent: 'center' }}>
                <Tag style={{ borderRadius: 10, padding: '4px 12px' }}>⚡ 低延迟</Tag>
                <Tag style={{ borderRadius: 10, padding: '4px 12px' }}>🔒 Ed25519</Tag>
                <Tag style={{ borderRadius: 10, padding: '4px 12px' }}>🌐 云同步</Tag>
              </div>
            </div>
          )}
          {messages.map((msg, index) => (
            <div key={index} className="message-in" style={{ display: 'flex', gap: 14, flexDirection: msg.role === 'user' ? 'row-reverse' : 'row' }}>
                {msg.role === 'user' ? (
                  <Avatar icon={<User size={18} />} style={{ background: '#1e293b', flexShrink: 0, marginTop: 4, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }} />
                ) : (
                  <div style={{ flexShrink: 0, marginTop: 4 }}>
                    <BotAvatar provider={selectedBot?.split(':')?.[1] || ''} size={isMobile ? 32 : 36} />
                  </div>
                )}
                <div style={{ 
                  maxWidth: isMobile ? '92%' : '85%', padding: isMobile ? '10px 14px' : '12px 18px', borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '4px 18px 18px 18px', 
                  background: msg.role === 'user' ? '#2563eb' : '#fff',
                  color: msg.role === 'user' ? '#fff' : '#1e293b',
                  boxShadow: msg.role === 'user' ? '0 4px 15px rgba(37, 99, 235, 0.15)' : '0 4px 12px rgba(0,0,0,0.03)',
                  border: msg.role === 'assistant' ? '1px solid #e8eff6' : 'none',
                  position: 'relative',
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere'
                }}>
                {msg.content === t('chat.thinking') ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, color: '#64748b' }}>{msg.content}</span>
                    <div className="typing-indicator" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <div className="typing-dot" style={{ width: 4, height: 4, background: '#2563eb', borderRadius: '50%' }}></div>
                      <div className="typing-dot" style={{ width: 4, height: 4, background: '#2563eb', borderRadius: '50%' }}></div>
                      <div className="typing-dot" style={{ width: 4, height: 4, background: '#2563eb', borderRadius: '50%' }}></div>
                    </div>
                  </div>
                ) : (
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} 
                    rehypePlugins={[rehypeSanitize, rehypeKatex]}
                    components={{
                      p: ({children}: any) => <p style={{margin: 0}}>{children}</p>,
                      table: ({ ...props }: any) => (
                        <div style={{ width: '100%', overflowX: 'auto', marginBottom: 12, borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff' }}>
                          <table {...props} style={{ width: '100%', borderCollapse: 'collapse', fontSize: isMobile ? '12px' : '13px' }} />
                        </div>
                      ),
                      th: ({ ...props }: any) => <th {...props} style={{ padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', textAlign: 'left', fontWeight: 600 }} />,
                      td: ({ ...props }: any) => <td {...props} style={{ padding: '8px 12px', borderBottom: '1px solid #e2e8f0', color: '#475569' }} />,
                      code: ({ inline, className, children, ...props }: any) => {
                        const match = /language-(\w+)/.exec(className || '');
                        const language = match ? match[1] : '';
                        const codeContent = String(children).replace(/\n$/, '');
                        if (!inline && language === 'mermaid') return <Mermaid chart={codeContent} />;
                        if (!inline && language) return <CodeBlock language={language} value={codeContent} isMobile={isMobile} {...props} />;
                        return <code {...props} style={{ padding: '0.2em 0.4em', backgroundColor: msg.role === 'user' ? 'rgba(255,255,255,0.1)' : 'rgba(175, 184, 193, 0.2)', borderRadius: '6px', fontSize: '85%' }}>{children}</code>;
                      }
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>
                )}
                <div style={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  gap: 6, 
                  marginTop: 6,
                  opacity: 1,
                  transition: 'opacity 0.2s'
                }} className="msg-footer">
                  <div style={{ display: 'flex', gap: 2 }}>
                    <Tooltip title={t('chat.copy')}>
                      <Button type="text" size="small" icon={<Copy size={11} />} onClick={() => copyToClipboard(msg.content)}
                        style={{ padding: '0 3px', height: 18, width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: msg.role === 'user' ? 'rgba(255,255,255,0.85)' : '#64748b' }} />
                    </Tooltip>
                    <Tooltip title={t('chat.quote')}>
                      <Button type="text" size="small" icon={<Quote size={11} />} onClick={() => setQuotedMsg(msg.content)}
                        style={{ padding: '0 3px', height: 18, width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          color: msg.role === 'user' ? 'rgba(255,255,255,0.85)' : '#64748b' }} />
                    </Tooltip>
                    {msg.role === 'assistant' && index === messages.length - 1 && (
                      <Tooltip title={t('chat.retry')}>
                        <Button type="text" size="small" icon={<RefreshCw size={11} />} onClick={handleRegenerate}
                          style={{ padding: '0 3px', height: 18, width: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b' }} />
                      </Tooltip>
                    )}
                  </div>
                  <div style={{ fontSize: 10, fontWeight: 500, color: msg.role === 'user' ? 'rgba(255,255,255,0.7)' : '#94a3b8' }}>{msg.timestamp}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {status !== 'authenticated' && (
          <div style={{
            position: 'absolute',
            top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(255,255,255,0.4)',
            backdropFilter: 'blur(20px) saturate(180%)',
            zIndex: 1000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            animation: 'v3-fade-in 0.4s ease-out'
          }}>
            <style>{`
              @keyframes v3-pulse-ring {
                0% { transform: scale(0.8); opacity: 0.5; }
                100% { transform: scale(1.4); opacity: 0; }
              }
              @keyframes v3-fade-in { from { opacity: 0; } to { opacity: 1; } }
              .v3-auth-card {
                padding: 40px;
                background: rgba(255, 255, 255, 0.9);
                border-radius: 32px;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
                border: 1px solid rgba(255, 255, 255, 0.3);
                text-align: center;
                max-width: 340px;
                width: 90%;
              }
              .v3-icon-box {
                width: 80px; height: 80px;
                border-radius: 24px;
                margin: 0 auto 24px;
                display: flex;
                align-items: center;
                justify-content: center;
                position: relative;
              }
            `}</style>
            
            <div className="v3-auth-card">
              <div className="v3-icon-box" style={{ background: status === 'error' ? '#fef2f2' : '#eff6ff' }}>
                {status !== 'error' && (
                  <div style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: 0,
                    borderRadius: 'inherit',
                    border: '4px solid #2563eb',
                    animation: 'v3-pulse-ring 1.5s cubic-bezier(0.24, 0, 0.38, 1) infinite'
                  }} />
                )}
                {status === 'error' ? (
                  <ShieldCheck size={36} color="#ef4444" />
                ) : status === 'authorizing' ? (
                  <Key size={36} color="#2563eb" />
                ) : (
                  <Spin size="large" />
                )}
              </div>
              
              <div style={{ fontWeight: 800, fontSize: 20, color: '#1e293b', marginBottom: 12, letterSpacing: '-0.02em' }}>
                {status === 'error' ? '设备连接失败' :
                  status === 'connecting' ? '正在寻址网关...' :
                  status === 'challenging' ? '安全握手中...' : 
                  status === 'authorizing' ? '正在自动获权...' : '网关认证中...'}
              </div>
              
              <div style={{ fontSize: 13, color: '#64748b', lineHeight: 1.6, marginBottom: 24 }}>
                {status === 'error' ? (
                  <div style={{ color: '#ef4444', background: '#fff1f0', padding: '8px 12px', borderRadius: 10, fontSize: 12, marginBottom: 16 }}>
                    认证失败，请确认网关已启动且允许当前设备。
                  </div>
                ) : status === 'authorizing' ? (
                  '检测到新设备接入，后台专家正在静默授权...'
                ) : 'WebSocket V3 · Ed25519 硬件安全认证'}
              </div>
              
              {status === 'error' && (
                <Button 
                  type="primary" 
                  size="large" 
                  onClick={connect} 
                  icon={<RefreshCw size={18} />}
                  style={{ width: '100%', height: 46, borderRadius: 14, background: '#2563eb', fontWeight: 600 }}
                >
                  重试连接
                </Button>
              )}
            </div>
            
            <div style={{ marginTop: 24, fontSize: 12, color: 'rgba(0,0,0,0.3)', fontWeight: 500 }}>
              OPENCLAW SECURE TUNNEL V3.0
            </div>
          </div>
        )}

        <div style={{ padding: isMobile ? '8px 12px' : '0 24px 20px', background: '#fafafa', borderTop: '1px solid #f1f5f9' }}>

           <div style={{ display: 'flex', gap: 8, marginBottom: showQuickActions ? 12 : 8, alignItems: 'center', transition: 'all 0.3s ease', paddingTop: 12 }}>
             {showQuickActions ? (
               <>
                 <div style={{ display: 'flex', gap: 8, overflowX: 'auto', flex: 1, paddingBottom: 4, scrollbarWidth: 'none' } as React.CSSProperties}>
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
                 <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
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
                   style={{ fontSize: 11, color: '#94a3b8', height: 20, padding: '0 8px', borderRadius: 10, background: '#f8fafc', display: 'flex', alignItems: 'center' }}
                 >
                   {t('chat.expandQuickCommands', { defaultValue: '快捷指令' })}
                 </Button>
                 <div style={{ height: 1, flex: 1, background: '#f1f5f9' }}></div>
               </div>
             )}
           </div>

            <div style={{ 
              display: 'flex', 
              gap: 0, 
              alignItems: 'stretch', 
              background: '#fff', 
              borderRadius: 20, 
              boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)', 
              border: '1px solid #e2e8f0', 
              flexDirection: 'column',
              overflow: 'hidden',
              transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              maxWidth: '100%',
              boxSizing: 'border-box'
            }} className="input-container-v3">
              <div style={{ width: '100%', display: 'flex', alignItems: 'center', padding: isMobile ? '8px 12px 0' : '12px 16px 0', gap: 8 }}>
                 <div style={{ padding: '2px 8px', background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9', display: 'flex', alignItems: 'center' }}>
                   <Select
                       placeholder={t('chat.selectBotTip')}
                       style={{ width: 110, fontSize: 13 }}
                       value={selectedBot}
                       onChange={setSelectedBot}
                       loading={loadingBots}
                       variant="borderless"
                       dropdownStyle={{ borderRadius: 10 }}
                   >
                       {botsModels?.data?.bots?.map((bot: any) => (
                           <Select.Option key={bot.id} value={`openclaw:${bot.id}`}>{bot.name || bot.id}</Select.Option>
                       ))}
                   </Select>
                 </div>
                 <div style={{ height: 16, width: 1, background: '#e2e8f0' }}></div>
                 <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>V3 WebSocket</span>
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

              <div style={{ width: '100%', display: 'flex', alignItems: 'flex-end', gap: 8, padding: isMobile ? '8px 12px 12px' : '8px 16px 16px' }}>
                <Input.TextArea
                  value={inputText}
                  onChange={e => setInputText(e.target.value)}
                  placeholder={status === 'authenticated' ? t('chat.v3InputPlaceholder') : t('chat.v3Connecting')}
                  autoSize={{ minRows: 1, maxRows: 6 }}
                  onCompositionStart={() => setIsComposing(true)}
                  onCompositionEnd={() => setIsComposing(false)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  disabled={status !== 'authenticated'}
                  variant="borderless"
                  style={{ padding: '4px 0' }}
                />
                <Button
                   type="primary"
                   icon={isTyping ? <Square size={16} fill="#fff" /> : <Send size={17} />}
                   onClick={isTyping ? handleStopGeneration : () => handleSend()}
                   disabled={status !== 'authenticated' || (!isTyping && !inputText.trim())}
                   style={{ 
                     width: isMobile ? 36 : 40, height: isMobile ? 36 : 40, borderRadius: 12,
                     background: isTyping ? '#ef4444' : '#4f46e5', border: 'none', flexShrink: 0,
                     display: 'flex', alignItems: 'center', justifyContent: 'center',
                     boxShadow: isTyping ? '0 4px 12px rgba(239,68,68,0.25)' : '0 4px 12px rgba(79,70,229,0.25)',
                     transition: 'all 0.2s'
                   }}
                 />
              </div>
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
    </>
  );
};

export default ChatV3;
