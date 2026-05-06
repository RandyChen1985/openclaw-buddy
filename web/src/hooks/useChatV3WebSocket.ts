import { useState, useEffect, useRef, useMemo } from 'react';
// antd message 已下沉到子模块（sessions/messages/summarize）内部处理
import storage from '../utils/storage';
import { useV3Gateway } from '../context/V3GatewayContext';
import { useV3Messages } from './chatV3/useV3Messages';
import { useV3AutoSummarize } from './chatV3/useV3AutoSummarize';
import { useV3Sessions } from './chatV3/useV3Sessions';
import { useV3UntitledAutoTitle } from './chatV3/useV3UntitledAutoTitle';
import { isUntitledSessionLabel } from './chatV3/labelUtils';

export interface FileInfo {
  url: string;
  thumbUrl?: string;
  path: string;
  filename: string;
  size: number;
  ext: string;
  type?: 'workspace_file' | 'skill';
  entityId?: string;
}

export interface Message {
  id: string;
  runId?: string; // 💡 事务标识：用于精准追踪流式响应属于哪一轮对话
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  _sortTs?: number; // 💡 排序权重：毫秒级时间戳，用于消灭 UI 乱序
  /**
   * 纯前端展示用的"思考信息附录气泡"：只承载 agent/session.tool 事件产生的
   * thinking/plan/toolCall/commandOutput 折叠块，跟在对应正文消息后面显示。
   * 不对应任何持久化消息，不参与 session.message 的合并/去重，刷新页面后丢失。
   */
  _uiMetaOnly?: boolean;
  metrics?: {
    ttft?: number;
    duration?: number;
    tps?: number;
  };
  senderLabel?: string;
  _thinkStartedAt?: number; // 💡 记录思考开始时间戳，用于 UI 跨组件重绘时保持计时器不重置
}

interface UseChatV3WebSocketProps {
  selectedBot: string;
  setSelectedBot: (bot: string) => void;
  botsModels: any;
  t: any;
  inputAreaRef: React.RefObject<any>;
  virtuosoRef: React.RefObject<any>;
  scrollRef: React.RefObject<HTMLDivElement>;
  /** 与「显示思考或工具调用」开关同步；关闭时不注入 session.tool 进度行 */
  showThinkingRef: React.MutableRefObject<boolean>;
  onLog?: (log: any) => void;
}

