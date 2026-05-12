import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { message as antdMessage } from 'antd';
import type { FileInfo, Message } from '../useChatV3WebSocket';
import { buildBuddyDirectSessionKey } from '../../utils/buddySessionKey';
import { extractApprovalSlugFromHint, hasApprovalCardForSlug, isApprovalHintText } from './approvalUtils';
import {
  buildSendMessageContent,
  createAssistantPlaceholder,
  createInjectedAssistantMessage,
  createTypingSessionCache,
  createUserMessage,
} from './messageDrafts';
import { formatMessageContent } from './messageFormat';
import { normalizeTranscriptNoise } from './transcriptNoise';
import { buildSessionToolBody, pickFirst } from './toolFormat';
import {
  extractAgentErrorMessage,
  formatAgentMetadataEvent,
  isAgentMetadataStream,
  sealPendingToolMarkers,
} from './agentEventFormat';
import {
  buildHistoryMessages,
  mergeSessionCacheIntoHistory,
  restoreCachedMetadataMessages,
  sortMessagesByTimeline,
} from './historyUtils';
import {
  MAX_METADATA_BYTES_PER_ENTRY,
  MAX_METADATA_ENTRIES_PER_SESSION,
  MAX_SESSION_CACHE_ENTRIES,
  type SessionStreamCache,
} from './sessionCacheTypes';
import {
  appendToAgentBlock,
  assistantMessageLooksSubstantial,
  findLastMainAssistantIndex,
  isAssistantUiThinkingPlaceholder,
  isSessionRunningStatus,
  isSessionTerminalStatus,
  mergeTrailingThinkingIntoPreviousAssistant,
  partitionAssistantContent,
  shouldBypassSessionMessageTypingGuard,
  stripApprovalBlockWithSlug,
  stripTrailingUiThinkingPlaceholderAfterAssistantReply,
  updateMetaMessage,
  upsertAgentBlock,
} from './messageUtils';

/** 收到 chat final 后延迟再松 typing，避免多段 final / 尾包 delta 时误以为已可输入 */
const FINAL_UI_SETTLE_MS = 1000;

/** 消息面板单次拉取条数；500 在长会话下解析与 React diff 成本很高，易导致「用久了切会话卡」 */
const CHAT_HISTORY_PANEL_LIMIT = 200;

/** 生成结束后的侧栏静默刷新防抖（ms），避免每条 assistant 完成都打 sessions.list */
const SESSION_LIST_SILENT_REFRESH_DEBOUNCE_MS = 3000;

export interface UseV3MessagesParams {
  t: any;
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';
  sessionKey: string | null;
  setSessionKey: (key: string | null) => void;
  /** 当前登录用户名（可选）。用于把 username 写入 buddy:direct 会话 key */
  usernameForSessionKey?: string | null;
  selectedBot: string;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  sessionModel: string;
  sendRPC: (method: string, params: any) => Promise<any>;
  fetchSessions: (isSilent?: boolean) => Promise<void> | void;
  inputAreaRef: React.RefObject<any>;
  virtuosoRef: React.RefObject<any>;
  scrollRef: React.RefObject<HTMLDivElement>;
  showScrollBtnRef: React.MutableRefObject<boolean>;
  showThinkingRef: React.MutableRefObject<boolean>;
  /** 为 true 时禁止发送（例如正在 sessions.create 新会话，此时 sessionKey 状态仍是旧会话） */
  sessionComposeBlocked?: boolean;
}

/**
 * v3 消息层：负责消息列表状态、流式 delta/final/error 合并、历史加载、以及发送/停止/重试/编辑重发等动作。
 */
