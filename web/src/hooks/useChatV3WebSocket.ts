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
  _sortTs?: number; // 💡 排序权重：毫秒级时间戳，用于消灭 UI 乱序
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
  const [thinkingLevel, setThinkingLevel] = useState<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'>('medium');
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
  const lastUpdateRef = useRef(0);
  const showScrollBtnRef = useRef(false);
  const summarizingSessionsRef = useRef<Set<string>>(new Set());

  // 💡 核心升级：按 sessionKey 隔离的后台状态存储
  const sessionCacheRef = useRef<Map<string, {
    fullText: string;
    runId?: string; 
    isTyping: boolean;
    startTime: number;
    firstTokenTime: number;
    ttftRecorded: boolean;
    tokenCount: number;
    tpsData: number[];
    lastUserMsg?: Message; // 💡 记录本轮对话的提问，防止切会话时因 DB 延迟导致提问“消失”或排在 AI 后面
  }>>(new Map());

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
      
      // 💡 核心防御：标题持久化锁。如果后端返回的 Label 是空的，但本地已有非空 Label，则强制保留本地的，防止闪退“未命名”
      const patchedList = list.map((s: any) => {
        if (s.key === sessionKeyRef.current && (!s.label || s.label.trim() === '') && sessionLabelRef.current) {
          return { ...s, label: sessionLabelRef.current };
        }
        return s;
      });
      
      setSessions(patchedList);

      // 💡 自动总结：刷新后识别未命名会话并后台生成标题
      if (!isSilent) {
        // 增加过滤条件，只有真正没名字的才进入总结流程
        const untitled = patchedList.filter((s: any) => !s.label || s.label === '未命名会话' || s.label === 'New Session' || s.label === '').slice(0, 15);
        if (untitled.length > 0) {
          setTimeout(async () => {
            for (const s of untitled) {
              const hRes = await sendRPC('chat.history', { sessionKey: s.key, limit: 10 });
              if (hRes.ok) {
                const raw = hRes.payload.messages || hRes.payload.items || [];
                if (raw.length >= 1) {
                  const msgs = raw.map((m: any) => ({
                    role: m.role === 'toolResult' ? 'assistant' : m.role,
                    content: formatMessageContent(m.content)
                  })).filter((m: any) => m.content);
                  
                  if (msgs.length > 0) {
                    autoSummarizeRef.current?.(msgs, true, s.key);
                  }
                }
              }
            }
          }, 500);
        }
      }
    }
    if (!isSilent) setLoadingSessions(false);
  }, [sendRPC, formatMessageContent]);

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
    const pSessionKey = payload.sessionKey || sessionKeyRef.current;
    if (!pSessionKey) return;

    // 💡 1. 确保缓存抽屉存在
    if (!sessionCacheRef.current.has(pSessionKey)) {
      sessionCacheRef.current.set(pSessionKey, {
        fullText: '', isTyping: true, startTime: Date.now(),
        firstTokenTime: 0, ttftRecorded: false, tokenCount: 0, tpsData: []
      });
    }
    const cache = sessionCacheRef.current.get(pSessionKey)!;

    if (payload.state === 'delta') {
      // 💡 只有当前会话才重置打字停顿计时器和显示通知
      if (pSessionKey === sessionKeyRef.current) {
        resetStallTimer();
        if (showScrollBtnRef.current) setHasNewMessages(true);
      }
      
      const now = Date.now();
      if (!cache.ttftRecorded) {
        cache.ttftRecorded = true;
        cache.firstTokenTime = now;
      }

      const messageObj = payload.message;
      if (!messageObj) return;

      const fullText = formatMessageContent(messageObj);
      if (!fullText.trim() && cache.fullText.trim()) return;

      // 💡 鲁棒性保护：包长度突降检测
      const oldLen = cache.fullText.length;
      if (oldLen > 50 && fullText.length < oldLen - 20) return;

      cache.fullText = fullText;
      cache.tokenCount = fullText.length;
      cache.isTyping = true;
      cache.runId = payload.runId; // 💡 同步 runId 到缓存

      // 💡 2. 状态分发：仅在活跃会话时推送 UI 更新
      if (pSessionKey === sessionKeyRef.current) {
        setIsTyping(true);
        if (now - lastUpdateRef.current > 64) {
          lastUpdateRef.current = now;
          const elapsedFromFirst = (now - cache.firstTokenTime) / 1000;
          const currentTPS = elapsedFromFirst > 0 ? (cache.tokenCount / elapsedFromFirst) : 0;
          const ttft = cache.firstTokenTime - cache.startTime;

          if (cache.tokenCount % 5 === 0) {
            setTpsData(prev => [...prev.slice(-19), currentTPS]);
          }

          setMessages(prev => {
            const targetIndex = prev.findLastIndex(m => m.runId === payload.runId) !== -1 
              ? prev.findLastIndex(m => m.runId === payload.runId)
              : prev.findLastIndex(m => m.role === 'assistant' && !m.runId);

            if (targetIndex !== -1) {
              const current = prev[targetIndex];
              const updated = { 
                ...current, 
                runId: payload.runId,
                content: fullText,
                metrics: { ...current.metrics, ttft, tps: currentTPS },
                _sortTs: current._sortTs // 💡 继承权重
              };
              const next = [...prev];
              next[targetIndex] = updated;
              // 💡 排序保险：考虑秒级精度撞车，User 优先
              return next.sort((a, b) => {
                const diff = (a._sortTs || 0) - (b._sortTs || 0);
                if (diff !== 0) return diff;
                const roleOrder: Record<string, number> = { 'system': 0, 'user': 1, 'assistant': 2 };
                return (roleOrder[a.role] || 0) - (roleOrder[b.role] || 0);
              });
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
      }
    } else if (payload.state === 'final' || payload.state === 'finished' || payload.state === 'done') {
        cache.isTyping = false;
        if (pSessionKey === sessionKeyRef.current) clearStallTimer();

        const now = Date.now();
        const duration = (now - cache.startTime) / 1000;
        const ttft = cache.ttftRecorded ? (cache.firstTokenTime - cache.startTime) : 0;
        const finalTPS = duration > 0 ? (cache.tokenCount / (duration - (ttft/1000))) : 0;

        const incomingContent = payload.message?.content ? formatMessageContent(payload.message.content) : cache.fullText;
        cache.fullText = incomingContent;

        if (pSessionKey === sessionKeyRef.current) {
          setMessages(prev => {
              const targetIndex = prev.findLastIndex(m => m.runId === payload.runId) !== -1 
                ? prev.findLastIndex(m => m.runId === payload.runId)
                : prev.findLastIndex(m => m.role === 'assistant' && !m.runId);

              if (targetIndex === -1) return prev;
              const last = prev[targetIndex];
              
              if (!incomingContent && last.content && last.content !== t('chat.thinking')) return prev;

              const next = [...prev];
              next[targetIndex] = { 
                  ...last, 
                  runId: payload.runId,
                  content: incomingContent,
                  metrics: { ...last.metrics, ttft, duration, tps: finalTPS },
                  _sortTs: last._sortTs // 💡 继承权重
              };
              // 💡 排序保险：考虑秒级精度撞车，User 优先
              return next.sort((a, b) => {
                const diff = (a._sortTs || 0) - (b._sortTs || 0);
                if (diff !== 0) return diff;
                const roleOrder: Record<string, number> = { 'system': 0, 'user': 1, 'assistant': 2 };
                return (roleOrder[a.role] || 0) - (roleOrder[b.role] || 0);
              });
              });

          setIsTyping(false);
          fetchSessions(true);
          setTimeout(() => inputAreaRef.current?.focus(), 100);
        }
        // 💡 哪怕是后台会话，也需要刷新列表以更新标题/摘要
        else {
          fetchSessions(true);
        }
    } else if (payload.state === 'error' || payload.state === 'failed') {
        cache.isTyping = false;
        if (pSessionKey === sessionKeyRef.current) {
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
          setTimeout(() => inputAreaRef.current?.focus(), 100);
        }
    }
  }, [resetStallTimer, clearStallTimer, fetchSessions, inputAreaRef, scrollRef, virtuosoRef, formatMessageContent, t]);

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

          const rawTs = new Date(item.createdAt || item.timestamp || Date.now()).getTime();

          return {
            id: item.id || `msg-${rawTs}-${Math.random().toString(36).substring(2, 7)}`,
            runId: item.runId,
            role: item.role === 'toolResult' ? 'assistant' : item.role,
            content: content || '',
            timestamp: new Date(rawTs).toLocaleTimeString(),
            metrics: item.metrics,
            _sortTs: rawTs // 💡 显式保留原始权重用于排序
          };
        }).filter((msg: any) => msg.content && msg.content.trim() !== '');
        
        // 💡 缝合逻辑：加载完历史后，从缓存中恢复“内存中还未持久化”的消息
        const cache = sessionCacheRef.current.get(key);
        if (cache) {
          // 1. 恢复 User 提问 (如果 DB 里还没存好)
          if (cache.lastUserMsg) {
            const hasUserMsg = history.some((m: any) => m.id === cache.lastUserMsg?.id || (m.role === 'user' && m.content === cache.lastUserMsg?.content));
            if (!hasUserMsg) {
              history.push(cache.lastUserMsg);
            }
          }

          // 2. 恢复 AI 回答
          if (cache.isTyping && cache.fullText) {
            const existingIndex = cache.runId ? history.findIndex((m: any) => m.runId === cache.runId) : -1;
            if (existingIndex !== -1) {
              history[existingIndex].content = cache.fullText;
            } else {
              history.push({
                id: `msg-ai-recovered-${Date.now()}`,
                role: 'assistant' as const,
                content: cache.fullText,
                timestamp: new Date().toLocaleTimeString(),
                _sortTs: (cache.lastUserMsg?._sortTs || Date.now()) + 1 // 💡 强锁：AI 必须排在 User 提问之后
              });
            }
            setIsTyping(true);
            resetStallTimer();
          } else {
            setIsTyping(false);
            clearStallTimer();
          }
        } else {
          setIsTyping(false);
          clearStallTimer();
        }
        
        // 💡 三次加固：绝对时序排序。如果时间戳相等（由于秒级精度），则强制 User 在 Assistant 之前
        const finalMessages = [...history].sort((a, b) => {
          const diff = (a._sortTs || 0) - (b._sortTs || 0);
          if (diff !== 0) return diff;
          // 如果时间戳完全一致，通过角色定胜负：user(-1) < assistant(1)
          const roleOrder: Record<string, number> = { 'system': 0, 'user': 1, 'assistant': 2 };
          return (roleOrder[a.role] || 0) - (roleOrder[b.role] || 0);
        });
        setMessages(finalMessages);

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
  }, [sendRPC, formatMessageContent, resetStallTimer, clearStallTimer]);

  const handleSelectSession = useCallback((key: string) => {
    if (key === sessionKey) return;
    setSessionKey(key);
    const s = sessions.find(x => x.key === key);
    if (s) {
      // 💡 只有当 s.label 确实有意义时才覆盖当前 sessionLabel，防止被列表里的“空”数据偷袭
      if (s.label && s.label.trim() !== '' && s.label !== '未命名会话' && s.label !== 'New Session') {
        setSessionLabel(s.label);
      }
      setSessionModel(s.model || '');
      if (key.startsWith('agent:')) {
        const parts = key.split(':');
        if (parts.length >= 2) setSelectedBot(`openclaw:${parts[1]}`);
      }
    }
    // 💡 状态切换：先尝试从缓存恢复 UI 状态，防止加载历史期间输入框“闪现”可用状态
    const cache = sessionCacheRef.current.get(key);
    if (cache) {
      setIsTyping(cache.isTyping);
      if (cache.isTyping) resetStallTimer(); else clearStallTimer();
    } else {
      setIsTyping(false);
      clearStallTimer();
    }

    loadSessionHistory(key);
    setHasNewMessages(false);
  }, [sessionKey, sessions, setSelectedBot, loadSessionHistory, clearStallTimer, resetStallTimer]);

  const handleUpdateLabel = useCallback(async (newLabel: string) => {
    if (!sessionKey || !newLabel.trim()) return;
    
    // 💡 核心保护：禁止平替主会话名称
    if (sessionKey === 'agent:main:main') {
      message.warning(t('chat.systemSessionNoRename', { defaultValue: '系统主会话名称不可修改' }));
      return;
    }

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
    
    // 💡 核心保护：禁止 AI 自动总结主会话
    if (activeKey === 'agent:main:main') {
      return;
    }

    // 💡 核心保护 2：如果已经有了“像样”的名字（不是空、也不是未命名标识），则不要去改它
    const existing = sessions.find(s => s.key === activeKey);
    const currentLabel = activeKey === sessionKey ? sessionLabel : existing?.label;
    if (currentLabel && currentLabel !== '未命名会话' && currentLabel !== 'New Session' && currentLabel.trim() !== '') {
      return;
    }

    // 💡 鲁棒性加固：检查是否已经在总结该会话，防止并发冲突
    if (!activeKey || targetMessages.length === 0 || summarizingSessionsRef.current.has(activeKey)) return;
    
    summarizingSessionsRef.current.add(activeKey);
    if (!targetKey) setIsSummarizing(true);
    
    // 💡 视觉修复：修正逻辑，如果是前台活跃会话且非静默模式，显示 Loading
    if (!silent) {
      message.loading({ 
        content: t('chat.summarizingTitle', { defaultValue: '正在生成标题...' }), 
        key: `summarizing-${activeKey}` 
      });
    }

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
          // 💡 视觉修复：仅在非静默模式下显示成功提示
          if (!silent) {
            message.success({ content: t('chat.titleSummarized'), key: `summarizing-${activeKey}` });
          }
          setSessions(prev => prev.map(s => s.key === activeKey ? { ...s, label: newTitle } : s));
        }
      }
    } catch (err) {
      if (!silent) console.error('Summarize error:', err);
    } finally {
      summarizingSessionsRef.current.delete(activeKey);
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

    let currentKey = sessionKey;
    if (!currentKey) {
      const res = await sendRPC('sessions.create', { agentId: selectedBot.replace('openclaw:', '') });
      if (res.ok) {
        currentKey = res.payload.key;
        setSessionKey(currentKey);
        await sendRPC('sessions.patch', { key: currentKey, thinkingLevel, model: sessionModel });
        fetchSessions();
      } else {
        message.error(t('chat.failedToCreateSession') || 'Failed to create session: ' + (res.error?.message || 'Unknown'));
        setIsTyping(false);
        return;
      }
    }

    if (currentKey) {
      let finalContent = text;
      if (attachedFiles && attachedFiles.length > 0) {
        const fileLinks = attachedFiles.map(f => {
          const isImage = f.ext.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
          return isImage ? `\n![${f.filename}](${f.thumbUrl || f.url} \"${f.url}\")\n(File path: ${f.path})` : `\n[${f.filename}](${f.url}) (File path: ${f.path})`;
        }).join('');
        finalContent += fileLinks + `\n\n**System Note for Expert:** The user has uploaded files. Access them via absolute \"File path\" provided.`;
      }

      const newUserMsg: Message = { 
        id: `msg-${Date.now()}`, 
        role: 'user', 
        content: finalContent, 
        timestamp: new Date().toLocaleTimeString(),
        _sortTs: Date.now() // 💡 分配用户消息权重
      };

      const aiSortTs = newUserMsg._sortTs! + 1; // 💡 强制 AI 紧随其后
      const assistantInitialMsg = text === '/stop' ? t('chat.terminated') : t('chat.thinking');
      const aiPlaceholderMsg: Message = { 
        id: `msg-ai-${Date.now()}`, 
        role: 'assistant', 
        content: assistantInitialMsg, 
        timestamp: new Date().toLocaleTimeString(),
        _sortTs: aiSortTs // 💡 分配 AI 占位符权重
      };

      // 💡 初始化该会话的缓存状态
      sessionCacheRef.current.set(currentKey, {
        fullText: '',
        isTyping: true,
        startTime: Date.now(),
        firstTokenTime: 0,
        ttftRecorded: false,
        tokenCount: 0,
        tpsData: [],
        lastUserMsg: newUserMsg
      });

      // 💡 一次性推入 User 和 AI 占位消息，确保时序正确
      setMessages(prev => [...prev, newUserMsg, aiPlaceholderMsg]);
      resetStallTimer();

      setTimeout(() => {
        virtuosoRef.current?.scrollToIndex({ 
          index: messagesCountRef.current + 1,
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
        // 💡 握手回填：将 RPC 返回的 runId 立即同步到缓存和消息对象中
        const cache = sessionCacheRef.current.get(currentKey);
        if (cache) cache.runId = res.payload.runId;

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
        const cache = sessionCacheRef.current.get(currentKey);
        if (cache) cache.isTyping = false;
      } else if (text === '/stop') {
        setIsTyping(false);
        clearStallTimer();
        const cache = sessionCacheRef.current.get(currentKey);
        if (cache) cache.isTyping = false;
      }
    } else {
      setIsTyping(false);
      message.error('Session key missing');
    }
  }, [status, sessionKey, selectedBot, thinkingLevel, sessionModel, sendRPC, fetchSessions, resetStallTimer, clearStallTimer, t, isTyping, messagesCountRef, virtuosoRef]);

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
    
    if (sessionKey) {
      const cache = sessionCacheRef.current.get(sessionKey);
      if (cache) {
        cache.isTyping = false;
        cache.fullText = '';
      }
    }

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
  }, [clearStallTimer, handleSend, t, sessionKey]);

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
            }
            fetchSessions();
          } else {
            // 💡 优化：确保透出具体的报错原因，方便定位是网络问题还是权限问题
            const errMsgRaw = res.error?.message || res.error || 'Gateway Timeout or Unknown Error';
            let errMsg = typeof errMsgRaw === 'string' ? errMsgRaw : JSON.stringify(errMsgRaw);
            
            // 💡 翻译优化：针对主会话不可删除的后端提示做特定翻译
            if (errMsg.includes('Cannot delete the main session')) {
              errMsg = t('chat.cannotDeleteMainSession');
            }
            
            message.error({ 
              content: `${t('common.error')}: ${errMsg}`, 
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
          const deletableKeys = sessionKeys.filter(k => k !== 'agent:main:main');
          await Promise.all(deletableKeys.map(key => sendRPC('sessions.delete', { key })));
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
          const deletableSessions = sessions.filter(s => s.key !== 'agent:main:main');
          await Promise.all(deletableSessions.map(s => sendRPC('sessions.delete', { key: s.key })));
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

  const handleThinkingLevelChange = useCallback(async (newLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh') => {
    setThinkingLevel(newLevel);
    if (!sessionKey) return;
    const res = await sendRPC('sessions.patch', { key: sessionKey, thinkingLevel: newLevel });
    if (res.ok) {
      message.success(t('chat.thinkingLevelUpdated', { defaultValue: '思考等级已更新' }));
    }
  }, [sessionKey, sendRPC, t]);

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
      
      // 💡 视觉反馈：提示已就绪并自动聚焦输入框
      message.info({ content: t('chat.newSessionReady', { defaultValue: '新会话已就绪' }), key: 'newSessionReady' });
      setTimeout(() => inputAreaRef.current?.focus(), 100);
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