export const useChatV3WebSocket = ({
  selectedBot,
  setSelectedBot,
  botsModels,
  t,
  inputAreaRef,
  virtuosoRef,
  scrollRef,
  showThinkingRef,
  onLog
}: UseChatV3WebSocketProps) => {
  const {
    status,
    connect,
    sendRPC,
    lastHealth,
    latencyHistory,
    pulse,
    registerHandlers,
    unregisterHandlers
  } = useV3Gateway();
  // --- States ---
  const [sessionKey, setSessionKey] = useState<string | null>(() => storage.getItem('v3_current_session_key'));
  const [sessionLabel, setSessionLabel] = useState<string | null>(() => storage.getItem('v3_current_session_label'));
  const [sessionModel, setSessionModel] = useState<string>('');

  const [thinkingLevel, setThinkingLevel] = useState<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'>('medium');

  // --- Refs ---
  const sessionKeyRef = useRef<string | null>(null);
  useEffect(() => { sessionKeyRef.current = sessionKey; }, [sessionKey]);
  const autoSummarizeRef = useRef<any>(null);
  
  const sessionLabelRef = useRef<string | null>(null);
  useEffect(() => { sessionLabelRef.current = sessionLabel; }, [sessionLabel]);

  const showScrollBtnRef = useRef(false);

  // 消息层 API 引用（用于在网关事件路由中调用，避免 TDZ）
  const messagesApiRef = useRef<null | {
    handleChatDelta: (payload: any) => void;
    handleApprovalRequested: (payload: any) => void;
    handleGatewayEvent: (data: any) => void;
  }>(null);
  const sessionMessageOpsRef = useRef<{
    setMessages?: (updater: ((prev: Message[]) => Message[]) | Message[]) => void;
    loadSessionHistory?: (key: string) => Promise<void> | void;
    setHasNewMessages?: (val: boolean) => void;
    getMessagesCount?: () => number;
    resetTypingState?: () => void;
  }>({});

  /**
   * 网关事件处理函数引用（通过 ref 注入），用于避免“连接层在上游，而业务处理函数在下游”造成的 TDZ 问题。
   */
  const gatewayEventHandlerRef = useRef<((data: any) => void) | null>(null);

  const handlers = useMemo(() => ({
    onEvent: (data: any) => gatewayEventHandlerRef.current?.(data),
    onLog
  }), [onLog]);

  useEffect(() => {
    registerHandlers('chat-v3-view', handlers);
    return () => unregisterHandlers('chat-v3-view');
  }, [handlers, registerHandlers, unregisterHandlers]);

  const {
    sessions,
    setSessions,
    sessionListLoading,
    isCreatingNewSession,
    isUpdatingLabel,
    fetchSessions,
    handleGatewayEvent: handleSessionsGatewayEvent,
    handleSelectSession,
    startNewSession,
    handleUpdateLabel,
    handleDeleteSession,
    handleDeleteGroup,
    handleClearAllHistory,
    handleModelChange,
    handleThinkingLevelChange,
    handleCompactSession,
    fetchMoreSessions,
    hasMoreSessions
  } = useV3Sessions({
    t,
    sendRPC,
    status,
    sessionKey,
    setSessionKey,
    sessionLabel,
    setSessionLabel,
    setSessionModel,
    setThinkingLevel,
    setSelectedBot,
    selectedBot,
    sessionModel,
    thinkingLevel,
    messageOpsRef: sessionMessageOpsRef,
    inputAreaRef
  });

  const {
    messages: v3Messages,
    setMessages: setV3Messages,
    isTyping,
    isStalled,
    isLoadingHistory,
    tpsData,
    hasNewMessages,
    setHasNewMessages,
    typingSessionKeys,
    handleChatDelta,
    loadSessionHistory,
    handleSend,
    handleStopGeneration,
    handleRegenerate,
    handleSaveEdit,
    handleInjectMessage,
    handleApprovalRequested,
    handleGatewayEvent,
    getMessagesCount,
    resetTypingState
  } = useV3Messages({
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
    showScrollBtnRef,
    showThinkingRef,
    sessionComposeBlocked: isCreatingNewSession
  });

  useEffect(() => {
    sessionMessageOpsRef.current = {
      setMessages: setV3Messages,
      loadSessionHistory,
      setHasNewMessages,
      getMessagesCount,
      resetTypingState
    };
  }, [getMessagesCount, loadSessionHistory, resetTypingState, setHasNewMessages, setV3Messages]);

  // 与网关事件路由兼容：将 chat delta 处理函数注入 ref
  useEffect(() => {
    messagesApiRef.current = { handleChatDelta, handleApprovalRequested, handleGatewayEvent };
  }, [handleApprovalRequested, handleChatDelta, handleGatewayEvent]);

  // 直接透传 v3Messages 作为 messages 的单一来源，避免双重同步导致的 2x 渲染

  /**
   * 注入网关事件路由：将连接层 event 分发到 chat/sessions/approval 等业务处理。
   */
  useEffect(() => {
    gatewayEventHandlerRef.current = (data: any) => {
      if (!data || data.type !== 'event') return;
      handleSessionsGatewayEvent(data);
      messagesApiRef.current?.handleGatewayEvent(data);
    };
    return () => {
      gatewayEventHandlerRef.current = null;
    };
  }, [handleSessionsGatewayEvent]);

  const { isSummarizing, handleAutoSummarize } = useV3AutoSummarize({
    t,
    sessionKey,
    sessionLabel,
    selectedBot,
    botsModels,
    sessions,
    sendRPC,
    onLocalLabelPatched: (key, newLabel) => {
      if (key === sessionKey) setSessionLabel(newLabel);
      setSessions(prev => prev.map(s => s.key === key ? { ...s, label: newLabel } : s));
    }
  });
  autoSummarizeRef.current = handleAutoSummarize;

  /**
   * 当前会话自动补全标题（收敛触发源，避免在 UI 层与后台扫描层重复触发）。
   *
   * 触发条件：
   * - 已认证
   * - 当前会话存在且未命名
   * - 非 typing，且已有足够上下文（>=2 条）
   */
  useEffect(() => {
    if (status !== 'authenticated') return;
    if (!sessionKey) return;
    if (isTyping) return;
    if (isSummarizing) return;
    if (v3Messages.length < 2) return;
    const listLabel = sessions.find((s: any) => s.key === sessionKey)?.label;
    const effectivelyUntitled =
      isUntitledSessionLabel(sessionLabel) && isUntitledSessionLabel(listLabel);
    if (!effectivelyUntitled) return;

    const timer = setTimeout(() => {
      // silent=true：避免频繁 toast；force=false：遵循“自动不覆盖已有标题”的语义
      handleAutoSummarize(v3Messages, true, sessionKey, false);
    }, 1000);
    return () => clearTimeout(timer);
  }, [handleAutoSummarize, isSummarizing, isTyping, v3Messages, sessionKey, sessionLabel, sessions, status]);

  // 后台任务：为未命名会话自动补全标题（去抖 + 并发控制 + 可取消）
  useV3UntitledAutoTitle({
    status,
    sessions,
    sendRPC,
    handleAutoSummarize
  });

  /**
   * 切换会话时：如果“刚离开的上一个会话”仍未命名，则尝试为它补全标题。
   *
   * 说明：
   * - 这是“切走时补标题”的用户期望（当前会话的自动补标题仍保留）。
   * - 真正的去重/限频在 useV3AutoSummarize 内部（2 分钟内同一 key 不重复）。
   * - silent=true：不打扰用户（失败会在控制台有错误日志）。
   */
  const prevSessionKeyRef = useRef<string | null>(null);
  useEffect(() => {
    const prevKey = prevSessionKeyRef.current;
    prevSessionKeyRef.current = sessionKey;

    if (status !== 'authenticated') return;
    if (!prevKey) return;
    if (!sessionKey) return;
    if (prevKey === sessionKey) return;
    if (prevKey === 'agent:main:main') return;

    const prevLabel = sessions.find((s: any) => s.key === prevKey)?.label;
    if (!isUntitledSessionLabel(prevLabel)) return;

    void (async () => {
      const hRes = await sendRPC('chat.history', { sessionKey: prevKey, limit: 10 });
      if (!hRes.ok) return;
      const raw = hRes.payload?.messages || hRes.payload?.items || [];
      if (!Array.isArray(raw) || raw.length === 0) return;

      const msgs: Message[] = raw.map((m: any) => ({
        id: m.id || `hist-${prevKey}-${Math.random().toString(36).slice(2)}`,
        role: (m.role === 'toolResult' ? 'assistant' : m.role) as any,
        content: (typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')).toString(),
        timestamp: ''
      })).filter((m: any) => (m.content || '').trim().length > 0);

      if (msgs.length < 2) return;
      await handleAutoSummarize(msgs, true, prevKey, false);
    })();
  }, [handleAutoSummarize, sendRPC, sessionKey, sessions, status]);

  return {
    messages: v3Messages, setMessages: setV3Messages,
    status,
    sessionKey, setSessionKey,
    sessionLabel, setSessionLabel,
    sessionModel, setSessionModel,
    thinkingLevel, setThinkingLevel,
    sessions,
    /** 含首屏静默拉取：侧栏空列表时也会为 true，避免误以为「卡住」 */
    loadingSessions: sessionListLoading,
    isCreatingNewSession,
    isLoadingHistory,
    isTyping,
    isStalled,
    lastHealth,
    latencyHistory,
    pulse,
    tpsData,
    hasNewMessages, setHasNewMessages,
    typingSessionKeys,
    isSummarizing,
    isUpdatingLabel,
    fetchSessions,
    handleSelectSession,
    startNewSession,
    loadSessionHistory,
    handleSend,
    handleStopGeneration,
    handleRegenerate,
    handleDeleteSession,
    handleDeleteGroup,
    handleClearAllHistory,
    handleSaveEdit,
    handleInjectMessage,
    handleUpdateLabel,
    handleAutoSummarize,
    handleModelChange,
    handleThinkingLevelChange,
    handleCompactSession,
    fetchMoreSessions,
    hasMoreSessions,
    sendRPC,
    connect,
    showScrollBtnRef
  };
};