export function useV3Messages({
  t,
  status,
  sessionKey,
  setSessionKey,
  usernameForSessionKey,
  selectedBot,
  thinkingLevel,
  sessionModel,
  sendRPC,
  fetchSessions,
  inputAreaRef,
  virtuosoRef,
  scrollRef,
  showScrollBtnRef,
  showThinkingRef,
  sessionComposeBlocked = false
}: UseV3MessagesParams) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isStalled, setIsStalled] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [tpsData, setTpsData] = useState<number[]>([]);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [typingSessionKeys, setTypingSessionKeys] = useState<string[]>([]);

  const typingSessionsRef = useRef<Set<string>>(new Set());
  /** 追踪会话的全局状态 (running/done/error)，由于网关 chat.final 只是 run 结束，不能直接解锁 UI */
  /** 网关 sessions.changed 中的 status；终态条目会 delete，避免长时间运行 Map 无限涨 */
  const sessionStatusMapRef = useRef<Map<string, string>>(new Map());

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
  // 与流式事件过滤共用：必须在 paint 前与 sessionKey 对齐，避免「新会话已显示但 ref 仍指向旧会话」导致串会话
  useLayoutEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const messagesCountRef = useRef(messages.length);
  useEffect(() => { messagesCountRef.current = messages.length; }, [messages.length]);

  const stallTimerRef = useRef<any>(null);
  const lastUpdateRef = useRef(0);
  // 最近一次“流式相关事件”(chat.delta/thought/final/error/aborted/agent lifecycle)的时间戳
  // 用于：当 typing 状态异常卡住时，允许 session.message 兜底把内容推到 UI
  const lastStreamEventAtRef = useRef(0);
  const streamingAssistantIndexRef = useRef<number | null>(null);
  const historyRequestSeqRef = useRef(0);
  const latestHistoryRequestRef = useRef(0);
  const chatEventSeenSinceSendRef = useRef(false);
  const hadTypingSinceSendRef = useRef(false);

  const sessionCacheRef = useRef<Map<string, SessionStreamCache>>(new Map());
  // 流结束后的冷却窗口：防止 session.message 事件在流刚结束时追加重复消息
  const streamEndGraceRef = useRef<{ key: string; until: number } | null>(null);
  /** 按 sessionKey 记录 final 后的延时释放任务，避免多会话并发时产生清理冲突 */
  const finalUiReleaseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // 已请求停止：从点击"停止"到收到 aborted/final 之间，屏蔽后续 delta 写入
  const abortRequestedRef = useRef<{ key: string; ts: number } | null>(null);
  /** 合并多次「生成结束后的侧栏静默刷新」，避免长时间聊天反复打 sessions.list */
  const sessionListSilentRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingFinalUiRelease = useCallback((key?: string) => {
    if (key) {
      const timer = finalUiReleaseTimersRef.current.get(key);
      if (timer) {
        clearTimeout(timer);
        finalUiReleaseTimersRef.current.delete(key);
      }
    } else {
      finalUiReleaseTimersRef.current.forEach(timer => clearTimeout(timer));
      finalUiReleaseTimersRef.current.clear();
    }
  }, []);

  useEffect(() => () => cancelPendingFinalUiRelease(), [cancelPendingFinalUiRelease]);

  useEffect(() => () => {
    if (sessionListSilentRefreshTimerRef.current) {
      clearTimeout(sessionListSilentRefreshTimerRef.current);
      sessionListSilentRefreshTimerRef.current = null;
    }
  }, []);

  const scheduleSilentSessionListRefresh = useCallback(() => {
    if (sessionListSilentRefreshTimerRef.current) {
      clearTimeout(sessionListSilentRefreshTimerRef.current);
    }
    sessionListSilentRefreshTimerRef.current = setTimeout(() => {
      sessionListSilentRefreshTimerRef.current = null;
      void fetchSessions(true);
    }, SESSION_LIST_SILENT_REFRESH_DEBOUNCE_MS);
  }, [fetchSessions]);

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
      lastTouched: Date.now(),
      metadataByRunId: new Map<string, string>(),
      activeRuns: new Set<string>()
    };
    touchAndPruneSessionCache(key, created);
    return created;
  }, [touchAndPruneSessionCache]);

  /**
   * 按 runId 记录某条 assistant 消息的「metadata 折叠块」，供会话切换/历史加载时恢复使用。
   * 包含简单的条数 + 单条字节上限，避免 thinking 超长占爆内存。
   */
  const rememberMetadataForRun = useCallback((sessionKeyStr: string, runId: string | undefined, metadata: string) => {
    if (!sessionKeyStr || !runId || !metadata) return;
    const cache = sessionCacheRef.current.get(sessionKeyStr);
    if (!cache) return;
    if (!cache.metadataByRunId) cache.metadataByRunId = new Map();
    const clipped = metadata.length > MAX_METADATA_BYTES_PER_ENTRY
      ? metadata.slice(0, MAX_METADATA_BYTES_PER_ENTRY) + '\n\n> _[metadata 已截断]_\n'
      : metadata;
    cache.metadataByRunId.set(runId, clipped);
    if (cache.metadataByRunId.size > MAX_METADATA_ENTRIES_PER_SESSION) {
      // LRU：删除最早插入的若干条
      const keys = Array.from(cache.metadataByRunId.keys());
      const victims = keys.slice(0, cache.metadataByRunId.size - MAX_METADATA_ENTRIES_PER_SESSION);
      victims.forEach(k => cache.metadataByRunId.delete(k));
    }
    touchAndPruneSessionCache(sessionKeyStr, cache);
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
    }, 2000);
  }, [clearStallTimer]);

  /**
   * 新建/切换会话时解除「当前消息区」的生成中锁：根据目标会话是否在生成中来平滑过渡 isTyping 状态。
   * 由会话层通过 messageOpsRef 调用（不代替 chat.abort，仅维护本地 UI 状态）。
   *
   * @param nextKey 目标切换的会话 Key
   */
  const resetTypingState = useCallback((nextKey?: string) => {
    const current = sessionKeyRef.current;
    if (current) cancelPendingFinalUiRelease(current);
    abortRequestedRef.current = null;
    clearStallTimer();

    // 如果目标会话已经在生成中（侧边栏有笔），则无缝平滑过渡 isTyping 状态，避免输入框闪烁释放
    const targetIsTyping = nextKey ? typingSessionsRef.current.has(nextKey) : false;
    
    setIsTyping(targetIsTyping);
    if (targetIsTyping) {
      resetStallTimer();
    }
    
    streamingAssistantIndexRef.current = null;
  }, [cancelPendingFinalUiRelease, clearStallTimer, resetStallTimer]);

  /**
   * 延迟释放生成中锁：统一管理 chat.final 与 agent.lifecycle.end 的释锁时机。
   * 采用“最后一次到达延迟发放”策略，确保各路流信息（消息、思考、工具调用）全部落盘后再解锁。
   */
  const releaseTypingLock = useCallback((key: string, ms = FINAL_UI_SETTLE_MS) => {
    cancelPendingFinalUiRelease(key);
    const timer = setTimeout(() => {
      if (finalUiReleaseTimersRef.current.get(key) === timer) {
        finalUiReleaseTimersRef.current.delete(key);
      }
      
      const cache = sessionCacheRef.current.get(key);
      if (cache && cache.activeRuns && cache.activeRuns.size > 0) {
        // 仍有活跃任务（Parallel 执行中），暂不释放，等待下一个 lifecycle.end 或 chat.final
        return;
      }

      // v3 增强：从网关全局视野判断，哪怕局部 run 结束，若 session 状态仍为 running 则不解锁
      const globalStatus = sessionStatusMapRef.current.get(key);
      if (globalStatus === 'running') {
        return;
      }

      markSessionTyping(key, false);
      if (key === sessionKeyRef.current) {
        setIsTyping(false);
        streamingAssistantIndexRef.current = null;
        scheduleSilentSessionListRefresh();
        setTimeout(() => inputAreaRef.current?.focus(), 100);
      } else {
        scheduleSilentSessionListRefresh();
      }
    }, ms);
    finalUiReleaseTimersRef.current.set(key, timer);
  }, [cancelPendingFinalUiRelease, inputAreaRef, markSessionTyping, scheduleSilentSessionListRefresh]);


  /**
   * 处理 chat 流式事件：delta/final/error 合并到 messages，并维护性能优化索引。
   */
  const handleChatDelta = useCallback((payload: any) => {
    const pSessionKey = payload.sessionKey || sessionKeyRef.current;
    if (!pSessionKey) return;
    const cache = getOrCreateSessionCache(pSessionKey);
    chatEventSeenSinceSendRef.current = true;
    lastStreamEventAtRef.current = Date.now();

    if (payload.state === 'thought' || payload.state === 'thinking') {
      const abortReq = abortRequestedRef.current;
      if (abortReq && abortReq.key === pSessionKey) return;

      if (payload.runId) cache.activeRuns.add(payload.runId);

      cancelPendingFinalUiRelease(pSessionKey);
      markSessionTyping(pSessionKey, true);
      if (pSessionKey === sessionKeyRef.current) {
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

      if (payload.runId) cache.activeRuns.add(payload.runId);

      cancelPendingFinalUiRelease(pSessionKey);
      markSessionTyping(pSessionKey, true);
      if (pSessionKey === sessionKeyRef.current) {
        resetStallTimer();
        if (showScrollBtnRef.current) setHasNewMessages(true);
      }

      const now = Date.now();
      lastStreamEventAtRef.current = now;
      if (!cache.ttftRecorded) {
        cache.ttftRecorded = true;
        cache.firstTokenTime = now;
      }

      const messageObj = payload.message;
      if (!messageObj) return;

      const fullText = formatMessageContent(messageObj);
      // 如果是审批提示语，且审批卡片已存在，则丢弃（避免重复提示污染消息流）
      if (isApprovalHintText(fullText)) {
        const slug = extractApprovalSlugFromHint(fullText);
        if (slug && hasApprovalCardForSlug(messagesRef.current || [], slug)) return;
      }
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
            // 主气泡只承载 transcript 正文；thinking/plan/toolCall/commandOutput 已分离到 _uiMetaOnly 气泡
            const isMain = (m: Message) => !m._uiMetaOnly;
            const idx = streamingAssistantIndexRef.current;
            let targetIdx = (idx !== null && idx >= 0 && idx < prev.length && isMain(prev[idx])) ? idx : -1;
            if (targetIdx === -1) {
              const runIdIdx = prev.findLastIndex(m => isMain(m) && m.runId === payload.runId);
              targetIdx = runIdIdx !== -1
                ? runIdIdx
                : prev.findLastIndex(m => isMain(m) && m.role === 'assistant' && !m.runId);
            }
            if (targetIdx === -1) return prev;

            const next = [...prev];
            const current = next[targetIdx];
            next[targetIdx] = {
              ...current,
              runId: payload.runId,
              content: fullText,
              metrics: { ...current.metrics, ttft, tps: currentTPS },
              _sortTs: current._sortTs,
            };
            streamingAssistantIndexRef.current = targetIdx;
            return next;
          });

          if (virtuosoRef.current) {
            const isNearBottom = scrollRef.current
              ? (scrollRef.current.scrollHeight - scrollRef.current.scrollTop - scrollRef.current.clientHeight < 40)
              : true;

            if (!showScrollBtnRef.current || isNearBottom) {
              scrollRef.current?.scrollTo({
                top: scrollRef.current.scrollHeight,
                behavior: 'auto'
              });
            }
          }
        }
      }
    } else if (payload.state === 'final' || payload.state === 'finished' || payload.state === 'done') {
      lastStreamEventAtRef.current = Date.now();
      const wasUserAbort = abortRequestedRef.current?.key === pSessionKey;
      abortRequestedRef.current = null;
      cache.isTyping = false;

      if (payload.runId) cache.activeRuns.delete(payload.runId);

      touchAndPruneSessionCache(pSessionKey, cache);
      streamEndGraceRef.current = { key: pSessionKey, until: Date.now() + 3000 };
      if (pSessionKey === sessionKeyRef.current) clearStallTimer();

      // 用户已主动停止且 UI 已标记"已手动停止"，不再用服务端 final覆盖
      if (wasUserAbort) {
        cancelPendingFinalUiRelease(pSessionKey);
        markSessionTyping(pSessionKey, false);
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
        if (isApprovalHintText(incomingContent)) {
          const slug = extractApprovalSlugFromHint(incomingContent);
          if (slug && hasApprovalCardForSlug(messagesRef.current || [], slug)) {
            // final 若只是重复提示语，则不覆盖现有 assistant 内容
            cancelPendingFinalUiRelease(pSessionKey);
            markSessionTyping(pSessionKey, false);
            setIsTyping(false);
            streamingAssistantIndexRef.current = null;
            fetchSessions(true);
            return;
          }
        }
        cache.fullText = incomingContent;

        if (pSessionKey === sessionKeyRef.current) {
          setMessages(prev => {
            // 主气泡只承载 transcript；metadata 由 _uiMetaOnly 气泡承载，不再在主气泡里做保留/合并
            const isMain = (m: Message) => !m._uiMetaOnly;
            const idx = streamingAssistantIndexRef.current;
            const mainMatches = (i: number) => i >= 0 && i < prev.length && isMain(prev[i]);
            let targetIndex = (idx !== null && mainMatches(idx)) ? idx : -1;
            if (targetIndex === -1) {
              const runIdIdx = prev.findLastIndex(m => isMain(m) && m.runId === payload.runId);
              targetIndex = runIdIdx !== -1
                ? runIdIdx
                : prev.findLastIndex(m => isMain(m) && m.role === 'assistant' && !m.runId);
            }
            if (targetIndex === -1) return prev;

            const last = prev[targetIndex];
            if (!incomingContent && last.content && last.content !== t('chat.thinking')) return prev;

            // 记录同 runId 的 meta 气泡 content 到缓存（供切会话/重新加载历史时兜底恢复）
            const runIdForCache = payload.runId || (last as any).runId;
            if (runIdForCache) {
              const metaMsg = prev.find(m => m._uiMetaOnly && m.runId === runIdForCache);
              if (metaMsg?.content) {
                rememberMetadataForRun(pSessionKey, runIdForCache, metaMsg.content);
              }
            }

            const next = [...prev];
            next[targetIndex] = {
              ...last,
              runId: payload.runId,
              content: incomingContent || last.content,
              metrics: { ...last.metrics, ttft, duration, tps: finalTPS },
              _sortTs: last._sortTs,
            };
            return next;
          });

          releaseTypingLock(pSessionKey);
        } else {
          releaseTypingLock(pSessionKey);
        }
      }
    } else if (payload.state === 'aborted') {
      lastStreamEventAtRef.current = Date.now();
      cancelPendingFinalUiRelease(pSessionKey);
      // 判断是否由 handleStopGeneration 发起的 abort（已在 UI 侧处理过消息标记）
      const wasUserAbort = abortRequestedRef.current?.key === pSessionKey;
      abortRequestedRef.current = null;
      cache.isTyping = false;

      if (payload.runId) cache.activeRuns.delete(payload.runId);

      touchAndPruneSessionCache(pSessionKey, cache);
      markSessionTyping(pSessionKey, false);
      streamEndGraceRef.current = { key: pSessionKey, until: Date.now() + 3000 };
      if (pSessionKey === sessionKeyRef.current) {
        clearStallTimer();
        if (!wasUserAbort) {
          const partialContent = payload.message ? formatMessageContent(payload.message) : cache.fullText;
          setMessages(prev => {
            const isMain = (m: Message) => !m._uiMetaOnly;
            const idx = streamingAssistantIndexRef.current;
            let targetIndex = (idx !== null && idx >= 0 && idx < prev.length && isMain(prev[idx])) ? idx : -1;
            if (targetIndex === -1) targetIndex = prev.findLastIndex(m => isMain(m) && m.role === 'assistant');
            if (targetIndex === -1) return prev;
            const last = prev[targetIndex];
            const label = t('chat.manuallyStopped', { defaultValue: '已手动停止' });

            const hasBody = partialContent && partialContent !== t('chat.thinking') && partialContent !== t('chat.deepThinking', { defaultValue: '深度思考中...' });
            const content = hasBody ? `${partialContent} (${label})` : label;

            // 记录同 runId 的 meta 气泡 content 到缓存，供切换/重载恢复
            const runIdForCache = payload.runId || (last as any).runId;
            if (runIdForCache) {
              const metaMsg = prev.find(m => m._uiMetaOnly && m.runId === runIdForCache);
              if (metaMsg?.content) rememberMetadataForRun(pSessionKey, runIdForCache, metaMsg.content);
            }

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
      lastStreamEventAtRef.current = Date.now();
      cancelPendingFinalUiRelease(pSessionKey);
      const wasUserAbort = abortRequestedRef.current?.key === pSessionKey;
      abortRequestedRef.current = null;
      cache.isTyping = false;

      if (payload.runId) cache.activeRuns.delete(payload.runId);

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
  }, [cancelPendingFinalUiRelease, clearStallTimer, fetchSessions, getOrCreateSessionCache, inputAreaRef, markSessionTyping, releaseTypingLock, rememberMetadataForRun, resetStallTimer, scrollRef, showScrollBtnRef, t, touchAndPruneSessionCache, virtuosoRef]);

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
    const effectiveKey = evtKey || sessionKeyRef.current;
    const { id, request } = payload;
    const approvalId = (id || '').toString();
    const slug = approvalId ? approvalId.substring(0, 8) : '';
    const command = request?.command || '';
    if (!approvalId || !slug || !command) return;

    // 重要：卡片内需带完整 approvalId（UUID），用户发送 `/approve <id> allow-once|allow-always` 时须与此一致；
    // 不能只用截断 slug，否则网关可能无法匹配待审批项。
    const approvalBlock = `\n\n> :::approval\n> **${slug}**\n> approvalId: ${approvalId}\n> \`\`\`bash\n> ${command}\n> \`\`\`\n> :::\n`;

    setMessages(prev => {
      const mainIdx = findLastMainAssistantIndex(prev);
      if (mainIdx !== -1) {
        const last = prev[mainIdx];
        if (last.content.includes(slug)) return prev;
        const newContent = (last.content === t('chat.thinking') || !last.content)
          ? approvalBlock
          : `${last.content}${approvalBlock}`;
        const next: Message[] = [...prev];
        next[mainIdx] = { ...last, content: newContent };
        // 纠正：旧逻辑曾把审批追加到列表末尾的 _uiMetaOnly 气泡，应从 meta 中剥掉同 slug 的审批块
        for (let i = 0; i < next.length; i++) {
          const m = next[i];
          if (!m._uiMetaOnly || m.role !== 'assistant') continue;
          const c = m.content || '';
          if (!c.includes(':::approval') || !c.includes(slug)) continue;
          const cleaned = stripApprovalBlockWithSlug(c, slug);
          if (cleaned !== c) next[i] = { ...m, content: cleaned };
        }
        return next;
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
    if (effectiveKey) markSessionTyping(effectiveKey, false);
    setIsTyping(false);
    streamingAssistantIndexRef.current = null;
    clearStallTimer();
  }, [clearStallTimer, markSessionTyping, t]);

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
      'allow-always': '✅ 已批准(永久)',
      'denied': '❌ 已拒绝',
      'rejected': '❌ 已拒绝',
      'timeout': '⏱️ 已超时',
    };
    const label = decisionLabels[decision] || (decision === 'approved' ? '✅ 已批准' : `⚠️ ${decision || '未知'}`);

    setMessages(prev => {
      let idx = prev.findLastIndex(
        m =>
          m.role === 'assistant' &&
          !m._uiMetaOnly &&
          m.content.includes(slug) &&
          m.content.includes(':::approval'),
      );
      if (idx === -1) {
        idx = prev.findLastIndex(
          m => m.role === 'assistant' && m.content.includes(slug) && m.content.includes(':::approval'),
        );
      }
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
   * 默认在「会话仍标记为流式生成」时暂缓，避免与 chat.delta 打架；
   * 但对「同一 runId 合并进已有主气泡」的推送必须放行（审批后续、工具结果常只走 transcript）。
   */
  const handleSessionMessage = useCallback((payload: any) => {
    if (!payload) return;
    const { sessionKey: evtKey, message: msg } = payload;
    if (!evtKey || evtKey !== sessionKeyRef.current) return;
    if (!msg || !msg.role) return;

    const bypassSessionMessageGuards = shouldBypassSessionMessageTypingGuard(messagesRef.current || [], msg);

    if (typingSessionsRef.current.has(evtKey) && !bypassSessionMessageGuards) {
      // 兜底：若 typing 卡住且一段时间没有任何流式事件，则允许 session.message 落 UI
      const lastStreamAt = lastStreamEventAtRef.current;
      const staleMs = 4500;
      if (!lastStreamAt || Date.now() - lastStreamAt < staleMs) return;

      // typing 可能因事件丢失而卡住：此处主动解除，避免用户只能靠刷新看见内容
      typingSessionsRef.current.delete(evtKey);
      setTypingSessionKeys(Array.from(typingSessionsRef.current));
      if (evtKey === sessionKeyRef.current) {
        setIsTyping(false);
        clearStallTimer();
        streamingAssistantIndexRef.current = null;
      }
    }

    // 流刚结束的冷却窗口内忽略 session.message，避免 transcript 推送追加重复消息
    const grace = streamEndGraceRef.current;
    if (grace && grace.key === evtKey && Date.now() < grace.until && !bypassSessionMessageGuards) return;

    let content = formatMessageContent(msg.content);
    if (!content || !content.trim()) return;

    const thinkingLabel = t('chat.thinking');
    const deepThinkingLabel = t('chat.deepThinking', { defaultValue: '深度思考中...' });
    // 网关偶发把「正在思考」占位文案当作一条 assistant transcript 追加在正式回复之后
    if (msg.role === 'assistant' && isAssistantUiThinkingPlaceholder(content, thinkingLabel, deepThinkingLabel)) {
      const tail = messagesRef.current[messagesRef.current.length - 1];
      if (tail?.role === 'assistant' && assistantMessageLooksSubstantial(tail.content || '', thinkingLabel, deepThinkingLabel)) {
        return;
      }
    }

    // 如果是审批提示语且审批卡片已存在，则忽略（避免重复提示）
    if (isApprovalHintText(content)) {
      const slug = extractApprovalSlugFromHint(content);
      if (slug && hasApprovalCardForSlug(messagesRef.current || [], slug)) return;
    }

    const normalizedNoise = normalizeTranscriptNoise(content);
    content = normalizedNoise.content;

    const msgId = msg.id || payload.messageId || `msg-sm-${Date.now()}`;

    setMessages(prev => {
      if (prev.some(m => m.id === msgId)) return prev;

      // 网关持久化会把一次 run 拆成多条 assistant 消息（toolCall 骨架 + 正文等）。
      // 本 UI 只用「主气泡(正文)」和「_uiMetaOnly 气泡(思考信息附录)」两条承载同一个 run：
      // 1) role=assistant 且内容看起来是"只有 metadata、没有正文"的骨架消息 -> 直接丢弃；UI 已在 meta 气泡里展示更完整内容。
      // 2) role=assistant 且 runId 匹配到主气泡 -> 合并 transcript 到主气泡，不新增气泡。
      if (msg.role === 'assistant') {
        const { metadata: incomingMeta, transcript: incomingTranscript } = partitionAssistantContent(content || '');
        const isSkeleton = !!incomingMeta && !incomingTranscript.trim();
        if (isSkeleton) return prev;

        if (msg.runId) {
          // 必须用 findLastIndex：与 handleChatDelta 的「按 runId 找最后一条主气泡」一致。
          // 若用 findIndex 命中上一条（含审批卡片的）气泡，而流式正文写在列表末尾的新气泡上，会出现两条完整输出。
          const existingIdx = prev.findLastIndex(
            m => m.role === 'assistant' && !m._uiMetaOnly && m.runId === msg.runId,
          );
          if (existingIdx !== -1) {
            const existing = prev[existingIdx];
            const thinkingPlaceholder = t('chat.thinking');
            const deepThinkingPlaceholder = t('chat.deepThinking', { defaultValue: '深度思考中...' });
            const isValidBody = (s: string) =>
              !!s && s !== thinkingPlaceholder && s !== deepThinkingPlaceholder;

            const bodyText = incomingTranscript || content;
            const bt = bodyText.trim();
            let mergedContent = existing.content;
            if (isValidBody(bodyText)) {
              const ex = existing.content.trim();
              if (!isValidBody(existing.content)) {
                mergedContent = bodyText;
              } else if (bt && (ex.includes(bt) || (bt.length >= 60 && bt.includes(ex)))) {
                // 流式已写入或 transcript 为子集/同文，避免整段替换把审批块冲掉或造成双份
                mergedContent = existing.content;
              } else if (!ex.includes(bt)) {
                mergedContent = bodyText;
              }
            }

            if (mergedContent === existing.content) return prev;
            const next = [...prev];
            next[existingIdx] = { ...existing, content: mergedContent };
            return next;
          }
        }

        // chat.delta 已把同一段正文写进「最后一条主气泡」后，session.message 又以新 id 追加一条时拦截（无 runId 或 runId 未对齐）
        const incomingBodyDedup = (incomingTranscript || content).trim();
        if (incomingBodyDedup.length > 80) {
          const lastMainIdx = findLastMainAssistantIndex(prev);
          if (lastMainIdx !== -1) {
            const { transcript: lastT } = partitionAssistantContent(prev[lastMainIdx].content || '');
            const lastBody = (lastT || prev[lastMainIdx].content || '').trim();
            if (lastBody.length > 80 && lastBody === incomingBodyDedup) return prev;
          }
        }
      }

      // 内容级去重（metadata 感知）：比较 transcript 部分而非全内容，避免"UI 是 metadata+正文，推送只有正文"被误认为不同
      const tail = prev.slice(-3);
      const incomingTrim = content.trim();
      if (tail.some(m => {
        if (m.content === content) return true;
        const { transcript: mTranscript } = partitionAssistantContent(m.content || '');
        return mTranscript && mTranscript === incomingTrim;
      })) return prev;

      const rawTs = new Date(msg.createdAt || msg.timestamp || Date.now()).getTime();
      const newMsg = {
        id: msgId,
        runId: msg.runId,
        role: (msg.role === 'toolResult' || normalizedNoise.forceAssistantRole) ? 'assistant' : msg.role,
        content,
        timestamp: new Date(rawTs).toLocaleTimeString(),
        _sortTs: rawTs,
        senderLabel: msg.senderLabel || payload.senderLabel
      } as Message;
      const merged = mergeTrailingThinkingIntoPreviousAssistant(prev, newMsg);
      if (merged) return merged;
      return [...prev, newMsg];
    });
  }, [clearStallTimer, t]);

  /**
   * 处理 session.tool 事件：展示工具调用进度。
   * phase=start 时追加工具调用标记，phase=end/error 时更新状态。
   */
  const handleSessionTool = useCallback((payload: any) => {
    if (!payload) return;
    const { sessionKey: evtKey, data: toolData } = payload;
    if (!evtKey || evtKey !== sessionKeyRef.current) return;
    if (!toolData) return;

    const phase = (toolData.phase as string) || '';
    const toolName = toolData.toolName || toolData.name || toolData.tool || 'tool';
    const toolId = toolData.toolCallId || toolData.callId || toolData.id || `${toolName}-${Date.now()}`;
    const marker = `tool:${toolId}`;
    // 优先用 payload 自带 runId，其次用当前 streaming 主气泡的 runId 兜底
    const runId = (toolData.runId as string | undefined) || (payload.runId as string | undefined);

    const argsRaw = pickFirst(toolData, ['arguments', 'args', 'input', 'params', 'command', 'cmd', 'request']);
    const resultRaw = phase === 'end' || phase === 'error'
      ? pickFirst(toolData, ['result', 'output', 'stdout', 'response', 'data', 'error'])
      : undefined;

    const buildToolBody = (currentStatus: 'running' | 'done' | 'failed') => {
      return buildSessionToolBody(toolName, marker, currentStatus, argsRaw, resultRaw);
    };

    if (phase === 'start' || phase === '') {
      if (!showThinkingRef.current) return;
      
      const cache = getOrCreateSessionCache(evtKey);
      if (runId) cache.activeRuns.add(runId);

      setMessages(prev => {
        const mainMsg = prev.find(m => !m._uiMetaOnly && m.role === 'assistant' && m.runId === runId);
        const effectiveRunId = runId || mainMsg?.runId
          || prev.slice().reverse().find(m => !m._uiMetaOnly && m.role === 'assistant' && m.runId)?.runId;
        const body = buildToolBody('running');
        return updateMetaMessage(prev, effectiveRunId, (current) =>
          upsertAgentBlock(current, 'toolCall', toolId, toolName, body),
        );
      });
    } else if (phase === 'end' || phase === 'error') {
      const status: 'done' | 'failed' = phase === 'end' ? 'done' : 'failed';
      setMessages(prev => {
        const metaMatchIdx = prev.findIndex(m =>
          m._uiMetaOnly &&
          (runId ? m.runId === runId : true) &&
          m.content.includes(`toolCall:${toolId}`),
        );
        const effectiveRunId = runId
          || (metaMatchIdx !== -1 ? prev[metaMatchIdx].runId : undefined)
          || prev.slice().reverse().find(m => !m._uiMetaOnly && m.role === 'assistant' && m.runId)?.runId;
        const body = buildToolBody(status);
        return updateMetaMessage(prev, effectiveRunId, (current) =>
          upsertAgentBlock(current, 'toolCall', toolId, toolName, body),
        );
      });
    }
  }, [getOrCreateSessionCache, showThinkingRef, t]);

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
    if (evt === 'sessions.changed') {
      const payload = data.payload || {};
      const evtKey = payload.sessionKey || payload.key || payload.session?.key;
      if (evtKey) {
        // transcript 落盘会推 phase "message"，快照里 status 常仍为 running（lifecycle end 尚未写库）。
        // 若仍写入 sessionStatusMapRef 并 setIsTyping(true)，会在 chat.final 之后把 UI 重新锁死；
        // releaseTypingLock 又因 globalStatus === 'running' 直接 return，形成永久卡住。
        if (payload.phase !== 'message') {
          const oldStatus = sessionStatusMapRef.current.get(evtKey);
          const newStatus = payload.status || payload.session?.status || payload.data?.status;
          const statusStr = String(newStatus || '').toLowerCase();
          const running = isSessionRunningStatus(statusStr);
          const terminal = isSessionTerminalStatus(statusStr);
          if (terminal) {
            sessionStatusMapRef.current.delete(evtKey);
            const cache = sessionCacheRef.current.get(evtKey);
            if (cache) {
              cache.isTyping = false;
              cache.activeRuns?.clear();
            }
            markSessionTyping(evtKey, false);
          } else if (running) {
            sessionStatusMapRef.current.set(evtKey, 'running');
            markSessionTyping(evtKey, true);
          } else if (newStatus) {
            sessionStatusMapRef.current.set(evtKey, statusStr);
          }

          // 如果状态变更为 done/error，且当前会话无活跃运行中 run，尝试触发延时解锁。
          if (evtKey === sessionKeyRef.current && running) {
            setIsTyping(true);
            // 仅当状态从非 running 切换到 running 时才重置 stall 计时器（初始化）。
            // 后续在该状态下的元数据更新（如 token count 变化）不应重置它，否则会遮蔽“文字流停顿”的提示
            if (oldStatus !== 'running') {
              resetStallTimer();
            }
          } else if (terminal) {
            releaseTypingLock(evtKey);
          }
        }
      }
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
        lastStreamEventAtRef.current = Date.now();
        if (effectiveKey) cancelPendingFinalUiRelease(effectiveKey);
        setIsTyping(false);
        clearStallTimer();
        streamingAssistantIndexRef.current = null;
      }

      if (stream === 'lifecycle.start' || (stream === 'lifecycle' && agentData?.phase === 'start')) {
        lastStreamEventAtRef.current = Date.now();
        if (effectiveKey) {
          const cache = getOrCreateSessionCache(effectiveKey);
          const runId = (agentData?.runId as string | undefined) || (data.payload?.runId as string | undefined);
          if (runId) cache.activeRuns.add(runId);

          cancelPendingFinalUiRelease(effectiveKey);
          markSessionTyping(effectiveKey, true);
        }
        if (effectiveKey === sessionKeyRef.current) {
          setIsTyping(true);
        }
      }

      if (stream === 'lifecycle.end' || (stream === 'lifecycle' && agentData?.phase === 'end')) {
        lastStreamEventAtRef.current = Date.now();
        if (effectiveKey) {
          const cache = getOrCreateSessionCache(effectiveKey);
          const runId = (agentData?.runId as string | undefined) || (data.payload?.runId as string | undefined);
          if (runId) cache.activeRuns.delete(runId);

          if (effectiveKey === sessionKeyRef.current) {
            clearStallTimer();
          }
          // 统一使用 releaseTypingLock 延迟释放。
          // 不再检查 .has(effectiveKey)，以便后续到达的 lifecycle.end 能够“刷新”并延长释锁时间，防止提前释放。
          releaseTypingLock(effectiveKey);
        }
      }

      if (stream === 'lifecycle.error' || (stream === 'lifecycle' && agentData?.phase === 'error')) {
        lastStreamEventAtRef.current = Date.now();
        if (effectiveKey) {
          const cache = getOrCreateSessionCache(effectiveKey);
          const runId = (agentData?.runId as string | undefined) || (data.payload?.runId as string | undefined);
          if (runId) cache.activeRuns.delete(runId);

          cancelPendingFinalUiRelease(effectiveKey);
          markSessionTyping(effectiveKey, false);
        }
        if (effectiveKey === sessionKeyRef.current) {
          clearStallTimer();
          setIsTyping(false);
          streamingAssistantIndexRef.current = null;

          const errMsg = extractAgentErrorMessage(agentData) || 'Agent error';

          setMessages(prev => {
            // 1) 找到最近一条主气泡（非 meta），追加 Agent 错误 banner
            const mainIdx = prev.findLastIndex(m => !m._uiMetaOnly && m.role === 'assistant');
            if (mainIdx === -1) return prev;
            const main = prev[mainIdx];

            const isPlaceholder =
              !main.content ||
              main.content === t('chat.thinking') ||
              main.content === t('chat.deepThinking', { defaultValue: '深度思考中...' });
            const mainNextContent = isPlaceholder
              ? `> **⚠️ Agent 错误**\n> ${errMsg}`
              : `${main.content}\n\n> **⚠️ Agent 错误**\n> ${errMsg}`;

            const next = prev.map((m, i) => {
              if (i === mainIdx) return { ...m, content: mainNextContent };
              if (m._uiMetaOnly && m.runId === main.runId) {
                const sealed = sealPendingToolMarkers(m.content || '');
                if (sealed === m.content) return m;
                return { ...m, content: sealed };
              }
              return m;
            });
            return next;
          });
        }
      }

      // 处理实时流：thinking / plan / command_output / tool
      // 事件数据结构常见字段：{ itemId, phase: start|delta|end, title, toolCallId, name,
      //   output|content|text|delta|chunk|stdout|stderr|reasoning|thinking,
      //   arguments|args|input|params|command, result, status }
      // 同一个 itemId 在整个运行期间只对应一个折叠块（按 itemId 做 upsert / append）。
      if (isAgentMetadataStream(stream)) {
        if (!effectiveKey || effectiveKey !== sessionKeyRef.current) return;

        // transcript 已 final 但 agent 侧仍在推 thinking/tool：撤掉 final 的延时解锁，并保持会话「生成中」
        const cache = getOrCreateSessionCache(effectiveKey);
        const runId = (agentData?.runId as string | undefined)
          || (data.payload?.runId as string | undefined)
          || (streamingAssistantIndexRef.current !== null
            ? messagesRef.current[streamingAssistantIndexRef.current!]?.runId
            : undefined);
        if (runId) cache.activeRuns.add(runId);

        cancelPendingFinalUiRelease(effectiveKey);
        markSessionTyping(effectiveKey, true);
        lastStreamEventAtRef.current = Date.now();
        // 💡 根据用户要求：工具调用和计划更新不再重置 stall 计时器，
        // 只有收到真正的文字 delta 才会重置，这样在长时工具执行期间会准时显示安抚文案。
        setIsTyping(true);

        const { itemId, title, body, deltaOnly, segmentName } = formatAgentMetadataEvent(stream, agentData);

        if (!body && !title) {
          // 已在上方锁定 UI；无 meta 可写则跳过 setMessages（避免空事件误刷列表）
          return;
        }

        setMessages(prev => {
          const idx = streamingAssistantIndexRef.current;
          const mainMsg = (idx !== null && idx >= 0 && idx < prev.length) ? prev[idx] : undefined;
          const runId = (agentData?.runId as string | undefined)
            || (data.payload?.runId as string | undefined)
            || mainMsg?.runId
            || prev.slice().reverse().find(m => !m._uiMetaOnly && m.role === 'assistant' && m.runId)?.runId;

          return updateMetaMessage(prev, runId, (current) =>
            deltaOnly
              ? appendToAgentBlock(current, segmentName, itemId, body, title)
              : upsertAgentBlock(current, segmentName, itemId, title, body),
          );
        });
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
  }, [cancelPendingFinalUiRelease, clearStallTimer, getOrCreateSessionCache, handleApprovalRequested, handleApprovalResolved, handleChatDelta, handleSessionMessage, handleSessionTool, markSessionTyping, releaseTypingLock, resetStallTimer, t]);

  /**
   * 加载会话历史并写入 messages；同时用 sessionCacheRef 缝合 DB 未落盘的临时消息。
   */
  const loadSessionHistory = useCallback(async (key: string) => {
    const requestId = ++historyRequestSeqRef.current;
    latestHistoryRequestRef.current = requestId;
    setIsLoadingHistory(true);
    streamingAssistantIndexRef.current = null;

    const res = await sendRPC('chat.history', { sessionKey: key, limit: CHAT_HISTORY_PANEL_LIMIT });
    const isActiveRequest = () =>
      latestHistoryRequestRef.current === requestId && sessionKeyRef.current === key;

    if (!res.ok) {
      if (latestHistoryRequestRef.current === requestId) {
        setIsLoadingHistory(false);
      }
      return;
    }

    const rawItems = res.payload.messages || res.payload.items || [];
    const history = buildHistoryMessages(rawItems);
    const cache = sessionCacheRef.current.get(key);

    // 还原缓存里保留的 thinking/plan/toolCall 等折叠块：
    // 这些 metadata 只在 WS 的 agent / session.tool 事件里出现，DB transcript 通常不持久化它们。
    // 新架构下 metadata 不再贴到主消息 content，而是以独立的 _uiMetaOnly 气泡插入到对应主消息后面。
    // 注意：同一 runId 可能有多条 assistant 消息（思考/工具/正文被拆），meta 气泡只插在最后一条后面，避免重复。
    restoreCachedMetadataMessages(history, cache);

    let shouldKeepTyping = false;
    if (cache) {
      touchAndPruneSessionCache(key, cache);
      shouldKeepTyping = mergeSessionCacheIntoHistory(history, cache);
    }

    const finalMessages = sortMessagesByTimeline(history);
    stripTrailingUiThinkingPlaceholderAfterAssistantReply(
      finalMessages,
      t('chat.thinking'),
      t('chat.deepThinking', { defaultValue: '深度思考中...' }),
    );

    // v3 增强：切回会话时，除了看本地 1s 延时锁，也要看网关推来的全局 status 是否仍为 running
    if (!shouldKeepTyping && (typingSessionsRef.current.has(key) || sessionStatusMapRef.current.get(key) === 'running')) {
      shouldKeepTyping = true;
    }

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
        scrollRef.current?.scrollTo({
          top: scrollRef.current.scrollHeight,
          behavior: 'auto'
        });
      }, 50);
    }
    setIsLoadingHistory(false);
  }, [clearStallTimer, resetStallTimer, scrollRef, sendRPC, t, touchAndPruneSessionCache, virtuosoRef]);

  /**
   * 发送消息：必要时创建会话并写入初始占位消息，然后向网关发起 chat.send。
   */
  const handleSend = useCallback(async (content?: any, attachedFiles?: FileInfo[]) => {
    const text = (typeof content === 'string' ? content : '').trim();
    if (isTyping) return;
    if (sessionComposeBlocked) return;
    if ((!text && (!attachedFiles || attachedFiles.length === 0)) || status !== 'authenticated') return;

    cancelPendingFinalUiRelease();
    abortRequestedRef.current = null;
    setIsTyping(true);
    setTpsData([]);
    chatEventSeenSinceSendRef.current = false;
    hadTypingSinceSendRef.current = true;

    let currentKey = sessionKeyRef.current ?? sessionKey;
    if (!currentKey) {
      const agentId = selectedBot.replace('openclaw:', '');
      const key = buildBuddyDirectSessionKey(agentId, usernameForSessionKey);
      // 不传 label，保持空标题，便于后续「无标题时自动总结」逻辑触发
      const res = await sendRPC('sessions.create', { agentId, key });
      if (res.ok) {
        currentKey = (res.payload?.key as string | undefined) || key;
        setSessionKey(currentKey);
        // 兼容：部分网关版本只认 key 字段
        sendRPC('sessions.messages.subscribe', { key: currentKey }).catch(() => {});
        // 不在此处 await patch：否则会拖住首条消息的 setMessages，会话区体感「卡住」。
        void sendRPC('sessions.patch', { key: currentKey, thinkingLevel, model: sessionModel }).catch(() => {});
        // 静默刷新列表，避免 setLoadingSessions(true) + 300ms 最短 loading 与首屏消息抢同一帧
        queueMicrotask(() => {
          fetchSessions(true);
        });
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

    const finalContent = buildSendMessageContent(text, attachedFiles);

    const now = Date.now();
    const newUserMsg = createUserMessage(finalContent, now);

    const assistantInitialMsg = text === '/stop' ? t('chat.terminated') : t('chat.thinking');
    const aiPlaceholderMsg = createAssistantPlaceholder(assistantInitialMsg, now);

    const prevCacheForSession = sessionCacheRef.current.get(currentKey);
    const nextCache = createTypingSessionCache(newUserMsg, prevCacheForSession);
    touchAndPruneSessionCache(currentKey, nextCache);

    setMessages(prev => {
      const next = [...prev, newUserMsg, aiPlaceholderMsg];
      streamingAssistantIndexRef.current = next.length - 1;
      return next;
    });
    resetStallTimer();

    setTimeout(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
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
        cache.activeRuns.add(res.payload.runId);
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
      cancelPendingFinalUiRelease();
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
      cancelPendingFinalUiRelease();
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
  }, [cancelPendingFinalUiRelease, clearStallTimer, fetchSessions, inputAreaRef, isTyping, markSessionTyping, resetStallTimer, scrollRef, selectedBot, sendRPC, sessionComposeBlocked, sessionKey, sessionModel, setSessionKey, status, t, thinkingLevel, touchAndPruneSessionCache, virtuosoRef]);

  /**
   * 重试/再生成：复用既有的 User 消息，不额外创建新的 User 消息。
   */
  const resendFromExistingUserMessage = useCallback(async (userMsg: Message) => {
    if (!sessionKey) return;
    if (status !== 'authenticated') return;
    if (isTyping) return;
    if (sessionComposeBlocked) return;

    cancelPendingFinalUiRelease();
    const finalContent = (userMsg.content || '').trim();
    if (!finalContent) return;

    setIsTyping(true);
    setTpsData([]);
    chatEventSeenSinceSendRef.current = false;
    hadTypingSinceSendRef.current = true;
    // 重试/再生成：立刻标记“正在生成中”，覆盖首 token 空窗期
    markSessionTyping(sessionKey, true);

    const baseSortTs = userMsg._sortTs || Date.now();
    const placeholderNow = Date.now();
    const aiPlaceholderMsg = createAssistantPlaceholder(t('chat.thinking'), placeholderNow, baseSortTs + 1);

    const prevCacheForSession = sessionCacheRef.current.get(sessionKey);
    const nextCache = createTypingSessionCache(userMsg, prevCacheForSession);
    touchAndPruneSessionCache(sessionKey, nextCache);

    setMessages(prev => {
      const next = [...prev, aiPlaceholderMsg];
      streamingAssistantIndexRef.current = next.length - 1;
      return next;
    });
    resetStallTimer();

    setTimeout(() => {
      scrollRef.current?.scrollTo({
        top: scrollRef.current.scrollHeight,
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
        cache.activeRuns.add(res.payload.runId);
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
      cancelPendingFinalUiRelease();
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
  }, [cancelPendingFinalUiRelease, clearStallTimer, isTyping, markSessionTyping, resetStallTimer, scrollRef, sendRPC, sessionComposeBlocked, sessionKey, status, t, touchAndPruneSessionCache, virtuosoRef]);

  /**
   * 停止生成：更新 UI 并通过 chat.abort 中止 Agent 运行，不污染对话历史。
   */
  const handleStopGeneration = useCallback(async () => {
    if (!sessionKey) return;
    if (status !== 'authenticated') return;

    cancelPendingFinalUiRelease();
    abortRequestedRef.current = { key: sessionKey, ts: Date.now() };
    setIsTyping(false);
    clearStallTimer();
    streamingAssistantIndexRef.current = null;
    markSessionTyping(sessionKey, false);
    streamEndGraceRef.current = { key: sessionKey, until: Date.now() + 3000 };

    setMessages(prev => {
      // 1) 找最近主气泡（跳过 meta 附录），追加「(已手动停止)」标签
      const mainIdx = prev.findLastIndex(m => !m._uiMetaOnly && m.role === 'assistant');
      if (mainIdx === -1) return prev;
      const main = prev[mainIdx];
      const label = t('chat.manuallyStopped', { defaultValue: '已手动停止' });
      const mainContent = (main.content === t('chat.thinking') || !main.content) ? label : main.content + ` (${label})`;

      return prev.map((m, i) => {
        if (i === mainIdx) return { ...m, content: mainContent };
        if (m._uiMetaOnly && m.runId === main.runId) {
          const sealed = sealPendingToolMarkers(m.content || '');
          if (sealed === m.content) return m;
          return { ...m, content: sealed };
        }
        return m;
      });
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
  }, [cancelPendingFinalUiRelease, clearStallTimer, markSessionTyping, sendRPC, sessionKey, status, t]);

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
    if (sessionComposeBlocked) return;
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
      const aiPlaceholderMsg = createAssistantPlaceholder(t('chat.thinking'), Date.now(), baseSortTs + 1);
      const prevCacheForSession = sessionCacheRef.current.get(currentKey);
      const nextCache = createTypingSessionCache(updatedUser, prevCacheForSession);
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
        if (cache) {
          cache.runId = res.payload.runId;
          cache.activeRuns.add(res.payload.runId);
        }
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
  }, [clearStallTimer, handleSend, isTyping, markSessionTyping, resetStallTimer, sendRPC, sessionComposeBlocked, status, t, touchAndPruneSessionCache]);

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

  const lastAutoSyncedKeyRef = useRef<string | null>(null);
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    const key = sessionKeyRef.current;

    // 状态从非 authenticated 变为 authenticated 时，重置同步锁
    if (status === 'authenticated' && prev !== 'authenticated') {
      lastAutoSyncedKeyRef.current = null;
    }

    if (status !== 'authenticated' || !key) {
      lastAutoSyncedKeyRef.current = null;
      return;
    }

    // 💡 核心保护：如果在当前认证会话中，该 Key 已经自动同步过历史，则不再重复触发
    if (lastAutoSyncedKeyRef.current === key) return;

    // 标记已同步，防止死循环
    lastAutoSyncedKeyRef.current = key;

    void (async () => {
      const cache = sessionCacheRef.current.get(key);
      if (cache && cache.isTyping) {
        // 断线前有流正在进行：先向网关确认当前会话状态，避免重连时把后台仍在跑的任务误清掉。
        setIsStalled(true);
        streamingAssistantIndexRef.current = null;

        const res = await sendRPC('sessions.get', { key, limit: 1 });
        if (sessionKeyRef.current !== key) return;

        const sessionDetail = res.ok
          ? (res.payload?.session || res.payload?.item || res.payload?.data || res.payload)
          : null;
        const remoteStatus = String(sessionDetail?.status || '').toLowerCase();

        if (isSessionRunningStatus(remoteStatus)) {
          sessionStatusMapRef.current.set(key, 'running');
          markSessionTyping(key, true);
          setIsTyping(true);
        } else if (isSessionTerminalStatus(remoteStatus)) {
          sessionStatusMapRef.current.delete(key);
          cache.isTyping = false;
          markSessionTyping(key, false);
          setIsTyping(false);
          clearStallTimer();
        }
      }

      // 无论如何都重新加载历史，确保与服务端状态一致
      loadSessionHistory(key);
    })();
  }, [status, loadSessionHistory, markSessionTyping, sendRPC, clearStallTimer]);

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
      const injectedMsg = createInjectedAssistantMessage(res.payload?.messageId, trimmed, rawTs);
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
      getMessagesCount: () => messagesCountRef.current,
      resetTypingState,
    };
  }, [handleApprovalRequested, handleChatDelta, handleGatewayEvent, handleInjectMessage, handleRegenerate, handleSaveEdit, handleSend, handleStopGeneration, hasNewMessages, isLoadingHistory, isStalled, isTyping, messages, resetTypingState, setMessages, tpsData, typingSessionKeys, showScrollBtnRef]);
}
