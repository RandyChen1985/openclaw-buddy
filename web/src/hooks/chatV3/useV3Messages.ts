import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message as antdMessage } from 'antd';
import type { FileInfo, Message } from '../useChatV3WebSocket';

const MAX_SESSION_CACHE_ENTRIES = 30;

type SessionStreamCache = {
  fullText: string;
  runId?: string;
  isTyping: boolean;
  startTime: number;
  firstTokenTime: number;
  ttftRecorded: boolean;
  tokenCount: number;
  tpsData: number[];
  lastUserMsg?: Message;
  lastTouched: number;
};

export interface UseV3MessagesParams {
  t: any;
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';
  sessionKey: string | null;
  setSessionKey: (key: string | null) => void;
  selectedBot: string;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  sessionModel: string;
  sendRPC: (method: string, params: any) => Promise<any>;
  fetchSessions: (isSilent?: boolean) => Promise<void> | void;
  inputAreaRef: React.RefObject<any>;
  virtuosoRef: React.RefObject<any>;
  scrollRef: React.RefObject<HTMLDivElement>;
  showScrollBtnRef: React.MutableRefObject<boolean>;
}

/**
 * v3 消息层：负责消息列表状态、流式 delta/final/error 合并、历史加载、以及发送/停止/重试/编辑重发等动作。
 */
