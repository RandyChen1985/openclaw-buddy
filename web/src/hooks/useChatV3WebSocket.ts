import { useState, useEffect, useRef, useCallback } from 'react';
import { message, Modal } from 'antd';
import * as nacl from 'tweetnacl';
import storage from '../utils/storage';
import { getWsUrl } from '../utils/url';
import { getTicket, summarizeSession } from '../api';
import { APP_VERSION } from '../version';

export interface FileInfo {
  url: string;
  thumbUrl?: string;
  path: string;
  filename: string;
  size: number;
  ext: string;
}

export interface Message {
  id: string;
  runId?: string; // 💡 事务标识：用于精准追踪流式响应属于哪一轮对话
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  metrics?: {
    ttft?: number;
    duration?: number;
    tps?: number;
  };
}

interface UseChatV3WebSocketProps {
  keyPair: nacl.BoxKeyPair | null;
  deviceId: string;
  selectedBot: string;
  setSelectedBot: (bot: string) => void;
  botsModels: any;
  t: any;
  inputAreaRef: React.RefObject<any>;
  virtuosoRef: React.RefObject<any>;
  scrollRef: React.RefObject<HTMLDivElement>;
}

export const useChatV3WebSocket = ({
  keyPair,
  deviceId,
  selectedBot,
  setSelectedBot,
  botsModels,
  t,
  inputAreaRef,
  virtuosoRef,
  scrollRef
}: UseChatV3WebSocketProps) => {
  // --- States ---
  const [messages, setMessages] = useState<Message[]>([]);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error'>('disconnected');
  const [isTyping, setIsTyping] = useState(false);
  const [isStalled, setIsStalled] = useState(false);
  const [sessionKey, setSessionKey] = useState<string | null>(() => storage.getItem('v3_current_session_key'));
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [sessionLabel, setSessionLabel] = useState<string | null>(() => storage.getItem('v3_current_session_label'));
  const [sessionModel, setSessionModel] = useState<string>('');

  // 💡 持久化：当 sessionKey / sessionLabel 变化时，原子化同步到 storage 以应对窗口缩放/重挂载
  useEffect(() => {
    if (sessionKey) {
      storage.setItem('v3_current_session', JSON.stringify({ key: sessionKey, label: sessionLabel }));
      // 兼容旧版，保留单个 key (可选)
      storage.setItem('v3_current_session_key', sessionKey);
      if (sessionLabel) storage.setItem('v3_current_session_label', sessionLabel);
    } else {
      storage.removeItem('v3_current_session');
      storage.removeItem('v3_current_session_key');
      storage.removeItem('v3_current_session_label');
    }
  }, [sessionKey, sessionLabel]);
  const [thinkingLevel, setThinkingLevel] = useState<'low' | 'medium' | 'high' | 'pro'>('medium');
  const [lastHealth, setLastHealth] = useState<{ ok: boolean, latency: number, ts: number } | null>(null);
  const [latencyHistory, setLatencyHistory] = useState<number[]>([]);
  const [pulse, setPulse] = useState(0);
  const [tpsData, setTpsData] = useState<number[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isUpdatingLabel, setIsUpdatingLabel] = useState(false);
  const [hasNewMessages, setHasNewMessages] = useState(false);

  // --- Refs ---
  const wsRef = useRef<WebSocket | null>(null);
  const requestIdRef = useRef(1);
  const pendingRequests = useRef<Map<string, (res: any) => void>>(new Map());
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const MAX_RECONNECTS = 5;
  
  const sessionKeyRef = useRef<string | null>(null);
  useEffect(() => { sessionKeyRef.current = sessionKey; }, [sessionKey]);
  const autoSummarizeRef = useRef<any>(null);
  
  const sessionLabelRef = useRef<string | null>(null);
  useEffect(() => { sessionLabelRef.current = sessionLabel; }, [sessionLabel]);

  const messagesCountRef = useRef(messages.length);
  useEffect(() => { messagesCountRef.current = messages.length; }, [messages.length]);

  const stallTimerRef = useRef<any>(null);
  const streamContentRef = useRef('');
  const lastUpdateRef = useRef(0);
  const startTimeRef = useRef<number>(0);
  const ttftRecordedRef = useRef<boolean>(false);
  const tokenCountRef = useRef<number>(0);
  const firstTokenTimeRef = useRef<number>(0);
  const showScrollBtnRef = useRef(false);

  // --- RPC Communication ---
  const sendRPC = useCallback((method: string, params: any): Promise<any> => {
    return new Promise((resolve) => {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
        resolve({ ok: false, error: { message: 'WebSocket not connected' } });
        return;
      }
      const id = `${method}-${requestIdRef.current++}`;
      const req = { type: 'req', id, method, params };
      
      // 💡 针对物理删除等磁盘 IO 较重的操作，放宽超时限制至 3 分钟
      const timeoutValue = method === 'sessions.delete' ? 180000 : 30000;

      const timer = setTimeout(() => {
        if (pendingRequests.current.has(id)) {
          pendingRequests.current.delete(id);
          resolve({ ok: false, error: { message: `RPC timeout (${timeoutValue/1000}s)` } });
        }
      }, timeoutValue);
      pendingRequests.current.set(id, (res: any) => {
        clearTimeout(timer);
        resolve(res);
      });
      wsRef.current.send(JSON.stringify(req));
    });
  }, []);

  // --- Session List actions ---
  const fetchSessions = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoadingSessions(true);
    
    // 💡 视觉加固：使用 Promise.all 确保即使后端秒回，图标也至少旋转 800ms
    const [res] = await Promise.all([
      sendRPC('sessions.list', { limit: 50 }),
      isSilent ? Promise.resolve() : new Promise(resolve => setTimeout(resolve, 800))
    ]);

    if (res.ok) {
      const list = res.payload?.items || res.payload?.sessions || (Array.isArray(res.payload) ? res.payload : []);
      setSessions(list);

      // 💡 自动总结：刷新后识别未命名会话并后台生成标题
      if (!isSilent) {
        const untitled = list.filter((s: any) => !s.label || s.label === '未命名会话' || s.label === 'New Session' || s.label === '').slice(0, 15);
        if (untitled.length > 0) {
          // 缩短延时到 500ms
          setTimeout(async () => {
            for (const s of untitled) {
              const hRes = await sendRPC('chat.history', { sessionKey: s.key, limit: 10 });
              if (hRes.ok) {
                const raw = hRes.payload.messages || hRes.payload.items || [];
                // 💡 降低门槛：只要有 1 条用户消息即可尝试总结标题
                if (raw.length >= 1) {
                  const msgs = raw.map((m: any) => ({
                    role: m.role === 'toolResult' ? 'assistant' : m.role,
                    content: formatMessageContent(m.content)
                  })).filter((m: any) => m.content);
                  
                  if (msgs.length > 0) {
                    autoSummarizeRef.current?.(msgs, false, s.key);
                  }
                }
              }
            }
          }, 500);
        }
      }
    }
    if (!isSilent) setLoadingSessions(false);
  }, [sendRPC]);

  // --- Streaming Data Handlers ---
  const formatMessageContent = useCallback((msg: any): string => {
    if (!msg) return '';
    
    // 💡 兼容性设计：既支持传入完整的 message 对象，也支持仅传入 content 字段（用于历史回溯）
    const content = (msg.content !== undefined && msg.content !== null) ? msg.content : msg;
    const topThought = msg.thought || msg.thinking || msg.reasoning || '';
    
    let prefix = '';
    if (topThought) {
      prefix = `> :::thinking\n> ${String(topThought).replace(/\n/g, '\n> ')}\n> :::\n\n`;
    }

    // 处理主要内容部分
    let body = '';
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (trimmed === '[]' || trimmed === '{}') body = '';
      else if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          body = formatMessageContent(parsed);
        } catch (e) {
          body = content;
        }
      } else {
        body = content;
      }
    } else if (Array.isArray(content)) {
      body = content.map((c: any) => {
        let matched = false;
        
        // 1. 处理思考过程 (数组内部格式)
        let thinkingPart = '';
        if (c.thinking || c.thought || c.reasoning || c.type === 'thinking') {
          const thought = c.thinking || c.thought || c.reasoning || c.content || '';
          thinkingPart = `> :::thinking\n> ${String(thought).replace(/\n/g, '\n> ')}\n> :::\n\n`;
          matched = true;
        }

        // 2. 处理工具调用
        let toolCallPart = '';
        if (c.type === 'toolCall' || c.toolCall || c.tool_call) {
          const tc = c.toolCall || c.tool_call || c;
          const name = tc.name || tc.function?.name || 'unknown_tool';
          const args = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {});
          toolCallPart = `> :::toolCall\n> **${name}**\n> \`\`\`json\n> ${args}\n> \`\`\`\n> :::\n\n`;
          matched = true;
        }

        // 3. 处理工具结果
        let toolResultPart = '';
        if (c.type === 'toolResult' || c.toolResult || c.tool_result) {
          const tr = c.toolResult || c.tool_result || c;
          const toolName = tr.toolName || tr.tool_name || tr.name || '';
          const result = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content || tr.result || {});
          toolResultPart = `> :::toolResult\n> ${toolName ? `**${toolName}**\n> ` : ''}\`\`\`json\n> ${result}\n> \`\`\`\n> :::\n\n`;
          matched = true;
        }

        // 4. 处理文本
        const textPart = c.text || (typeof c.content === 'string' ? c.content : '');
        if (textPart) matched = true;

        // 5. 💡 兜底处理
        let fallbackPart = '';
        if (!matched && typeof c === 'object' && c !== null && Object.keys(c).length > 0) {
          fallbackPart = `\n> :::warning 未知消息块 (${c.type || 'unknown'})\n> \`\`\`json\n> ${JSON.stringify(c, null, 2).split('\n').join('\n> ')}\n> \`\`\`\n> :::\n\n`;
        }

        return thinkingPart + toolCallPart + toolResultPart + fallbackPart + textPart;
      }).join('');
    } else if (typeof content === 'object' && content !== null) {
      body = formatMessageContent([content]);
    } else {
      body = String(content);
    }

    return prefix + body;
  }, []);

  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    setIsStalled(false);
  }, []);

  const resetStallTimer = useCallback(() => {
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => {
      setIsStalled(true);
    }, 3500);
  }, [clearStallTimer]);

  const handleChatDelta = useCallback((payload: any) => {
    if (payload.state === 'delta') {
      resetStallTimer();
      const now = Date.now();
      
      if (showScrollBtnRef.current) {
        setHasNewMessages(true);
      }

      if (!ttftRecordedRef.current) {
        ttftRecordedRef.current = true;
        firstTokenTimeRef.current = now;
      }

      const messageObj = payload.message;
      if (!messageObj) return;

      if (payload.sessionKey && payload.sessionKey !== sessionKeyRef.current) {
        return;
      }

      const fullText = formatMessageContent(messageObj);
      
      if (!fullText.trim() && streamContentRef.current.trim()) {
        return;
      }

      const oldLen = streamContentRef.current.length;
      if (oldLen > 50 && fullText.length < oldLen - 20) {
        return;
      }

      streamContentRef.current = fullText;
      tokenCountRef.current = fullText.length;

      setIsTyping(prev => {
        if (!prev) return true;
        return prev;
      });

      if (now - lastUpdateRef.current > 64) {
        lastUpdateRef.current = now;
        const elapsedFromFirst = (now - firstTokenTimeRef.current) / 1000;
        const currentTPS = elapsedFromFirst > 0 ? (tokenCountRef.current / elapsedFromFirst) : 0;
        const ttft = firstTokenTimeRef.current - startTimeRef.current;

        if (tokenCountRef.current % 5 === 0) {
          setTpsData(prev => [...prev.slice(-19), currentTPS]);
        }

        setMessages(prev => {
          // 💡 核心优化：通过 runId 精准查找。
          // 逻辑：1. 找 runId 匹配的；2. 没找到再找没有 runId 且是 assistant 的第一项（软绑定）。
          const targetIndex = prev.findLastIndex(m => m.runId === payload.runId) !== -1 
            ? prev.findLastIndex(m => m.runId === payload.runId)
            : prev.findLastIndex(m => m.role === 'assistant' && !m.runId);

          if (targetIndex !== -1) {
            const current = prev[targetIndex];
            const updated = { 
              ...current, 
              runId: payload.runId, // 完成绑定
              content: fullText,
              metrics: { ...current.metrics, ttft, tps: currentTPS }
            };
            const next = [...prev];
            next[targetIndex] = updated;
            return next;
          }
          return prev;
        });

        if (virtuosoRef.current) {
          const isNearBottom = scrollRef.current 
            ? (scrollRef.current.scrollHeight - scrollRef.current.scrollTop - scrollRef.current.clientHeight < 40)
            : true;

          if (!showScrollBtnRef.current || isNearBottom) {
            virtuosoRef.current.scrollToIndex({ 
              index: messagesCountRef.current - 1, 
              align: 'end',
              behavior: 'auto' 
            });
          }
        }
      }
    } else if (payload.state === 'final' || payload.state === 'finished' || payload.state === 'done') {
        // 💡 漏洞修复：如果 final 事件的 sessionKey 不是当前会话，拦截以防止跨会话状态清零和复写！
        if (payload.sessionKey && payload.sessionKey !== sessionKeyRef.current) {
          return;
        }

        clearStallTimer();
        const now = Date.now();
        const duration = (now - startTimeRef.current) / 1000;
        const ttft = ttftRecordedRef.current ? (firstTokenTimeRef.current - startTimeRef.current) : 0;
        const finalTPS = duration > 0 ? (tokenCountRef.current / (duration - (ttft/1000))) : 0;

        setMessages(prev => {
            const targetIndex = prev.findLastIndex(m => m.runId === payload.runId) !== -1 
              ? prev.findLastIndex(m => m.runId === payload.runId)
              : prev.findLastIndex(m => m.role === 'assistant' && !m.runId);

            if (targetIndex === -1) return prev;
            const last = prev[targetIndex];
            
            const incomingContent = payload.message?.content ? formatMessageContent(payload.message.content) : streamContentRef.current;
            if (!incomingContent && last.content && last.content !== t('chat.thinking')) {
                return prev;
            }

            const next = [...prev];
            next[targetIndex] = { 
                ...last, 
                runId: payload.runId,
                content: incomingContent,
                metrics: { ...last.metrics, ttft, duration, tps: finalTPS }
            };
            return next;
        });

        setIsTyping(false);
        streamContentRef.current = '';
        fetchSessions(true);
        setTimeout(() => inputAreaRef.current?.focus(), 100);
    } else if (payload.state === 'error' || payload.state === 'failed') {
        // 💡 漏洞修复：拦截跨会话的错误信号
        if (payload.sessionKey && payload.sessionKey !== sessionKeyRef.current) {
          return;
        }
        clearStallTimer();
        
        const errorMsg = payload.message?.content || payload.error?.message || payload.error || '网关或模型响应异常，流式生成失败';
        
        setMessages(prev => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant') return prev;
            
            const errMsgFormatted = typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg);
            const content = last.content === '思考中...' || last.content === t('chat.thinking') || !last.content 
              ? `> **⚠️ 异常或错误**\n> ${errMsgFormatted}` 
              : last.content + `\n\n> **⚠️ 生成被中断**\n> ${errMsgFormatted}`;

            return [...prev.slice(0, -1), { ...last, content }];
        });

        setIsTyping(false);
        streamContentRef.current = '';
        setTimeout(() => inputAreaRef.current?.focus(), 100);
    }
  }, [resetStallTimer, clearStallTimer, fetchSessions, inputAreaRef, scrollRef, virtuosoRef]);

  // --- Connection Logic ---
  const handleChallenge = useCallback(async (nonce: string, ws: WebSocket) => {
    if (!keyPair || !deviceId) return;
    let gatewayToken = '';
    try {
      const api = await import('../api').then(m => m.default);
      const res = await api.get('/v1/openclaw/gateway-token');
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

    const handshakeStr = `v3|${deviceId}|${clientId}|${clientMode}|${role}|${scopes}|${signedAt}|${gatewayToken}|${nonce}|${platform}|`;
    const signature = nacl.sign.detached(new TextEncoder().encode(handshakeStr), (keyPair as any).secretKey);

    const authId = `auth-${Date.now()}`;
    const req = {
      type: 'req', id: authId, method: 'connect',
      params: {
        minProtocol: 3, maxProtocol: 3, role,
        scopes: scopes.split(','),
        auth: { token: gatewayToken },
        client: { id: clientId, mode: clientMode, platform, version: APP_VERSION },
        device: {
          id: deviceId,
          publicKey: btoa(String.fromCharCode(...keyPair.publicKey)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
          signature: btoa(String.fromCharCode(...signature)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''),
          signedAt, nonce
        }
      }
    };

    pendingRequests.current.set(authId, (res: any) => {
      if (res.ok) {
        setStatus('authenticated');
        setTimeout(() => {
          fetchSessions();
          // 💡 核心修复：只有当本地没有消息时（初始加载），或者 session 发生了切换，才自动加载历史
          // 如果已经在对话中且正在输入/已有内容，且 sessionKey 没变，则绝对不通过 loadSessionHistory 覆盖当前状态
          // 这能防止网络抖动导致的“撤自/清屏”现象
          if (sessionKeyRef.current && messagesCountRef.current === 0) {
              loadSessionHistory(sessionKeyRef.current);
          } else {
              // 如果之前正在打字，重连后保持打字状态 (后续会有新的 Delta 进来恢复更新)
          }
        }, 300);
      } else {
        const errMsg = typeof res.error === 'object' ? JSON.stringify(res.error) : String(res.error);
        if (errMsg.includes('NOT_PAIRED') || errMsg.includes('NOT_AUTHORIZED')) {
            setStatus('authorizing');
        } else {
            console.error('❌ [V3] 握手失败:', res.error);
            setStatus('error');
        }
      }
    });
    ws.send(JSON.stringify(req));
  }, [keyPair, deviceId, fetchSessions, APP_VERSION]);

  const connect = useCallback(async () => {
    if (!keyPair || !deviceId) return;
    if (wsRef.current) wsRef.current.close();
    setStatus('connecting');
    const ticket = await getTicket();
    const token = storage.getItem('guardian_token');
    const wsUrl = ticket ? getWsUrl(`/v1/ws/gateway?ticket=${ticket}`) : getWsUrl(`/v1/ws/gateway?token=${token}`);
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setStatus('challenging');
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'event') {
        if (data.event === 'health') {
          const { ok, durationMs, ts } = data.payload;
          setLastHealth({ ok, latency: durationMs || 0, ts });
          setLatencyHistory(prev => [...prev.slice(-29), durationMs || 0]);
          setPulse(p => p + 1);
          return;
        }
        if (['tick', 'presence'].includes(data.event)) return;
        if (data.event === 'connect.challenge') handleChallenge(data.payload.nonce, ws);
        else if (data.event === 'chat') handleChatDelta(data.payload);
        else if (data.event === 'sessions.changed') fetchSessions(true);
        else if (data.event === 'exec.approval.requested') {
          // 💡 关键修复：生成结构化的审批 Markdown 块
          const { id, request } = data.payload;
          const slug = id.substring(0, 8);
          const command = request.command;
          // 使用自定义容器语法，方便前端识别并渲染为按钮
          const approvalBlock = `\n\n> :::approval\n> **${slug}**\n> \`\`\`bash\n> ${command}\n> \`\`\`\n> :::\n`;

          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (last && last.role === 'assistant') {
              if (last.content.includes(slug)) return prev;
              const newContent = (last.content === t('chat.thinking') || !last.content) 
                ? approvalBlock 
                : `${last.content}${approvalBlock}`;
              return [...prev.slice(0, -1), { ...last, content: newContent }];
            }
            return prev;
          });
          setIsTyping(false);
          clearStallTimer();
        }
 else if (data.event === 'agent') {
          // 处理 agent 状态流，如“正在等待审批”
          const { stream, data: agentData } = data.payload;
          if (stream === 'item' && agentData.status === 'blocked') {
            setIsTyping(false);
            clearStallTimer();
          }
        }
        return;
      }
      if (data.type === 'res') {
        const resolve = pendingRequests.current.get(data.id);
        if (resolve) { resolve(data); pendingRequests.current.delete(data.id); }
      }
    };
    ws.onclose = () => {
      setStatus('disconnected');
      setIsTyping(false);
      clearStallTimer();
    };
    ws.onerror = () => setStatus('error');
  }, [keyPair, deviceId, handleChallenge, handleChatDelta, fetchSessions, clearStallTimer]);

  // --- More Session/Chat Logic ---
  const loadSessionHistory = useCallback(async (key: string) => {
    setIsLoadingHistory(true);
    const res = await sendRPC('chat.history', { sessionKey: key, limit: 500 });
    if (res.ok) {
        const items = (res.payload.messages || res.payload.items || []).sort((a: any, b: any) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
        const history = items.map((item: any) => {
          let content = formatMessageContent(item.content);
          
          if (item.role === 'toolResult' && !content.includes(':::toolResult')) {
            const toolName = item.toolName || 'unknown';
            const text = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
            content = `> :::toolResult\n> **${toolName}**\n> ${text.split('\n').join('\n> ')}\n> :::\n`;
          }

          return {
            id: item.id || `msg-${new Date(item.createdAt || 0).getTime()}-${Math.random().toString(36).substring(2, 7)}`,
            role: item.role === 'toolResult' ? 'assistant' : item.role,
            content: content || '',
            timestamp: new Date(item.createdAt || item.timestamp || Date.now()).toLocaleTimeString(),
            metrics: item.metrics
          };
        }).filter((msg: any) => msg.content && msg.content.trim() !== '');
        
        
        setMessages(history);

        // 💡 历史加载对位：当历史记录加载完成后，自动瞬移到最后一条消息，符合聊天软件查看习惯
        if (history.length > 0) {
            setTimeout(() => {
                virtuosoRef.current?.scrollToIndex({ 
                    index: history.length - 1, 
                    align: 'end',
                    behavior: 'auto' 
                });
            }, 100);
        }
    }
    setIsLoadingHistory(false);
  }, [sendRPC]);

  const handleSelectSession = useCallback((key: string) => {
    if (key === sessionKey) return;
    setSessionKey(key);
    const s = sessions.find(x => x.key === key);
    if (s) {
      setSessionLabel(s.label);
      setSessionModel(s.model || '');
      if (key.startsWith('agent:')) {
        const parts = key.split(':');
        if (parts.length >= 2) setSelectedBot(`openclaw:${parts[1]}`);
      }
    }
    loadSessionHistory(key);
    setIsTyping(false);
    clearStallTimer();
    streamContentRef.current = '';
    setHasNewMessages(false);
  }, [sessionKey, sessions, setSelectedBot, loadSessionHistory, clearStallTimer]);

  const handleUpdateLabel = useCallback(async (newLabel: string) => {
    if (!sessionKey || !newLabel.trim()) return;
    setIsUpdatingLabel(true);
    try {
      const res = await sendRPC('sessions.patch', { key: sessionKey, label: newLabel.trim() });
      if (res.ok) {
        message.success(t('common.success'));
        setSessionLabel(newLabel.trim());
        fetchSessions();
      }
    } finally {
      setIsUpdatingLabel(false);
    }
  }, [sessionKey, sendRPC, fetchSessions, t]);

  const handleAutoSummarize = useCallback(async (messagesOverride?: Message[], silent = false, targetKey?: string) => {
    const activeKey = targetKey || sessionKey;
    const targetMessages = messagesOverride || messages;
    if (!activeKey || targetMessages.length === 0) return;
    if (!targetKey) setIsSummarizing(true);
    if (!silent && targetKey) message.loading({ content: t('chat.summarizingTitle', { defaultValue: '正在生成标题...' }), key: `summarizing-${activeKey}` });
    try {
      const agentId = selectedBot.replace('openclaw:', '');
      const bot = botsModels?.data?.bots?.find((b: any) => b.id === agentId);
      const currentModelID = bot?.model || '';
      const validMessages = targetMessages.map(m => {
        let clean = m.content;
        clean = clean.replace(/> :::thinking[\s\S]*?:::\n*/g, '')
                     .replace(/> :::toolCall[\s\S]*?:::\n*/g, '')
                     .replace(/> :::toolResult[\s\S]*?:::\n*/g, '');
        return { role: m.role, content: clean.trim() };
      }).filter(m => m.content.length > 0);
      const newTitle = await summarizeSession(validMessages, currentModelID);
      if (newTitle) {
        const res = await sendRPC('sessions.patch', { key: activeKey, label: newTitle });
        if (res.ok) {
          if (activeKey === sessionKey) setSessionLabel(newTitle);
          if (!silent) message.success({ content: t('chat.titleSummarized'), key: `summarizing-${activeKey}` });
          setSessions(prev => prev.map(s => s.key === activeKey ? { ...s, label: newTitle } : s));
        }
      }
    } catch (err) {
      if (!silent) console.error('Summarize error:', err);
    } finally {
      if (!targetKey) setIsSummarizing(false);
    }
  }, [sessionKey, messages, selectedBot, botsModels, sendRPC, fetchSessions, t]);
  autoSummarizeRef.current = handleAutoSummarize;

  const handleSend = useCallback(async (content?: any, attachedFiles?: FileInfo[]) => {
    const text = (typeof content === 'string' ? content : '').trim();
    
    // 💡 健壮性加固 1：防止重复发送（解决“一遍又一遍”重复的问题），并确保在认证状态下操作
    if (isTyping) return;
    if ((!text && (!attachedFiles || attachedFiles.length === 0)) || status !== 'authenticated') return;

    setIsTyping(true);
    setTpsData([]);
    streamContentRef.current = '';
    startTimeRef.current = Date.now();
    ttftRecordedRef.current = false;
    tokenCountRef.current = 0;
    firstTokenTimeRef.current = 0;

    let finalContent = text;
    if (attachedFiles && attachedFiles.length > 0) {
      const fileLinks = attachedFiles.map(f => {
        const isImage = f.ext.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
        return isImage ? `\n![${f.filename}](${f.thumbUrl || f.url} \"${f.url}\")\n(File path: ${f.path})` : `\n[${f.filename}](${f.url}) (File path: ${f.path})`;
      }).join('');
      finalContent += fileLinks + `\n\n**System Note for Expert:** The user has uploaded files. Access them via absolute \"File path\" provided.`;
    }

    const newUserMsg: Message = { id: `msg-${Date.now()}`, role: 'user', content: finalContent, timestamp: new Date().toLocaleTimeString() };
    setMessages(prev => [...prev, newUserMsg]);

    let currentKey = sessionKey;
    if (!currentKey) {
      const res = await sendRPC('sessions.create', { agentId: selectedBot.replace('openclaw:', '') });
      if (res.ok) {
        currentKey = res.payload.key;
        setSessionKey(currentKey);
        await sendRPC('sessions.patch', { key: currentKey, thinkingLevel, model: sessionModel });
        fetchSessions();
      } else {
        // 💡 修复：如果创建会话失败，必须报错并重置状态，不能静默退出（解决“无反应”Bug）
        message.error(t('chat.failedToCreateSession') || 'Failed to create session: ' + (res.error?.message || 'Unknown'));
        setIsTyping(false);
        return;
      }
    }

    if (currentKey) {
      const assistantInitialMsg = text === '/stop' ? t('chat.terminated') : t('chat.thinking');
      setMessages(prev => [...prev, { id: `msg-ai-${Date.now()}`, role: 'assistant', content: assistantInitialMsg, timestamp: new Date().toLocaleTimeString() }]);
      resetStallTimer();
      
      // 💡 显式强制滚动到底部：由于用户主动发送消息，无论当前在什么位置，都应立即拉到底部以跟随最新对话
      setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({ 
          index: messagesCountRef.current + 1, // +1 是因为刚刚瞬发了两条记录 (User + AI Thinking)
          align: 'end',
          behavior: 'smooth' 
        });
      }, 100);

      const res = await sendRPC('chat.send', { 
        sessionKey: currentKey, 
        message: finalContent, 
        idempotencyKey: `ik-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      });
      
      if (res.ok && res.payload?.runId) {
        // 💡 握手回填：将 RPC 返回的 runId 立即同步到刚才创建的 AI 消息对象中
        setMessages(prev => {
          const lastIndex = prev.findLastIndex(m => m.role === 'assistant' && !m.runId);
          if (lastIndex !== -1) {
            const next = [...prev];
            next[lastIndex] = { ...next[lastIndex], runId: res.payload.runId };
            return next;
          }
          return prev;
        });
      }

      if (!res.ok) {
        message.error('Failed to send: ' + (res.error?.message || 'Unknown'));
        setIsTyping(false);
        clearStallTimer();
      } else if (text === '/stop') {
        setIsTyping(false);
        clearStallTimer();
      }
    } else {
      // 💡 修复：防止 sessionKey 依然为空导致的静默失败
      setIsTyping(false);
      message.error('Session key missing');
    }
  }, [status, sessionKey, selectedBot, thinkingLevel, sessionModel, sendRPC, fetchSessions, resetStallTimer, clearStallTimer, t, isTyping]);

  const handleRegenerate = useCallback(() => {
    if (isTyping) {
      message.warning('⚠️ AI 正在狂奔输出中，请先等它说完或手动点击停止哦~');
      return;
    }
    const lastUserIndex = [...messages].reverse().findIndex(m => m.role === 'user');
    if (lastUserIndex !== -1) {
      const actualIndex = messages.length - 1 - lastUserIndex;
      const lastUserMsg = messages[actualIndex];
      setMessages(prev => prev.slice(0, actualIndex + 1));
      handleSend(lastUserMsg.content);
    }
  }, [messages, handleSend, isTyping]);

  const handleSaveEdit = useCallback(async (editingMsgIndex: number, editContent: string) => {
    if (isTyping) {
      message.warning('⚠️ AI 正在狂奔输出中，请先等它说完或手动点击停止哦~');
      return;
    }
    const newText = editContent.trim();
    if (!newText) return;
    setMessages(prev => prev.slice(0, editingMsgIndex));
    handleSend(newText);
  }, [handleSend, isTyping]);

  const handleStopGeneration = useCallback(() => {
    setIsTyping(false);
    clearStallTimer();
    streamContentRef.current = '';
    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant') {
        const label = t('chat.manuallyStopped');
        const content = (last.content === t('chat.thinking') || last.content === '') ? label : last.content + ` (${label})`;
        return [...prev.slice(0, -1), { ...last, content }];
      }
      return prev;
    });
    handleSend('/stop');
  }, [clearStallTimer, handleSend, t]);

  const handleDeleteSession = useCallback((_e: any, key: string) => {
    Modal.confirm({
      title: t('chat.deleteSessionConfirm'),
      content: t('chat.deleteSessionContent'),
      onOk: async () => {
        try {
          message.loading({ content: t('common.processing', { defaultValue: '正在处理...' }), key: 'deletingSession' });
          const res = await sendRPC('sessions.delete', { key });
          
          if (res.ok) {
            message.success({ content: t('common.success'), key: 'deletingSession' });
            if (sessionKey === key) { 
              setSessionKey(null); 
              setMessages([]); 
              setSessionLabel(null); 
              setSessionModel('');
              setIsTyping(false);
              clearStallTimer();
              streamContentRef.current = '';
            }
            fetchSessions();
          } else {
            // 💡 优化：确保透出具体的报错原因，方便定位是网络问题还是权限问题
            const errMsg = res.error?.message || res.error || 'Gateway Timeout or Unknown Error';
            message.error({ 
              content: `${t('common.error')}: ${typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg)}`, 
              key: 'deletingSession',
              duration: 5
            });
          }
        } catch (err) {
          console.error('❌ Delete Session Trap:', err);
          message.error({ content: t('common.error'), key: 'deletingSession' });
        }
      }
    });
  }, [sessionKey, sendRPC, fetchSessions, t]);

  const handleDeleteGroup = useCallback((label: string, sessionKeys: string[]) => {
    if (sessionKeys.length === 0) return;
    Modal.confirm({
      title: t('chat.deleteGroupConfirm'),
      content: t('chat.deleteGroupContent', { count: sessionKeys.length, label }),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          message.loading({ content: t('chat.clearingGroup'), key: 'clearingGroup' });
          await Promise.all(sessionKeys.map(key => sendRPC('sessions.delete', { key })));
          message.success({ content: t('common.success'), key: 'clearingGroup' });
          if (sessionKey && sessionKeys.includes(sessionKey)) { 
            setSessionKey(null); 
            setMessages([]); 
            setSessionLabel(null); 
            setSessionModel('');
            setThinkingLevel('medium');
          }
          fetchSessions();
        } catch (err) { message.error({ content: t('common.error'), key: 'clearingGroup' }); }
      }
    });
  }, [sessionKey, sendRPC, fetchSessions, t]);

  const handleClearAllHistory = useCallback(() => {
    if (sessions.length === 0) return;
    Modal.confirm({
      title: t('chat.clearAllHistoryConfirm'),
      content: t('chat.clearAllHistoryContent'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          message.loading({ content: t('chat.clearingAll'), key: 'clearingAll' });
          await Promise.all(sessions.map(s => sendRPC('sessions.delete', { key: s.key })));
          message.success({ content: t('chat.clearAllSuccess'), key: 'clearingAll' });
          setSessionKey(null); setMessages([]); setSessionLabel(null); setSessions([]);
          fetchSessions();
        } catch (err) { message.error({ content: t('common.error'), key: 'clearingAll' }); }
      }
    });
  }, [sessions, sendRPC, fetchSessions, t]);

  const handleModelChange = useCallback(async (newModel: string) => {
    setSessionModel(newModel);
    if (!sessionKey) return;
    const res = await sendRPC('sessions.patch', { key: sessionKey, model: newModel || null });
    if (res.ok) {
      message.success(t('chat.modelSwitchSuccess'));
      fetchSessions();
    }
  }, [sessionKey, sendRPC, fetchSessions, t]);

  const handleThinkingLevelChange = useCallback(async (newLevel: 'low' | 'medium' | 'high' | 'pro') => {
    setThinkingLevel(newLevel);
    if (!sessionKey) return;
    sendRPC('sessions.patch', { key: sessionKey, thinkingLevel: newLevel });
  }, [sessionKey, sendRPC]);

  // --- Effects ---
  useEffect(() => {
    if (status === 'disconnected' && keyPair) {
      if (reconnectCountRef.current >= MAX_RECONNECTS) { setStatus('error'); return; }
      const delay = reconnectCountRef.current === 0 ? 0 : Math.min(2000 * reconnectCountRef.current, 10000);
      reconnectTimerRef.current = setTimeout(() => { reconnectCountRef.current++; connect(); }, delay);
      return () => { if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current); };
    }
    if (status === 'authenticated') reconnectCountRef.current = 0;
  }, [status, keyPair, connect]);

  useEffect(() => {
    return () => { if (wsRef.current) { wsRef.current.close(); wsRef.current = null; } };
  }, []);

  return {
    messages, setMessages,
    status,
    sessionKey, setSessionKey,
    sessionLabel, setSessionLabel,
    sessionModel, setSessionModel,
    thinkingLevel, setThinkingLevel,
    sessions,
    loadingSessions,
    isLoadingHistory,
    isTyping,
    isStalled,
    lastHealth,
    latencyHistory,
    pulse,
    tpsData,
    hasNewMessages, setHasNewMessages,
    isSummarizing,
    isUpdatingLabel,
    fetchSessions,
    handleSelectSession,
    startNewSession: () => { 
      setSessionKey(null); 
      setMessages([]); 
      setSessionLabel(null); 
      setIsTyping(false);
      clearStallTimer();
      streamContentRef.current = '';
    },
    handleSend,
    handleStopGeneration,
    handleRegenerate,
    handleDeleteSession,
    handleDeleteGroup,
    handleClearAllHistory,
    handleSaveEdit,
    handleUpdateLabel,
    handleAutoSummarize,
    handleModelChange,
    handleThinkingLevelChange,
    sendRPC,
    connect,
    showScrollBtnRef
  };
};
