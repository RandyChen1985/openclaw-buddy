import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message as antdMessage } from 'antd';
import type { FileInfo, Message } from '../useChatV3WebSocket';

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

  const sessionKeyRef = useRef<string | null>(null);
  useEffect(() => { sessionKeyRef.current = sessionKey; }, [sessionKey]);

  const messagesCountRef = useRef(messages.length);
  useEffect(() => { messagesCountRef.current = messages.length; }, [messages.length]);

  const stallTimerRef = useRef<any>(null);
  const lastUpdateRef = useRef(0);
  const streamingAssistantIndexRef = useRef<number | null>(null);

  const sessionCacheRef = useRef<Map<string, {
    fullText: string;
    runId?: string;
    isTyping: boolean;
    startTime: number;
    firstTokenTime: number;
    ttftRecorded: boolean;
    tokenCount: number;
    tpsData: number[];
    lastUserMsg?: Message;
  }>>(new Map());

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
  const formatMessageContent = useCallback((msg: any): string => {
    if (!msg) return '';
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
          body = formatMessageContent(parsed);
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
      body = formatMessageContent([content]);
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

    if (!sessionCacheRef.current.has(pSessionKey)) {
      sessionCacheRef.current.set(pSessionKey, {
        fullText: '',
        isTyping: true,
        startTime: Date.now(),
        firstTokenTime: 0,
        ttftRecorded: false,
        tokenCount: 0,
        tpsData: []
      });
    }
    const cache = sessionCacheRef.current.get(pSessionKey)!;

    if (payload.state === 'delta') {
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

      const oldLen = cache.fullText.length;
      if (oldLen > 50 && fullText.length < oldLen - 20) return;

      cache.fullText = fullText;
      cache.tokenCount = fullText.length;
      cache.isTyping = true;
      cache.runId = payload.runId;

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
      cache.isTyping = false;
      if (pSessionKey === sessionKeyRef.current) clearStallTimer();

      const now = Date.now();
      const duration = (now - cache.startTime) / 1000;
      const ttft = cache.ttftRecorded ? (cache.firstTokenTime - cache.startTime) : 0;
      const finalTPS = duration > 0 ? (cache.tokenCount / (duration - (ttft / 1000))) : 0;

      const incomingContent = payload.message?.content ? formatMessageContent(payload.message.content) : cache.fullText;
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
    } else if (payload.state === 'error' || payload.state === 'failed') {
      cache.isTyping = false;
      if (pSessionKey === sessionKeyRef.current) {
        clearStallTimer();
        const errorMsg = payload.message?.content || payload.error?.message || payload.error || t('chat.streamFailedDefault');

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
        streamingAssistantIndexRef.current = null;
        setTimeout(() => inputAreaRef.current?.focus(), 100);
      }
    }
  }, [clearStallTimer, fetchSessions, formatMessageContent, inputAreaRef, resetStallTimer, scrollRef, showScrollBtnRef, t, virtuosoRef]);

  /**
   * 处理审批请求事件：将审批卡片以 Markdown block 注入到消息流中，确保 UI 一定可见。
   *
   * 规则：
   * - 若最后一条是 assistant，则追加 block 到该消息（去重：slug 已存在则忽略）
   * - 否则追加一条新的 assistant 消息承载审批卡片
   */
  const handleApprovalRequested = useCallback((payload: any) => {
    if (!payload) return;
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
    if (evt === 'exec.approval.requested') {
      handleApprovalRequested(data.payload);
      return;
    }
    if (evt === 'agent') {
      const { stream, data: agentData } = data.payload || {};
      if (stream === 'item' && agentData?.status === 'blocked') {
        setIsTyping(false);
        clearStallTimer();
        streamingAssistantIndexRef.current = null;
      }
      return;
    }
  }, [clearStallTimer, handleApprovalRequested, handleChatDelta]);

  /**
   * 加载会话历史并写入 messages；同时用 sessionCacheRef 缝合 DB 未落盘的临时消息。
   */
  const loadSessionHistory = useCallback(async (key: string) => {
    setIsLoadingHistory(true);
    streamingAssistantIndexRef.current = null;
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
          _sortTs: rawTs
        } as Message;
      }).filter((msg: any) => msg.content && msg.content.trim() !== '');

      const cache = sessionCacheRef.current.get(key);
      if (cache) {
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

      const roleOrder: Record<string, number> = { system: 0, user: 1, assistant: 2 };
      const finalMessages = [...history].sort((a: any, b: any) => {
        const diff = (a._sortTs || 0) - (b._sortTs || 0);
        if (diff !== 0) return diff;
        return (roleOrder[a.role] || 0) - (roleOrder[b.role] || 0);
      });
      setMessages(finalMessages);

      if (history.length > 0) {
        setTimeout(() => {
          virtuosoRef.current?.scrollToIndex({ index: history.length - 1, align: 'end', behavior: 'auto' });
        }, 50);
      }
    }
    setIsLoadingHistory(false);
  }, [clearStallTimer, formatMessageContent, resetStallTimer, sendRPC, virtuosoRef]);

  /**
   * 发送消息：必要时创建会话并写入初始占位消息，然后向网关发起 chat.send。
   */
  const handleSend = useCallback(async (content?: any, attachedFiles?: FileInfo[]) => {
    const text = (typeof content === 'string' ? content : '').trim();
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

    setMessages(prev => [...prev, newUserMsg, aiPlaceholderMsg]);
    streamingAssistantIndexRef.current = messagesCountRef.current + 1;
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
      antdMessage.error(t('chat.sendFailed', { reason: res.error?.message || 'Unknown' }));
      setIsTyping(false);
      streamingAssistantIndexRef.current = null;
      clearStallTimer();
      const cache = sessionCacheRef.current.get(currentKey);
      if (cache) cache.isTyping = false;
    } else if (text === '/stop') {
      setIsTyping(false);
      streamingAssistantIndexRef.current = null;
      clearStallTimer();
      const cache = sessionCacheRef.current.get(currentKey);
      if (cache) cache.isTyping = false;
    }
  }, [clearStallTimer, fetchSessions, inputAreaRef, isTyping, resetStallTimer, scrollRef, selectedBot, sendRPC, sessionKey, sessionModel, setSessionKey, status, t, thinkingLevel, virtuosoRef]);

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

    const baseSortTs = userMsg._sortTs || Date.now();
    const aiPlaceholderMsg: Message = {
      id: `msg-ai-${Date.now()}`,
      role: 'assistant',
      content: t('chat.thinking'),
      timestamp: new Date().toLocaleTimeString(),
      _sortTs: baseSortTs + 1
    };

    sessionCacheRef.current.set(sessionKey, {
      fullText: '',
      isTyping: true,
      startTime: Date.now(),
      firstTokenTime: 0,
      ttftRecorded: false,
      tokenCount: 0,
      tpsData: [],
      lastUserMsg: userMsg
    });

    setMessages(prev => [...prev, aiPlaceholderMsg]);
    streamingAssistantIndexRef.current = messagesCountRef.current;
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
      antdMessage.error(t('chat.sendFailed', { reason: res.error?.message || 'Unknown' }));
      setIsTyping(false);
      streamingAssistantIndexRef.current = null;
      clearStallTimer();
      const cache = sessionCacheRef.current.get(sessionKey);
      if (cache) cache.isTyping = false;
    }
  }, [clearStallTimer, isTyping, resetStallTimer, sendRPC, sessionKey, status, t, virtuosoRef]);

  /**
   * 停止生成：更新 UI 并向网关发送 `/stop`。
   */
  const handleStopGeneration = useCallback(async () => {
    if (!sessionKey) return;
    if (status !== 'authenticated') return;

    setIsTyping(false);
    clearStallTimer();
    streamingAssistantIndexRef.current = null;

    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant') {
        const label = t('chat.manuallyStopped', { defaultValue: '已手动停止' });
        const content = (last.content === t('chat.thinking') || !last.content) ? label : last.content + ` (${label})`;
        return [...prev.slice(0, -1), { ...last, content }];
      }
      return prev;
    });

    const res = await sendRPC('chat.send', {
      sessionKey,
      message: '/stop',
      idempotencyKey: `stop-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn('⚠️ 停止指令发送失败:', res.error);
    }
  }, [clearStallTimer, sendRPC, sessionKey, status, t]);

  /**
   * 再生成：截断到最后一条 user 并复用该 user 消息重发。
   */
  const handleRegenerate = useCallback(() => {
    if (isTyping) {
      antdMessage.warning(t('chat.waitUntilFinishWarning'));
      return;
    }
    const lastUserIndex = [...messages].reverse().findIndex(m => m.role === 'user');
    if (lastUserIndex === -1) return;
    const actualIndex = messages.length - 1 - lastUserIndex;
    const lastUserMsg = messages[actualIndex];

    setMessages(prev => prev.slice(0, actualIndex + 1));
    streamingAssistantIndexRef.current = null;
    resendFromExistingUserMessage(lastUserMsg);
  }, [isTyping, messages, resendFromExistingUserMessage, t]);

  /**
   * 编辑并重发：对 user 消息更新内容后复用重发；非 user 消息兜底为新发送。
   */
  const handleSaveEdit = useCallback(async (editingMsgIndex: number, editContent: string) => {
    if (isTyping) {
      antdMessage.warning(t('chat.waitUntilFinishWarning'));
      return;
    }
    const newText = (editContent || '').trim();
    if (!newText) return;

    const target = messages[editingMsgIndex];
    if (target?.role === 'user') {
      const updatedUser: Message = { ...target, content: newText };
      setMessages(prev => [...prev.slice(0, editingMsgIndex), updatedUser]);
      streamingAssistantIndexRef.current = null;
      await resendFromExistingUserMessage(updatedUser);
      return;
    }

    // 兜底：目标不是 user，则截断并当作新消息发送
    setMessages(prev => prev.slice(0, editingMsgIndex));
    streamingAssistantIndexRef.current = null;
    handleSend(newText);
  }, [handleSend, isTyping, messages, resendFromExistingUserMessage, t]);

  /**
   * 当连接断开/错误时统一清理消息侧状态。
   */
  useEffect(() => {
    if (status === 'disconnected' || status === 'error') {
      setIsTyping(false);
      setHasNewMessages(false);
      streamingAssistantIndexRef.current = null;
      clearStallTimer();
    }
  }, [status, clearStallTimer]);

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
      handleChatDelta,
      handleApprovalRequested,
      handleGatewayEvent,
      loadSessionHistory,
      handleSend,
      handleStopGeneration,
      handleRegenerate,
      handleSaveEdit,
      // refs exposed for compatibility with existing callers
      showScrollBtnRef,
      messagesCountRef,
      /**
       * 获取当前消息数量（供会话层在 authenticated 后决定是否加载历史，避免覆盖正在进行的对话）。
       */
      getMessagesCount: () => messagesCountRef.current
    };
  }, [handleApprovalRequested, handleChatDelta, handleGatewayEvent, handleRegenerate, handleSaveEdit, handleSend, handleStopGeneration, hasNewMessages, isLoadingHistory, isStalled, isTyping, messages, setMessages, tpsData, showScrollBtnRef]);
}