export function useV3Messages({
  t,
  status,
  sessionKey,
  setSessionKey,
  selectedBot,
  thinkingLevel,
  sessionModel,
  sendRPC,
  fetchSessions,
  inputAreaRef,
  virtuosoRef,
  scrollRef,
  showScrollBtnRef
}: UseV3MessagesParams) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isStalled, setIsStalled] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [tpsData, setTpsData] = useState<number[]>([]);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [typingSessionKeys, setTypingSessionKeys] = useState<string[]>([]);

  const typingSessionsRef = useRef<Set<string>>(new Set());

  /**
   * 标记某个 session 是否处于“正在生成/流式推送中”。
   * 用于会话列表显示“正在编辑”的动画提示。
   */
  const markSessionTyping = useCallback((key: string, typing: boolean) => {
    if (!key) return;
    const set = typingSessionsRef.current;
    const had = set.has(key);
    if (typing) {
      if (had) return;
      set.add(key);
    } else {
      if (!had) return;
      set.delete(key);
    }
    setTypingSessionKeys(Array.from(set));
  }, []);

  const sessionKeyRef = useRef<string | null>(null);
  useEffect(() => { sessionKeyRef.current = sessionKey; }, [sessionKey]);

  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const messagesCountRef = useRef(messages.length);
  useEffect(() => { messagesCountRef.current = messages.length; }, [messages.length]);

  const stallTimerRef = useRef<any>(null);
  const lastUpdateRef = useRef(0);
  const streamingAssistantIndexRef = useRef<number | null>(null);
  const historyRequestSeqRef = useRef(0);
  const latestHistoryRequestRef = useRef(0);
  const chatEventSeenSinceSendRef = useRef(false);
  const hadTypingSinceSendRef = useRef(false);

  const sessionCacheRef = useRef<Map<string, SessionStreamCache>>(new Map());
  // 流结束后的冷却窗口：防止 session.message 事件在流刚结束时追加重复消息
  const streamEndGraceRef = useRef<{ key: string; until: number } | null>(null);
  // 已请求停止：从点击"停止"到收到 aborted/final 之间，屏蔽后续 delta 写入
  const abortRequestedRef = useRef<{ key: string; ts: number } | null>(null);

  const injectDiagnosticIfNoChatEvent = useCallback((reason: string) => {
    if (!hadTypingSinceSendRef.current) return;
    if (chatEventSeenSinceSendRef.current) return;

    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== 'assistant') return prev;

      const diag = `> **⚠️ 未收到流式事件**\n> 可能原因：网关未推送 chat.event、会话任务卡死、或请求未真正进入生成。\n> 建议：点击重试 / 新建会话 / 重新连接网关。\n> (${reason})`;

      const content = (last.content === '思考中...' || last.content === t('chat.thinking') || !last.content)
        ? diag
        : `${last.content}\n\n${diag}`;

      return [...prev.slice(0, -1), { ...last, content }];
    });
  }, [t]);

  const touchAndPruneSessionCache = useCallback((key: string, cache: SessionStreamCache) => {
    cache.lastTouched = Date.now();
    sessionCacheRef.current.set(key, cache);
    if (sessionCacheRef.current.size <= MAX_SESSION_CACHE_ENTRIES) return;

    const victims = [...sessionCacheRef.current.entries()]
      .sort((a, b) => a[1].lastTouched - b[1].lastTouched)
      .slice(0, sessionCacheRef.current.size - MAX_SESSION_CACHE_ENTRIES);

    victims.forEach(([victimKey]) => {
      sessionCacheRef.current.delete(victimKey);
    });
  }, []);

  const getOrCreateSessionCache = useCallback((key: string): SessionStreamCache => {
    const existing = sessionCacheRef.current.get(key);
    if (existing) {
      touchAndPruneSessionCache(key, existing);
      return existing;
    }
    const created: SessionStreamCache = {
      fullText: '',
      isTyping: true,
      startTime: Date.now(),
      firstTokenTime: 0,
      ttftRecorded: false,
      tokenCount: 0,
      tpsData: [],
      lastTouched: Date.now()
    };
    touchAndPruneSessionCache(key, created);
    return created;
  }, [touchAndPruneSessionCache]);

  /**
   * 清除 stall 计时器，并同步 `isStalled` 标记。
   */
  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    setIsStalled(false);
  }, []);

  /**
   * 重置 stall 计时器：若在指定时间内未收到流式更新，则将 UI 标记为 stalled。
   */
  const resetStallTimer = useCallback(() => {
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => {
      setIsStalled(true);
    }, 3500);
  }, [clearStallTimer]);

  /**
   * 将多种 content 结构统一格式化为 Markdown 文本，供渲染层消费。
   */
  const formatMessageContent = useCallback((msg: any, _depth = 0): string => {
    if (!msg) return '';
    if (_depth > 5) return typeof msg === 'string' ? msg : JSON.stringify(msg);

    const content = (msg.content !== undefined && msg.content !== null) ? msg.content : msg;
    const topThought = msg.thought || msg.thinking || msg.reasoning || '';

    let prefix = '';
    if (topThought) {
      prefix = `> :::thinking\n> ${String(topThought).replace(/\n/g, '\n> ')}\n> :::\n\n`;
    }

    let body = '';
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (trimmed === '[]' || trimmed === '{}') body = '';
      else if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          body = formatMessageContent(parsed, _depth + 1);
        } catch {
          body = content;
        }
      } else {
        body = content;
      }
    } else if (Array.isArray(content)) {
      body = content.map((c: any) => {
        let matched = false;

        let thinkingPart = '';
        if (c.thinking || c.thought || c.reasoning || c.type === 'thinking') {
          const thought = c.thinking || c.thought || c.reasoning || c.content || '';
          thinkingPart = `> :::thinking\n> ${String(thought).replace(/\n/g, '\n> ')}\n> :::\n\n`;
          matched = true;
        }

        let toolCallPart = '';
        if (c.type === 'toolCall' || c.toolCall || c.tool_call) {
          const tc = c.toolCall || c.tool_call || c;
          const name = tc.name || tc.function?.name || 'unknown_tool';
          const args = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {});
          toolCallPart = `> :::toolCall\n> **${name}**\n> \`\`\`json\n> ${args}\n> \`\`\`\n> :::\n\n`;
          matched = true;
        }

        let toolResultPart = '';
        if (c.type === 'toolResult' || c.toolResult || c.tool_result) {
          const tr = c.toolResult || c.tool_result || c;
          const toolName = tr.toolName || tr.tool_name || tr.name || '';
          const result = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content || tr.result || {});
          toolResultPart = `> :::toolResult\n> ${toolName ? `**${toolName}**\n> ` : ''}\`\`\`json\n> ${result}\n> \`\`\`\n> :::\n\n`;
          matched = true;
        }

        const textPart = c.text || (typeof c.content === 'string' ? c.content : '');
        if (textPart) matched = true;

        let fallbackPart = '';
        if (!matched && typeof c === 'object' && c !== null && Object.keys(c).length > 0) {
          fallbackPart = `\n> :::warning 未知消息块 (${c.type || 'unknown'})\n> \`\`\`json\n> ${JSON.stringify(c, null, 2).split('\n').join('\n> ')}\n> \`\`\`\n> :::\n\n`;
        }

        return thinkingPart + toolCallPart + toolResultPart + fallbackPart + textPart;
      }).join('');
    } else if (typeof content === 'object' && content !== null) {
      body = formatMessageContent([content], _depth + 1);
    } else {
      body = String(content);
    }

    return prefix + body;
  }, []);

  /**
   * 处理 chat 流式事件：delta/final/error 合并到 messages，并维护性能优化索引。
   */
  const handleChatDelta = useCallback((payload: any) => {
    const pSessionKey = payload.sessionKey || sessionKeyRef.current;
    if (!pSessionKey) return;
    const cache = getOrCreateSessionCache(pSessionKey);
    chatEventSeenSinceSendRef.current = true;

    if (payload.state === 'thought' || payload.state === 'thinking') {
      const abortReq = abortRequestedRef.current;
      if (abortReq && abortReq.key === pSessionKey) return;
      markSessionTyping(pSessionKey, true);
      if (pSessionKey === sessionKeyRef.current) {
        resetStallTimer();
        setIsTyping(true);
        const thinkLabel = t('chat.deepThinking', { defaultValue: '深度思考中...' });
        setMessages(prev => {
          const idx = streamingAssistantIndexRef.current;
          const targetIdx = (idx !== null && idx >= 0 && idx < prev.length) ? idx : prev.findLastIndex(m => m.role === 'assistant');
          if (targetIdx === -1) return prev;
          const msg = prev[targetIdx];
          if (msg.content && msg.content !== t('chat.thinking') && msg.content !== thinkLabel) return prev;
          const next = [...prev];
          next[targetIdx] = { ...msg, content: thinkLabel };
          return next;
        });
      }
      return;
    }

    if (payload.state === 'delta') {
      // 用户已请求停止，丢弃 abort 生效前仍在途的 delta
      const abortReq = abortRequestedRef.current;
      if (abortReq && abortReq.key === pSessionKey) return;

      markSessionTyping(pSessionKey, true);
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
      if (fullText === cache.fullText) return;
      if (!fullText.trim() && cache.fullText.trim()) return;

      // 防回退保护：新文本不应大幅缩短（可能是乱序 delta），但允许适度收缩（如 thinking block 结束后）
      const oldLen = cache.fullText.length;
      if (oldLen > 100 && fullText.length < oldLen * 0.5) return;

      cache.fullText = fullText;
      cache.tokenCount = fullText.length;
      cache.isTyping = true;
      cache.runId = payload.runId;
      touchAndPruneSessionCache(pSessionKey, cache);

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
            const idx = streamingAssistantIndexRef.current;
            if (idx === null || idx < 0 || idx >= prev.length) {
              const runIdIndex = prev.findLastIndex(m => m.runId === payload.runId);
              const fallbackIndex = runIdIndex !== -1 ? runIdIndex : prev.findLastIndex(m => m.role === 'assistant' && !m.runId);
              if (fallbackIndex === -1) return prev;
              const next = [...prev];
              const current = next[fallbackIndex];
              next[fallbackIndex] = {
                ...current,
                runId: payload.runId,
                content: fullText,
                metrics: { ...current.metrics, ttft, tps: currentTPS },
                _sortTs: current._sortTs
              };
              streamingAssistantIndexRef.current = fallbackIndex;
              return next;
            }

            const next = [...prev];
            const current = next[idx];
            next[idx] = {
              ...current,
              runId: payload.runId,
              content: fullText,
              metrics: { ...current.metrics, ttft, tps: currentTPS },
              _sortTs: current._sortTs
            };
            return next;
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
      const wasUserAbort = abortRequestedRef.current?.key === pSessionKey;
      abortRequestedRef.current = null;
      cache.isTyping = false;
      touchAndPruneSessionCache(pSessionKey, cache);
      markSessionTyping(pSessionKey, false);
      streamEndGraceRef.current = { key: pSessionKey, until: Date.now() + 3000 };
      if (pSessionKey === sessionKeyRef.current) clearStallTimer();

      // 用户已主动停止且 UI 已标记"已手动停止"，不再用服务端 final 覆盖
      if (wasUserAbort) {
        if (pSessionKey === sessionKeyRef.current) {
          setIsTyping(false);
          streamingAssistantIndexRef.current = null;
          fetchSessions(true);
        } else {
          fetchSessions(true);
        }
      } else {
        const now = Date.now();
        const duration = (now - cache.startTime) / 1000;
        const ttft = cache.ttftRecorded ? (cache.firstTokenTime - cache.startTime) : 0;
        const generationDuration = duration - (ttft / 1000);
        const finalTPS = generationDuration > 0.05 ? (cache.tokenCount / generationDuration) : 0;

        // final 阶段网关可能返回完整 message 对象（含 thinking/tool 块），必须走统一格式化避免丢内容
        const incomingContent = payload.message ? formatMessageContent(payload.message) : cache.fullText;
        cache.fullText = incomingContent;

        if (pSessionKey === sessionKeyRef.current) {
          setMessages(prev => {
            const idx = streamingAssistantIndexRef.current;
            const runIdIndex = prev.findLastIndex(m => m.runId === payload.runId);
            const targetIndex = (idx !== null && idx >= 0 && idx < prev.length) ? idx : (runIdIndex !== -1 ? runIdIndex : prev.findLastIndex(m => m.role === 'assistant' && !m.runId));
            if (targetIndex === -1) return prev;

            const last = prev[targetIndex];
            if (!incomingContent && last.content && last.content !== t('chat.thinking')) return prev;

            const next = [...prev];
            next[targetIndex] = {
              ...last,
              runId: payload.runId,
              content: incomingContent,
              metrics: { ...last.metrics, ttft, duration, tps: finalTPS },
              _sortTs: last._sortTs
            };
            return next;
          });

          setIsTyping(false);
          streamingAssistantIndexRef.current = null;
          fetchSessions(true);
          setTimeout(() => inputAreaRef.current?.focus(), 100);
        } else {
          fetchSessions(true);
        }
      }
    } else if (payload.state === 'aborted') {
      // 判断是否由 handleStopGeneration 发起的 abort（已在 UI 侧处理过消息标记）
      const wasUserAbort = abortRequestedRef.current?.key === pSessionKey;
      abortRequestedRef.current = null;
      cache.isTyping = false;
      touchAndPruneSessionCache(pSessionKey, cache);
      markSessionTyping(pSessionKey, false);
      streamEndGraceRef.current = { key: pSessionKey, until: Date.now() + 3000 };
      if (pSessionKey === sessionKeyRef.current) {
        clearStallTimer();
        if (!wasUserAbort) {
          const partialContent = payload.message ? formatMessageContent(payload.message) : cache.fullText;
          setMessages(prev => {
            const idx = streamingAssistantIndexRef.current;
            const targetIndex = (idx !== null && idx >= 0 && idx < prev.length) ? idx : prev.findLastIndex(m => m.role === 'assistant');
            if (targetIndex === -1) return prev;
            const last = prev[targetIndex];
            const label = t('chat.manuallyStopped', { defaultValue: '已手动停止' });
            const content = partialContent && partialContent !== t('chat.thinking') && partialContent !== t('chat.deepThinking', { defaultValue: '深度思考中...' })
              ? `${partialContent} (${label})`
              : label;
            const next = [...prev];
            next[targetIndex] = { ...last, content };
            return next;
          });
        }
        setIsTyping(false);
        streamingAssistantIndexRef.current = null;
        fetchSessions(true);
        setTimeout(() => inputAreaRef.current?.focus(), 100);
      }
    } else if (payload.state === 'error' || payload.state === 'failed') {
      const wasUserAbort = abortRequestedRef.current?.key === pSessionKey;
      abortRequestedRef.current = null;
      cache.isTyping = false;
      touchAndPruneSessionCache(pSessionKey, cache);
      markSessionTyping(pSessionKey, false);
      streamEndGraceRef.current = { key: pSessionKey, until: Date.now() + 3000 };
      if (pSessionKey === sessionKeyRef.current) {
        clearStallTimer();
        // 用户已主动停止，不追加错误信息（避免覆盖"已手动停止"）
        if (!wasUserAbort) {
          const errorMsg = payload.message?.content || payload.errorMessage || payload.error?.message || payload.error || t('chat.streamFailedDefault');
          const errorKind = payload.errorKind as string | undefined;

          const errorKindLabels: Record<string, string> = {
            'context_length': t('chat.errorContextLength', { defaultValue: '上下文长度超限，建议压缩会话或新建对话' }),
            'rate_limit': t('chat.errorRateLimit', { defaultValue: '请求频率过高，请稍后重试' }),
            'refusal': t('chat.errorRefusal', { defaultValue: '内容被模型拒绝生成' }),
            'timeout': t('chat.errorTimeout', { defaultValue: '推理超时，请重试或简化问题' }),
          };
          const kindHint = errorKind && errorKindLabels[errorKind] ? `\n> 💡 ${errorKindLabels[errorKind]}` : '';

          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant') return prev;

            const errMsgFormatted = typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg);
            const content = last.content === '思考中...' || last.content === t('chat.thinking') || !last.content
              ? `> **⚠️ 异常或错误**\n> ${errMsgFormatted}${kindHint}`
              : last.content + `\n\n> **⚠️ 生成被中断**\n> ${errMsgFormatted}${kindHint}`;

            return [...prev.slice(0, -1), { ...last, content }];
          });
        }
        setIsTyping(false);
        streamingAssistantIndexRef.current = null;
        setTimeout(() => inputAreaRef.current?.focus(), 100);
      }
    }
  }, [clearStallTimer, fetchSessions, formatMessageContent, getOrCreateSessionCache, inputAreaRef, markSessionTyping, resetStallTimer, scrollRef, showScrollBtnRef, t, touchAndPruneSessionCache, virtuosoRef]);

  /**
   * 处理审批请求事件：将审批卡片以 Markdown block 注入到消息流中，确保 UI 一定可见。
   *
   * 规则：
   * - 若最后一条是 assistant，则追加 block 到该消息（去重：slug 已存在则忽略）
   * - 否则追加一条新的 assistant 消息承载审批卡片
   */
  const handleApprovalRequested = useCallback((payload: any) => {
    if (!payload) return;
    const evtKey = payload.sessionKey;
    if (evtKey && evtKey !== sessionKeyRef.current) return;
    const { id, request } = payload;
    const slug = (id || '').toString().substring(0, 8);
    const command = request?.command || '';
    if (!slug || !command) return;

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
      const now = Date.now();
      const newMsg: Message = {
        id: `msg-approval-${now}`,
        role: 'assistant',
        content: approvalBlock,
        timestamp: new Date(now).toLocaleTimeString(),
        _sortTs: now
      };
      return [...prev, newMsg];
    });

    // 审批出现时应解除 typing，并清理 stall 标记，避免 UI 卡在“生成中”
    setIsTyping(false);
    streamingAssistantIndexRef.current = null;
    clearStallTimer();
  }, [clearStallTimer, t]);

  /**
   * 处理审批结果事件：更新消息中对应审批卡片的状态（approved/denied）。
   */
  const handleApprovalResolved = useCallback((payload: any) => {
    if (!payload) return;
    const { id, decision } = payload;
    const slug = (id || '').toString().substring(0, 8);
    if (!slug) return;

    const decisionLabels: Record<string, string> = {
      'approved': '✅ 已批准',
      'allow-once': '✅ 已批准(单次)',
      'denied': '❌ 已拒绝',
      'rejected': '❌ 已拒绝',
      'timeout': '⏱️ 已超时',
    };
    const label = decisionLabels[decision] || (decision === 'approved' ? '✅ 已批准' : `⚠️ ${decision || '未知'}`);

    setMessages(prev => {
      const idx = prev.findIndex(m => m.role === 'assistant' && m.content.includes(slug));
      if (idx === -1) return prev;
      const msg = prev[idx];
      if (msg.content.includes(label)) return prev;
      const next = [...prev];
      next[idx] = {
        ...msg,
        content: msg.content.replace(
          new RegExp(`(> :::approval\\n> \\*\\*${slug}\\*\\*)`),
          `$1 — ${label}`
        )
      };
      return next;
    });
  }, []);

  /**
   * 处理 session.message 事件：网关 transcript 更新推送。
   * 仅在当前会话且非流式生成期间追加新消息（避免与 chat delta 流冲突）。
   */
  const handleSessionMessage = useCallback((payload: any) => {
    if (!payload) return;
    const { sessionKey: evtKey, message: msg } = payload;
    if (!evtKey || evtKey !== sessionKeyRef.current) return;
    if (!msg || !msg.role) return;
    if (typingSessionsRef.current.has(evtKey)) return;

    // 流刚结束的冷却窗口内忽略 session.message，避免 transcript 推送追加重复消息
    const grace = streamEndGraceRef.current;
    if (grace && grace.key === evtKey && Date.now() < grace.until) return;

    const content = formatMessageContent(msg.content);
    if (!content || !content.trim()) return;

    const msgId = msg.id || payload.messageId || `msg-sm-${Date.now()}`;

    setMessages(prev => {
      if (prev.some(m => m.id === msgId)) return prev;
      // 内容级去重：如果最近 3 条已有完全相同内容，跳过
      const tail = prev.slice(-3);
      if (tail.some(m => m.content === content)) return prev;
      const rawTs = new Date(msg.createdAt || msg.timestamp || Date.now()).getTime();
      return [...prev, {
        id: msgId,
        runId: msg.runId,
        role: msg.role === 'toolResult' ? 'assistant' : msg.role,
        content,
        timestamp: new Date(rawTs).toLocaleTimeString(),
        _sortTs: rawTs
      } as Message];
    });
  }, [formatMessageContent]);

  /**
   * 处理 session.tool 事件：展示工具调用进度。
   * phase=start 时追加工具调用标记，phase=end/error 时更新状态。
   */
  const handleSessionTool = useCallback((payload: any) => {
    if (!payload) return;
    const { sessionKey: evtKey, data: toolData } = payload;
    if (!evtKey || evtKey !== sessionKeyRef.current) return;
    if (!toolData) return;

    const phase = toolData.phase as string;
    const toolName = toolData.toolName || toolData.name || 'tool';
    const toolId = toolData.toolCallId || toolData.id || '';
    const marker = toolId ? `tool:${toolId}` : `tool:${toolName}`;

    if (phase === 'start') {
      const block = `\n\n> 🔧 \`${toolName}\` 执行中…`;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        if (last.content.includes(marker)) return prev;
        const newContent = (last.content === t('chat.thinking') || last.content === t('chat.deepThinking', { defaultValue: '深度思考中...' }) || !last.content)
          ? block
          : `${last.content}${block}`;
        return [...prev.slice(0, -1), { ...last, content: `${newContent}<!-- ${marker} -->` }];
      });
    } else if (phase === 'end' || phase === 'error') {
      const statusIcon = phase === 'end' ? '✅' : '❌';
      setMessages(prev => {
        const idx = prev.findLastIndex(m => m.role === 'assistant' && m.content.includes(marker));
        if (idx === -1) return prev;
        const msg = prev[idx];
        const updated = msg.content
          .replace(`> 🔧 \`${toolName}\` 执行中…`, `> ${statusIcon} \`${toolName}\` ${phase === 'end' ? '完成' : '失败'}`)
          .replace(`<!-- ${marker} -->`, '');
        const next = [...prev];
        next[idx] = { ...msg, content: updated };
        return next;
      });
    }
  }, [t]);

  /**
   * 统一处理网关 event（除 health/connect.challenge/sessions.changed 外）。
   *
   * - tick/presence: 噪声事件，忽略
   * - chat: 转发到流式处理
   * - exec.approval.requested: 注入审批卡片
   * - agent(blocked): 解除 typing/stall，避免 UI 卡住
   */
  const handleGatewayEvent = useCallback((data: any) => {
    if (!data || data.type !== 'event') return;
    const evt = data.event;
    if (!evt) return;

    if (evt === 'tick' || evt === 'presence') return;
    if (evt === 'chat') {
      handleChatDelta(data.payload);
      return;
    }
    if (evt === 'session.message') {
      handleSessionMessage(data.payload);
      return;
    }
    if (evt === 'exec.approval.requested') {
      handleApprovalRequested(data.payload);
      return;
    }
    if (evt === 'exec.approval.resolved') {
      handleApprovalResolved(data.payload);
      return;
    }
    if (evt === 'session.tool') {
      handleSessionTool(data.payload);
      return;
    }
    if (evt === 'agent') {
      const { stream, data: agentData, sessionKey: agentSessionKey } = data.payload || {};
      const effectiveKey = agentSessionKey || sessionKeyRef.current;

      if (stream === 'item' && agentData?.status === 'blocked') {
        setIsTyping(false);
        clearStallTimer();
        streamingAssistantIndexRef.current = null;
      }

      if (stream === 'lifecycle.start') {
        if (effectiveKey) markSessionTyping(effectiveKey, true);
        if (effectiveKey === sessionKeyRef.current) {
          setIsTyping(true);
          resetStallTimer();
        }
      }

      if (stream === 'lifecycle.end') {
        if (effectiveKey) markSessionTyping(effectiveKey, false);
        if (effectiveKey === sessionKeyRef.current) {
          setIsTyping(false);
          clearStallTimer();
          streamingAssistantIndexRef.current = null;
        }
      }

      if (stream === 'lifecycle.error') {
        if (effectiveKey) markSessionTyping(effectiveKey, false);
        if (effectiveKey === sessionKeyRef.current) {
          clearStallTimer();
          setIsTyping(false);
          streamingAssistantIndexRef.current = null;
          const errMsg = agentData?.error?.message || agentData?.message || 'Agent error';
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant') return prev;
            const content = (!last.content || last.content === t('chat.thinking') || last.content === t('chat.deepThinking', { defaultValue: '深度思考中...' }))
              ? `> **⚠️ Agent 错误**\n> ${errMsg}`
              : `${last.content}\n\n> **⚠️ Agent 错误**\n> ${errMsg}`;
            return [...prev.slice(0, -1), { ...last, content }];
          });
        }
      }

      if (stream === 'tool') {
        if (effectiveKey === sessionKeyRef.current) {
          resetStallTimer();
        }
      }

      return;
    }
    if (evt === 'shutdown') {
      const reason = data.payload?.reason || data.payload?.message || '';
      const delay = data.payload?.delay ?? data.payload?.gracePeriodMs;
      const delayStr = typeof delay === 'number' && delay > 0 ? `（${Math.ceil(delay / 1000)}s 后断开）` : '';
      antdMessage.warning({
        content: t('chat.shutdownNotice', { defaultValue: `网关即将关闭${delayStr}${reason ? '：' + reason : ''}，连接将自动重建` }),
        duration: 8,
        key: 'gateway-shutdown',
      });
      return;
    }
  }, [clearStallTimer, handleApprovalRequested, handleApprovalResolved, handleChatDelta, handleSessionMessage, handleSessionTool, markSessionTyping, resetStallTimer, t]);

  /**
   * 加载会话历史并写入 messages；同时用 sessionCacheRef 缝合 DB 未落盘的临时消息。
   */
  const loadSessionHistory = useCallback(async (key: string) => {
    const requestId = ++historyRequestSeqRef.current;
    latestHistoryRequestRef.current = requestId;
    setIsLoadingHistory(true);
    streamingAssistantIndexRef.current = null;

    const res = await sendRPC('chat.history', { sessionKey: key, limit: 500 });
    const isActiveRequest = () =>
      latestHistoryRequestRef.current === requestId && sessionKeyRef.current === key;

    if (!res.ok) {
      if (latestHistoryRequestRef.current === requestId) {
        setIsLoadingHistory(false);
      }
      return;
    }

    const items = (res.payload.messages || res.payload.items || [])
      .sort((a: any, b: any) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
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
        _sortTs: rawTs
      } as Message;
    }).filter((msg: any) => msg.content && msg.content.trim() !== '');

    let shouldKeepTyping = false;
    const cache = sessionCacheRef.current.get(key);
    if (cache) {
      touchAndPruneSessionCache(key, cache);
      let userMsgSortTs = cache.lastUserMsg?._sortTs || Date.now();
      if (cache.lastUserMsg) {
        const dbUserMsg = history.find((m: any) => m.id === cache.lastUserMsg?.id || (m.role === 'user' && m.content === cache.lastUserMsg?.content));
        if (!dbUserMsg) {
          history.push(cache.lastUserMsg);
        } else {
          userMsgSortTs = (dbUserMsg as any)._sortTs || userMsgSortTs;
        }
      }
      if (cache.isTyping && cache.fullText) {
        const existingIndex = cache.runId ? history.findIndex((m: any) => m.runId === cache.runId) : -1;
        if (existingIndex !== -1) {
          (history[existingIndex] as any).content = cache.fullText;
        } else {
          history.push({
            id: `msg-ai-recovered-${Date.now()}`,
            role: 'assistant' as const,
            content: cache.fullText,
            timestamp: new Date().toLocaleTimeString(),
            _sortTs: userMsgSortTs + 1
          } as Message);
        }
        shouldKeepTyping = true;
      }
    }

    const roleOrder: Record<string, number> = { system: 0, user: 1, assistant: 2 };
    const finalMessages = [...history].sort((a: any, b: any) => {
      const diff = (a._sortTs || 0) - (b._sortTs || 0);
      if (diff !== 0) return diff;
      return (roleOrder[a.role] || 0) - (roleOrder[b.role] || 0);
    });

    if (!isActiveRequest()) {
      if (latestHistoryRequestRef.current === requestId) setIsLoadingHistory(false);
      return;
    }

    if (shouldKeepTyping) {
      setIsTyping(true);
      resetStallTimer();
    } else {
      setIsTyping(false);
      clearStallTimer();
    }
    setMessages(finalMessages);

    if (history.length > 0) {
      setTimeout(() => {
        if (!isActiveRequest()) return;
        virtuosoRef.current?.scrollToIndex({ index: history.length - 1, align: 'end', behavior: 'auto' });
      }, 50);
    }
    setIsLoadingHistory(false);
  }, [clearStallTimer, formatMessageContent, resetStallTimer, sendRPC, touchAndPruneSessionCache, virtuosoRef]);

  /**
   * 发送消息：必要时创建会话并写入初始占位消息，然后向网关发起 chat.send。
   */
  const handleSend = useCallback(async (content?: any, attachedFiles?: FileInfo[]) => {
    const text = (typeof content === 'string' ? content : '').trim();
    if (isTyping) return;
    if ((!text && (!attachedFiles || attachedFiles.length === 0)) || status !== 'authenticated') return;

    abortRequestedRef.current = null;
    setIsTyping(true);
    setTpsData([]);
    chatEventSeenSinceSendRef.current = false;
    hadTypingSinceSendRef.current = true;

    let currentKey = sessionKey;
    if (!currentKey) {
      const res = await sendRPC('sessions.create', { agentId: selectedBot.replace('openclaw:', '') });
      if (res.ok) {
        currentKey = res.payload.key;
        setSessionKey(currentKey);
        // 兼容：部分网关版本只认 key 字段
        sendRPC('sessions.messages.subscribe', { key: currentKey, sessionKey: currentKey }).catch(() => {});
        await sendRPC('sessions.patch', { key: currentKey, thinkingLevel, model: sessionModel });
        fetchSessions();
      } else {
        antdMessage.error(t('chat.failedToCreateSession') || 'Failed to create session: ' + (res.error?.message || 'Unknown'));
        setIsTyping(false);
        return;
      }
    }

    if (!currentKey) {
      setIsTyping(false);
      streamingAssistantIndexRef.current = null;
      antdMessage.error(t('chat.sessionKeyMissing'));
      return;
    }

    // 发送动作一开始就标记该会话“正在生成中”（即使尚未收到首个 delta）
    markSessionTyping(currentKey, true);

    let finalContent = text;
    if (attachedFiles && attachedFiles.length > 0) {
      const fileLinks = attachedFiles.map(f => {
        const isImage = f.ext.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
        return isImage
          ? `\n![${f.filename}](${f.thumbUrl || f.url} \"${f.url}\")\n(File path: ${f.path})`
          : `\n[${f.filename}](${f.url}) (File path: ${f.path})`;
      }).join('');
      finalContent += fileLinks + `\n\n**System Note for Expert:** The user has uploaded files. Access them via absolute \"File path\" provided.`;
    }

    const now = Date.now();
    const newUserMsg: Message = {
      id: `msg-${now}`,
      role: 'user',
      content: finalContent,
      timestamp: new Date(now).toLocaleTimeString(),
      _sortTs: now
    };

    const aiSortTs = now + 1;
    const assistantInitialMsg = text === '/stop' ? t('chat.terminated') : t('chat.thinking');
    const aiPlaceholderMsg: Message = {
      id: `msg-ai-${now}`,
      role: 'assistant',
      content: assistantInitialMsg,
      timestamp: new Date(now).toLocaleTimeString(),
      _sortTs: aiSortTs
    };

    const nextCache: SessionStreamCache = {
      fullText: '',
      isTyping: true,
      startTime: Date.now(),
      firstTokenTime: 0,
      ttftRecorded: false,
      tokenCount: 0,
      tpsData: [],
      lastUserMsg: newUserMsg,
      lastTouched: Date.now()
    };
    touchAndPruneSessionCache(currentKey, nextCache);

    setMessages(prev => {
      const next = [...prev, newUserMsg, aiPlaceholderMsg];
      streamingAssistantIndexRef.current = next.length - 1;
      return next;
    });
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
      const cache = sessionCacheRef.current.get(currentKey);
      if (cache) {
        cache.runId = res.payload.runId;
        touchAndPruneSessionCache(currentKey, cache);
      }
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
      antdMessage.error(t('chat.sendFailed', { reason: res.error?.message || 'Unknown' }));
      setIsTyping(false);
      streamingAssistantIndexRef.current = null;
      clearStallTimer();
      injectDiagnosticIfNoChatEvent(`chat.send 失败: ${res.error?.message || 'Unknown'}`);
      const cache = sessionCacheRef.current.get(currentKey);
      if (cache) {
        cache.isTyping = false;
        touchAndPruneSessionCache(currentKey, cache);
      }
      markSessionTyping(currentKey, false);
    } else if (text === '/stop') {
      setIsTyping(false);
      streamingAssistantIndexRef.current = null;
      clearStallTimer();
      const cache = sessionCacheRef.current.get(currentKey);
      if (cache) {
        cache.isTyping = false;
        touchAndPruneSessionCache(currentKey, cache);
      }
      markSessionTyping(currentKey, false);
    }
  }, [clearStallTimer, fetchSessions, inputAreaRef, isTyping, markSessionTyping, resetStallTimer, scrollRef, selectedBot, sendRPC, sessionKey, sessionModel, setSessionKey, status, t, thinkingLevel, touchAndPruneSessionCache, virtuosoRef]);

  /**
   * 重试/再生成：复用既有的 User 消息，不额外创建新的 User 消息。
   */
  const resendFromExistingUserMessage = useCallback(async (userMsg: Message) => {
    if (!sessionKey) return;
    if (status !== 'authenticated') return;
    if (isTyping) return;

    const finalContent = (userMsg.content || '').trim();
    if (!finalContent) return;

    setIsTyping(true);
    setTpsData([]);
    chatEventSeenSinceSendRef.current = false;
    hadTypingSinceSendRef.current = true;
    // 重试/再生成：立刻标记“正在生成中”，覆盖首 token 空窗期
    markSessionTyping(sessionKey, true);

    const baseSortTs = userMsg._sortTs || Date.now();
    const aiPlaceholderMsg: Message = {
      id: `msg-ai-${Date.now()}`,
      role: 'assistant',
      content: t('chat.thinking'),
      timestamp: new Date().toLocaleTimeString(),
      _sortTs: baseSortTs + 1
    };

    const nextCache: SessionStreamCache = {
      fullText: '',
      isTyping: true,
      startTime: Date.now(),
      firstTokenTime: 0,
      ttftRecorded: false,
      tokenCount: 0,
      tpsData: [],
      lastUserMsg: userMsg,
      lastTouched: Date.now()
    };
    touchAndPruneSessionCache(sessionKey, nextCache);

    setMessages(prev => {
      const next = [...prev, aiPlaceholderMsg];
      streamingAssistantIndexRef.current = next.length - 1;
      return next;
    });
    resetStallTimer();

    setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: messagesCountRef.current,
        align: 'end',
        behavior: 'smooth'
      });
    }, 100);

    const res = await sendRPC('chat.send', {
      sessionKey,
      message: finalContent,
      idempotencyKey: `regen-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    });

    if (res.ok && res.payload?.runId) {
      const cache = sessionCacheRef.current.get(sessionKey);
      if (cache) {
        cache.runId = res.payload.runId;
        touchAndPruneSessionCache(sessionKey, cache);
      }
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
      antdMessage.error(t('chat.sendFailed', { reason: res.error?.message || 'Unknown' }));
      setIsTyping(false);
      streamingAssistantIndexRef.current = null;
      clearStallTimer();
      injectDiagnosticIfNoChatEvent(`chat.send 失败: ${res.error?.message || 'Unknown'}`);
      const cache = sessionCacheRef.current.get(sessionKey);
      if (cache) {
        cache.isTyping = false;
        touchAndPruneSessionCache(sessionKey, cache);
      }
      markSessionTyping(sessionKey, false);
    }
  }, [clearStallTimer, isTyping, markSessionTyping, resetStallTimer, sendRPC, sessionKey, status, t, touchAndPruneSessionCache, virtuosoRef]);

  /**
   * 停止生成：更新 UI 并通过 chat.abort 中止 Agent 运行，不污染对话历史。
   */
  const handleStopGeneration = useCallback(async () => {
    if (!sessionKey) return;
    if (status !== 'authenticated') return;

    abortRequestedRef.current = { key: sessionKey, ts: Date.now() };
    setIsTyping(false);
    clearStallTimer();
    streamingAssistantIndexRef.current = null;
    markSessionTyping(sessionKey, false);
    streamEndGraceRef.current = { key: sessionKey, until: Date.now() + 3000 };

    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant') {
        const label = t('chat.manuallyStopped', { defaultValue: '已手动停止' });
        const content = (last.content === t('chat.thinking') || !last.content) ? label : last.content + ` (${label})`;
        return [...prev.slice(0, -1), { ...last, content }];
      }
      return prev;
    });

    const res = await sendRPC('chat.abort', { sessionKey });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn('⚠️ chat.abort 失败，回退到 /stop:', res.error);
      await sendRPC('chat.send', {
        sessionKey,
        message: '/stop',
        idempotencyKey: `stop-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      });
    }
  }, [clearStallTimer, markSessionTyping, sendRPC, sessionKey, status, t]);

  /**
   * 再生成：截断到最后一条 user 并复用该 user 消息重发。
   */
  const handleRegenerate = useCallback(() => {
    if (isTyping) {
      antdMessage.warning(t('chat.waitUntilFinishWarning'));
      return;
    }
    const currentMessages = messagesRef.current;
    const lastUserIndex = [...currentMessages].reverse().findIndex(m => m.role === 'user');
    if (lastUserIndex === -1) return;
    const actualIndex = currentMessages.length - 1 - lastUserIndex;
    const lastUserMsg = currentMessages[actualIndex];

    setMessages(prev => prev.slice(0, actualIndex + 1));
    streamingAssistantIndexRef.current = null;
    resendFromExistingUserMessage(lastUserMsg);
  }, [isTyping, resendFromExistingUserMessage, t]);

  /**
   * 编辑并重发：使用 sessions.steer 自动中断当前活跃的 run 并发送新内容。
   * 对 user 消息直接 steer（截断后续），非 user 消息兜底为新发送。
   */
  const handleSaveEdit = useCallback(async (editingMsgIndex: number, editContent: string) => {
    if (isTyping) {
      antdMessage.warning(t('chat.waitUntilFinishWarning'));
      return;
    }
    const newText = (editContent || '').trim();
    if (!newText) return;

    const currentKey = sessionKeyRef.current;
    if (!currentKey || status !== 'authenticated') {
      handleSend(newText);
      return;
    }

    const target = messagesRef.current[editingMsgIndex];
    if (target?.role === 'user') {
      const updatedUser: Message = { ...target, content: newText };
      setMessages(prev => [...prev.slice(0, editingMsgIndex), updatedUser]);
      streamingAssistantIndexRef.current = null;

      setIsTyping(true);
      setTpsData([]);
      chatEventSeenSinceSendRef.current = false;
      hadTypingSinceSendRef.current = true;
      markSessionTyping(currentKey, true);

      const baseSortTs = updatedUser._sortTs || Date.now();
      const aiPlaceholderMsg: Message = {
        id: `msg-ai-${Date.now()}`,
        role: 'assistant',
        content: t('chat.thinking'),
        timestamp: new Date().toLocaleTimeString(),
        _sortTs: baseSortTs + 1
      };
      const nextCache: SessionStreamCache = {
        fullText: '',
        isTyping: true,
        startTime: Date.now(),
        firstTokenTime: 0,
        ttftRecorded: false,
        tokenCount: 0,
        tpsData: [],
        lastUserMsg: updatedUser,
        lastTouched: Date.now()
      };
      touchAndPruneSessionCache(currentKey, nextCache);
      setMessages(prev => {
        const next = [...prev, aiPlaceholderMsg];
        streamingAssistantIndexRef.current = next.length - 1;
        return next;
      });
      resetStallTimer();

      const res = await sendRPC('sessions.steer', {
        key: currentKey,
        message: newText,
        idempotencyKey: `steer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      });
      if (res.ok && res.payload?.runId) {
        const cache = sessionCacheRef.current.get(currentKey);
        if (cache) cache.runId = res.payload.runId;
      }
      if (!res.ok) {
        setIsTyping(false);
        markSessionTyping(currentKey, false);
        clearStallTimer();
        streamingAssistantIndexRef.current = null;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && (last.content === t('chat.thinking') || !last.content)) {
            return prev.slice(0, -1);
          }
          return prev;
        });
        antdMessage.error(t('chat.steerFailed', { defaultValue: `重发失败: ${res.error?.message || res.error || '未知错误'}` }));
      }
      return;
    }

    setMessages(prev => prev.slice(0, editingMsgIndex));
    streamingAssistantIndexRef.current = null;
    handleSend(newText);
  }, [clearStallTimer, handleSend, isTyping, markSessionTyping, resetStallTimer, sendRPC, status, t, touchAndPruneSessionCache]);

  /**
   * 当连接断开/错误时统一清理消息侧状态。
   */
  useEffect(() => {
    if (status === 'disconnected' || status === 'error') {
      injectDiagnosticIfNoChatEvent(`连接状态变更: ${status}`);
      setIsTyping(false);
      setHasNewMessages(false);
      streamingAssistantIndexRef.current = null;
      clearStallTimer();
      typingSessionsRef.current.clear();
      setTypingSessionKeys([]);
    }
  }, [status, clearStallTimer]);

  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (status !== 'authenticated' || prev === 'authenticated') return;
    // 重连后同步：检查当前会话是否有中断的流式生成
    const key = sessionKeyRef.current;
    if (!key) return;

    const cache = sessionCacheRef.current.get(key);
    if (cache && cache.isTyping) {
      // 断连前有流正在进行，标记 stalled 提示用户
      setIsStalled(true);
      setIsTyping(false);
      cache.isTyping = false;
      streamingAssistantIndexRef.current = null;
      markSessionTyping(key, false);
    }
    // 无论如何都重新加载历史，确保与服务端状态一致
    loadSessionHistory(key);
  }, [status, loadSessionHistory, markSessionTyping]);

  /**
   * 注入 assistant 消息到当前会话的 transcript（不触发 AI 回复）。
   * 用于操作者向会话注入提示、备注等。
   */
  const handleInjectMessage = useCallback(async (text: string, label?: string) => {
    const currentKey = sessionKeyRef.current;
    if (!currentKey || status !== 'authenticated') return;
    const trimmed = (text || '').trim();
    if (!trimmed) return;

    const res = await sendRPC('chat.inject', {
      sessionKey: currentKey,
      message: trimmed,
      ...(label ? { label } : {})
    });
    if (res.ok) {
      const rawTs = Date.now();
      const injectedMsg: Message = {
        id: res.payload?.messageId || `msg-inject-${rawTs}`,
        role: 'assistant',
        content: trimmed,
        timestamp: new Date(rawTs).toLocaleTimeString(),
        _sortTs: rawTs
      };
      setMessages(prev => [...prev, injectedMsg]);
    } else {
      antdMessage.error(t('chat.injectFailed', { defaultValue: `注入失败: ${res.error?.message || res.error || '未知错误'}` }));
    }
  }, [sendRPC, status, t]);

  return useMemo(() => {
    return {
      messages,
      setMessages,
      isTyping,
      isStalled,
      isLoadingHistory,
      tpsData,
      hasNewMessages,
      setHasNewMessages,
      typingSessionKeys,
      handleChatDelta,
      handleApprovalRequested,
      handleGatewayEvent,
      loadSessionHistory,
      handleSend,
      handleStopGeneration,
      handleRegenerate,
      handleSaveEdit,
      handleInjectMessage,
      showScrollBtnRef,
      messagesCountRef,
      getMessagesCount: () => messagesCountRef.current
    };
  }, [handleApprovalRequested, handleChatDelta, handleGatewayEvent, handleInjectMessage, handleRegenerate, handleSaveEdit, handleSend, handleStopGeneration, hasNewMessages, isLoadingHistory, isStalled, isTyping, messages, setMessages, tpsData, typingSessionKeys, showScrollBtnRef]);
}

