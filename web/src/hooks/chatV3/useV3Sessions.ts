import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message as antdMessage, Modal } from 'antd';
import storage from '../../utils/storage';
import type { Message } from '../useChatV3WebSocket';
import { buildBuddyDirectSessionKey } from '../../utils/buddySessionKey';
import { isUntitledSessionLabel } from './labelUtils';

/** 会话列表每页条数（后端无 offset，通过增大 limit 模拟分页） */
const V3_SESSION_LIST_PAGE_SIZE = 25;

/** 虾兵蟹将「立即聊天」跳转：阻止 fetchSessions 抢先自动选中 agent:main:main；会话创建成功后清除 */
export const V3_QUICK_CHAT_PENDING_KEY = 'v3_quick_chat_pending';

function botIdFromAgentSessionKey(key: string): string {
  if (!key || !key.startsWith('agent:')) return 'main';
  const parts = key.split(':');
  return parts[1] || 'main';
}

export interface UseV3SessionsParams {
  t: any;
  sendRPC: (method: string, params: any) => Promise<any>;
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';
  /** 当前登录用户名（可选）。用于把 username 写入 buddy:direct 会话 key */
  usernameForSessionKey?: string | null;
  /** 普通用户：只加载 key 中包含 username 的会话 */
  filterSessionListByUsername?: boolean;

  sessionKey: string | null;
  setSessionKey: (key: string | null) => void;
  sessionLabel: string | null;
  setSessionLabel: (label: string | null) => void;
  setSessionModel: (model: string) => void;
  setThinkingLevel: (level: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh') => void;

  setSelectedBot: (bot: string) => void;
  selectedBot: string;
  sessionModel: string;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

  /**
   * 消息层操作集合（通过 ref 注入），用于解耦会话层与消息层的互相依赖。
   */
  messageOpsRef: React.MutableRefObject<{
    setMessages?: (updater: ((prev: Message[]) => Message[]) | Message[]) => void;
    loadSessionHistory?: (key: string) => Promise<void> | void;
    setHasNewMessages?: (val: boolean) => void;
    getMessagesCount?: () => number;
    /** 新建/切换会话时平滑过渡生成中状态，避免输入框被 isTyping 锁死或闪烁 */
    resetTypingState?: (nextKey?: string) => void;
  }>;
  inputAreaRef: React.RefObject<any>;
  /** 当前可选 Bot 列表；用于避免 RBAC 仅允许部分 bot 时仍自动选中 agent:main:main */
  botsModels?: any;
}

/**
 * v3 会话层：负责会话列表加载、切换、重命名、删除/清空等 CRUD 逻辑，以及 sessionKey/sessionLabel 的持久化。
 *
 * 说明：该模块不处理 chat 流式与消息发送；这些由消息层负责。
 */
export function useV3Sessions({
  t,
  sendRPC,
  status,
  usernameForSessionKey,
  filterSessionListByUsername,
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
  messageOpsRef,
  inputAreaRef,
  botsModels
}: UseV3SessionsParams) {
  const [isUpdatingLabel, setIsUpdatingLabel] = useState(false);
  const didAutoSelectMainRef = useRef(false);

  const sessionKeyRef = useRef<string | null>(null);
  useEffect(() => { sessionKeyRef.current = sessionKey; }, [sessionKey]);
  const sessionLabelRef = useRef<string | null>(null);
  useEffect(() => { sessionLabelRef.current = sessionLabel; }, [sessionLabel]);
  /** 防止「开启新会话」连点触发多次 sessions.create */
  const creatingNewSessionRef = useRef(false);
  const [isCreatingNewSession, setIsCreatingNewSession] = useState(false);

  /**
   * 将当前会话 key/label 原子化持久化，避免 UI 重挂载后丢失。
   */
  useEffect(() => {
    if (sessionKey) {
      storage.setItem('v3_current_session', JSON.stringify({ key: sessionKey, label: sessionLabel }));
      storage.setItem('v3_current_session_key', sessionKey);
      if (sessionLabel) storage.setItem('v3_current_session_label', sessionLabel);
    } else {
      storage.removeItem('v3_current_session');
      storage.removeItem('v3_current_session_key');
      storage.removeItem('v3_current_session_label');
    }
  }, [sessionKey, sessionLabel]);

  /**
   * 拉取会话列表。可在静默模式下避免 loading。
   */
  const [sessions, setSessions] = useState<any[]>(() => {
    if (typeof window !== 'undefined') {
      const cached = storage.getItem('v3_sessions_cache');
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch {
          return [];
        }
      }
    }
    return [];
  });

  /** 显式刷新（非静默）时的按钮 loading，与首屏列表无关 */
  const [loadingSessions, setLoadingSessions] = useState(false);
  /** 是否已完成至少一次「非 append」的列表拉取（用于首屏空列表时展示加载态） */
  const [initialSessionListFetched, setInitialSessionListFetched] = useState(false);
  /** 当前加载的条数上限 */
  const [sessionLimit, setSessionLimit] = useState(V3_SESSION_LIST_PAGE_SIZE);
  /** 是否还有更多会话可供加载 */
  const [hasMoreSessions, setHasMoreSessions] = useState(true);

  const sessionsRef = useRef<any[]>(sessions);
  useEffect(() => {
    sessionsRef.current = sessions;
    // 持久化到本地，供下次开屏秒开
    if (sessions.length > 0) {
      storage.setItem('v3_sessions_cache', JSON.stringify(sessions.slice(0, V3_SESSION_LIST_PAGE_SIZE)));
    }
  }, [sessions]);

  /** 避免 fetchSessions 依赖 loadingSessions/sessionLimit 导致引用抖动，进而反复触发认证后的 bootstrap effect（重复 sessions.list） */
  const loadingSessionsRef = useRef(false);
  const sessionLimitRef = useRef(V3_SESSION_LIST_PAGE_SIZE);
  useEffect(() => {
    sessionLimitRef.current = sessionLimit;
  }, [sessionLimit]);

  const statusRef = useRef(status);
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const sendRPCRef = useRef(sendRPC);
  sendRPCRef.current = sendRPC;

  const botsModelsRef = useRef(botsModels);
  useEffect(() => {
    botsModelsRef.current = botsModels;
  }, [botsModels]);

  useEffect(() => {
    if (status !== 'authenticated') {
      setInitialSessionListFetched(false);
    }
  }, [status]);

  /**
   * 拉取会话列表。
   * @param isSilent 静默模式，不触发全局 loading 状态
   * @param isAppend 追加模式（在动态 Limit 模式下，实际是扩大 Limit 重新抓取）
   */
  const fetchSessions = useCallback(async (isSilent = false, isAppend = false) => {
    if (loadingSessionsRef.current) return;
    loadingSessionsRef.current = true;
    const showLoading = !isSilent || isAppend;
    if (showLoading) {
      setLoadingSessions(true);
    }

    // 💡 策略：由于后端 sessions.list 不支持 offset，我们通过逐渐增大 limit 来模拟分页
    const nextLimit = isAppend
      ? (sessionLimitRef.current + V3_SESSION_LIST_PAGE_SIZE)
      : isSilent
        ? Math.max(sessionLimitRef.current, V3_SESSION_LIST_PAGE_SIZE)
        : V3_SESSION_LIST_PAGE_SIZE;

    try {
      const res = await sendRPC('sessions.list', { limit: nextLimit });

      if (res.ok) {
        const list = res.payload?.items || res.payload?.sessions || (Array.isArray(res.payload) ? res.payload : []);

        // 如果返回的数量小于请求的数量，说明到底了
        if (list.length < nextLimit) {
          setHasMoreSessions(false);
        } else {
          setHasMoreSessions(true);
        }

        const patchedList = list.map((s: any) => {
          // 保护当前会话标题
          if (s.key === sessionKeyRef.current && (!s.label || s.label.trim() === '') && sessionLabelRef.current) {
            return { ...s, label: sessionLabelRef.current };
          }
          if (!s.label || s.label.trim() === '') {
            const staleSession = sessionsRef.current.find((es: any) => es.key === s.key);
            if (staleSession?.label && !isUntitledSessionLabel(staleSession.label)) {
              return { ...s, label: staleSession.label };
            }
          }
          return s;
        });

        const normalizedUsername = (usernameForSessionKey || '').trim();
        const shouldFilter = !!filterSessionListByUsername && !!normalizedUsername;
        const nextList = shouldFilter
          ? patchedList.filter((s: any) => String(s?.key || '').includes(normalizedUsername))
          : patchedList;

        setSessions(nextList);
        sessionLimitRef.current = nextLimit;
        setSessionLimit(nextLimit);

        // 默认会话逻辑（仅在首次非追加加载时执行）
        const botsArr = botsModelsRef.current?.data?.bots;
        const mainBotAllowed =
          Array.isArray(botsArr) && botsArr.length > 0 && botsArr.some((b: any) => b?.id === 'main');
        const quickChatPending =
          typeof window !== 'undefined' && !!window.sessionStorage?.getItem(V3_QUICK_CHAT_PENDING_KEY);
        if (
          !shouldFilter &&
          !isAppend &&
          !didAutoSelectMainRef.current &&
          !sessionKeyRef.current &&
          mainBotAllowed &&
          !quickChatPending
        ) {
          const main = patchedList.find((s: any) => s.key === 'agent:main:main');
          if (main?.key) {
            didAutoSelectMainRef.current = true;
            messageOpsRef.current.resetTypingState?.(main.key);
            setSessionKey(main.key);
            sendRPC('sessions.messages.subscribe', { key: main.key }).catch(() => {});
            setSessionModel(main.model || '');
            setSelectedBot('openclaw:main');
            const nextLabel = (main.label || '').trim();
            if (!isUntitledSessionLabel(nextLabel)) setSessionLabel(nextLabel);
            else setSessionLabel(null);
            messageOpsRef.current.loadSessionHistory?.(main.key);
            messageOpsRef.current.setHasNewMessages?.(false);
          }
        }
      } else {
        console.error('[Sessions] Failed to fetch sessions:', res.error);
      }
    } finally {
      if (showLoading) {
        setLoadingSessions(false);
      }
      loadingSessionsRef.current = false;
      if (!isAppend && statusRef.current === 'authenticated') {
        setInitialSessionListFetched(true);
      }
    }
  }, [sendRPC, setSessionKey, setSessionLabel, setSessionModel, setSelectedBot, messageOpsRef]);

  const fetchSessionsRef = useRef(fetchSessions);
  fetchSessionsRef.current = fetchSessions;

  /**
   * 加载下一页会话（供滚动到底部时调用）
   */
  const fetchMoreSessions = useCallback(() => {
    if (!hasMoreSessions || loadingSessionsRef.current || !initialSessionListFetched) return;
    fetchSessions(true, true);
  }, [fetchSessions, hasMoreSessions, initialSessionListFetched]);

  /**
   * 统一处理网关 event（会话维度）。
   *
   * 目前仅处理：
   * - sessions.changed：静默刷新会话列表
   */
  const handleGatewayEvent = useCallback((data: any) => {
    if (!data || data.type !== 'event') return;
    if (data.event === 'sessions.changed') {
      fetchSessions(true);
    }
  }, [fetchSessions]);

  /**
   * 切换会话：同步标题/模型/机器人，并加载历史。
   */
  const handleSelectSession = useCallback((key: string) => {
    if (key === sessionKey) return;

    const bots = botsModels?.data?.bots;
    if (Array.isArray(bots) && bots.length > 0) {
      const allowed = new Set(bots.map((b: any) => b.id));
      if (!allowed.has(botIdFromAgentSessionKey(key))) return;
    }

    messageOpsRef.current.resetTypingState?.(key);

    // 取消订阅旧会话的消息推送，订阅新会话
    if (sessionKey) {
      sendRPC('sessions.messages.unsubscribe', { key: sessionKey }).catch(() => {});
    }
    sendRPC('sessions.messages.subscribe', { key }).catch(() => {});

    setSessionKey(key);

    const s = sessions.find(x => x.key === key);
    if (s) {
      const nextLabel = (s.label || '').trim();
      if (!isUntitledSessionLabel(nextLabel)) setSessionLabel(nextLabel);
      else setSessionLabel(null);

      setSessionModel(s.model || '');

      if (key.startsWith('agent:')) {
        const parts = key.split(':');
        if (parts.length >= 2) setSelectedBot(`openclaw:${parts[1]}`);
      }
    } else {
      setSessionLabel(null);
    }

    messageOpsRef.current.loadSessionHistory?.(key);
    messageOpsRef.current.setHasNewMessages?.(false);
  }, [botsModels, messageOpsRef, sendRPC, sessionKey, sessions, setSelectedBot, setSessionKey, setSessionLabel, setSessionModel]);

  /**
   * 开始新会话：立即在网关创建空白会话并写入 sessionKey，顶部与会话列表立刻可显示；
   * 消息区保持空，首条发送时不再走 sessions.create。
   */
  const startNewSession = useCallback((agentIdOverride?: string) => {
    if (creatingNewSessionRef.current) return;

    const run = async () => {
      try {
        if (status !== 'authenticated') {
          // 未认证时不清空 sessionKey，避免「连接中」误伤当前会话；带 agentIdOverride 的快捷入口由 ChatV3 在认证后重试，不弹误导性 Toast
          if (!agentIdOverride) {
            antdMessage.warning(t('chat.gatewayConnecting'));
          }
          return;
        }
        const agentId = (agentIdOverride || (selectedBot || '').replace(/^openclaw:/, '')).trim();
        if (!agentId) {
          antdMessage.warning(t('chat.selectBot'));
          return;
        }

        creatingNewSessionRef.current = true;
        setIsCreatingNewSession(true);

        const key = buildBuddyDirectSessionKey(agentId, usernameForSessionKey);
        const res = await sendRPC('sessions.create', { agentId, key });
        if (!res.ok) {
          if (typeof window !== 'undefined') {
            window.sessionStorage.removeItem(V3_QUICK_CHAT_PENDING_KEY);
          }
          antdMessage.error(t('chat.failedToCreateSession') || `创建会话失败: ${res.error?.message || 'Unknown'}`);
          return;
        }
        if (typeof window !== 'undefined') {
          window.sessionStorage.removeItem(V3_QUICK_CHAT_PENDING_KEY);
        }
        const currentKey = (res.payload?.key as string) || key;
        const previousKey = sessionKey;

        messageOpsRef.current.resetTypingState?.('');
        if (previousKey) {
          sendRPC('sessions.messages.unsubscribe', { key: previousKey }).catch(() => {});
        }
        messageOpsRef.current.setMessages?.([]);
        setSessionLabel(null);
        messageOpsRef.current.setHasNewMessages?.(false);
        setSessionKey(currentKey);
        sendRPC('sessions.messages.subscribe', { key: currentKey }).catch(() => {});
        void sendRPC('sessions.patch', { key: currentKey, thinkingLevel, model: sessionModel }).catch(() => {});
        setSessions(prev => {
          if (prev.some((s: any) => s.key === currentKey)) return prev;
          return [{ key: currentKey, label: '' }, ...prev];
        });
        queueMicrotask(() => {
          fetchSessions(true);
        });
        antdMessage.info({ content: t('chat.newSessionReady', { defaultValue: '新会话已就绪' }), key: 'newSessionReady' });
        setTimeout(() => inputAreaRef.current?.focus(), 100);
      } finally {
        creatingNewSessionRef.current = false;
        setIsCreatingNewSession(false);
      }
    };

    void run();
  }, [
    // agentIdOverride is an argument
    fetchSessions,
    inputAreaRef,
    messageOpsRef,
    selectedBot,
    sendRPC,
    sessionKey,
    sessionModel,
    setSessionKey,
    setSessionLabel,
    setSessions,
    status,
    t,
    thinkingLevel,
    usernameForSessionKey
  ]);

  /**
   * 更新会话标题（重命名）。
   */
  const handleUpdateLabel = useCallback(async (newLabel: string) => {
    if (!sessionKey || !newLabel.trim()) return;
    if (sessionKey === 'agent:main:main') {
      antdMessage.warning(t('chat.systemSessionNoRename', { defaultValue: '系统主会话名称不可修改' }));
      return;
    }

    setIsUpdatingLabel(true);
    try {
      const res = await sendRPC('sessions.patch', { key: sessionKey, label: newLabel.trim() });
      if (res.ok) {
        antdMessage.success(t('common.success'));
        setSessionLabel(newLabel.trim());
        fetchSessions();
      }
    } finally {
      setIsUpdatingLabel(false);
    }
  }, [fetchSessions, sendRPC, sessionKey, setSessionLabel, t]);

  /**
   * 删除单个会话。
   */
  const handleDeleteSession = useCallback((_e: any, key: string) => {
    Modal.confirm({
      title: t('chat.deleteSessionConfirm'),
      content: t('chat.deleteSessionContent'),
      onOk: async () => {
        try {
          antdMessage.loading({ content: t('common.processing', { defaultValue: '正在处理...' }), key: 'deletingSession' });
          const res = await sendRPC('sessions.delete', { key });

          if (res.ok) {
            antdMessage.success({ content: t('common.success'), key: 'deletingSession' });
            sendRPC('sessions.messages.unsubscribe', { key }).catch(() => {});
            if (sessionKey === key) {
              setSessionKey(null);
              messageOpsRef.current.setMessages?.([]);
              setSessionLabel(null);
              setSessionModel('');
              messageOpsRef.current.setHasNewMessages?.(false);
            }
            fetchSessions();
          } else {
            const errMsgRaw = res.error?.message || res.error || 'Gateway Timeout or Unknown Error';
            let errMsg = typeof errMsgRaw === 'string' ? errMsgRaw : JSON.stringify(errMsgRaw);
            if (errMsg.includes('Cannot delete the main session')) {
              errMsg = t('chat.cannotDeleteMainSession');
            }
            antdMessage.error({
              content: `${t('common.error')}: ${errMsg}`,
              key: 'deletingSession',
              duration: 5
            });
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('❌ Delete Session Trap:', err);
          antdMessage.error({ content: t('common.error'), key: 'deletingSession' });
        }
      }
    });
  }, [fetchSessions, messageOpsRef, sendRPC, sessionKey, setSessionKey, setSessionLabel, setSessionModel, t]);

  /**
   * 删除一组会话（按标签分组）。
   */
  const handleDeleteGroup = useCallback((label: string, sessionKeys: string[]) => {
    if (sessionKeys.length === 0) return;
    Modal.confirm({
      title: t('chat.deleteGroupConfirm'),
      content: t('chat.deleteGroupContent', { count: sessionKeys.length, label }),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          antdMessage.loading({ content: t('chat.clearingGroup'), key: 'clearingGroup' });
          const deletableKeys = sessionKeys.filter(k => k !== 'agent:main:main');
          await Promise.all(deletableKeys.map(k => sendRPC('sessions.delete', { key: k })));
          antdMessage.success({ content: t('common.success'), key: 'clearingGroup' });

          if (sessionKey && sessionKeys.includes(sessionKey)) {
            sendRPC('sessions.messages.unsubscribe', { key: sessionKey }).catch(() => {});
            setSessionKey(null);
            messageOpsRef.current.setMessages?.([]);
            setSessionLabel(null);
            setSessionModel('');
            setThinkingLevel('medium');
            messageOpsRef.current.setHasNewMessages?.(false);
          }
          fetchSessions();
        } catch {
          antdMessage.error({ content: t('common.error'), key: 'clearingGroup' });
        }
      }
    });
  }, [fetchSessions, messageOpsRef, sendRPC, sessionKey, setSessionKey, setSessionLabel, setSessionModel, setThinkingLevel, t]);

  /**
   * 清空全部历史（删除除主会话外的所有会话）。
   */
  const handleClearAllHistory = useCallback(() => {
    if (sessions.length === 0) return;
    Modal.confirm({
      title: t('chat.clearAllHistoryConfirm'),
      content: t('chat.clearAllHistoryContent'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          antdMessage.loading({ content: t('chat.clearingAll'), key: 'clearingAll' });
          const deletableSessions = sessions.filter(s => s.key !== 'agent:main:main');
          await Promise.all(deletableSessions.map(s => sendRPC('sessions.delete', { key: s.key })));
          antdMessage.success({ content: t('chat.clearAllSuccess'), key: 'clearingAll' });

          if (sessionKeyRef.current) {
            sendRPC('sessions.messages.unsubscribe', { key: sessionKeyRef.current }).catch(() => {});
          }
          setSessionKey(null);
          messageOpsRef.current.setMessages?.([]);
          setSessionLabel(null);
          setSessions([]);
          messageOpsRef.current.setHasNewMessages?.(false);

          fetchSessions();
        } catch {
          antdMessage.error({ content: t('common.error'), key: 'clearingAll' });
        }
      }
    });
  }, [fetchSessions, messageOpsRef, sendRPC, sessions, setSessionKey, setSessionLabel, t]);

  /**
   * 切换模型（会话维度）。
   */
  const handleModelChange = useCallback(async (newModel: string) => {
    const previousModel = sessionModel;
    setSessionModel(newModel);
    if (!sessionKey) return;
    const res = await sendRPC('sessions.patch', { key: sessionKey, model: newModel || null });
    if (res.ok) {
      antdMessage.success(t('chat.modelSwitchSuccess'));
      fetchSessions();
    } else {
      setSessionModel(previousModel);
      antdMessage.error(t('chat.modelSwitchFailed', { defaultValue: `模型切换失败: ${res.error?.message || res.error || '未知错误'}` }));
    }
  }, [fetchSessions, sendRPC, sessionKey, sessionModel, setSessionModel, t]);

  /**
   * 压缩会话上下文：当对话过长导致上下文溢出时，调用 sessions.compact 来截断历史。
   */
  const handleCompactSession = useCallback(async () => {
    if (!sessionKey) return;
    const res = await sendRPC('sessions.compact', { key: sessionKey });
    if (res.ok) {
      antdMessage.success(t('chat.compactSuccess', { defaultValue: '上下文已压缩' }));
      messageOpsRef.current.loadSessionHistory?.(sessionKey);
    } else {
      const errMsg = res.error?.message || res.error || 'Unknown';
      antdMessage.error(t('chat.compactFailed', { defaultValue: `压缩失败: ${errMsg}` }));
    }
  }, [messageOpsRef, sendRPC, sessionKey, t]);

  /**
   * 切换思考等级（会话维度）。
   */
  const handleThinkingLevelChange = useCallback(async (newLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh') => {
    const previousLevel = thinkingLevel;
    setThinkingLevel(newLevel);
    if (!sessionKey) return;
    const res = await sendRPC('sessions.patch', { key: sessionKey, thinkingLevel: newLevel });
    if (res.ok) {
      antdMessage.success(t('chat.thinkingLevelUpdated', { defaultValue: '思考等级已更新' }));
    } else {
      setThinkingLevel(previousLevel);
      antdMessage.error(t('chat.thinkingLevelUpdateFailed', { defaultValue: `思考等级更新失败: ${res.error?.message || res.error || '未知错误'}` }));
    }
  }, [sendRPC, sessionKey, setThinkingLevel, t, thinkingLevel]);

  /**
   * 当连接状态为 authenticated 时，订阅会话、恢复消息流并拉取列表。
   * 仅依赖 `status`，通过 ref 读取最新的 sendRPC / fetchSessions，避免因 fetchSessions 引用变化导致重复 bootstrap（重复 sessions.list）。
   */
  useEffect(() => {
    if (status !== 'authenticated') return;

    const rpc = sendRPCRef.current;
    const currentKey = sessionKeyRef.current;

    void rpc('sessions.subscribe', {}).catch(() => {});

    if (currentKey) {
      void rpc('sessions.messages.subscribe', { key: currentKey }).catch(() => {});

      const count = messageOpsRef.current.getMessagesCount?.() ?? 0;
      if (count === 0) {
        void messageOpsRef.current.loadSessionHistory?.(currentKey);
      }
    }

    void fetchSessionsRef.current(true);
  }, [status]);

  const sessionListLoading =
    loadingSessions || (status === 'authenticated' && !initialSessionListFetched);

  return useMemo(() => {
    return {
      sessions,
      setSessions,
      loadingSessions,
      /** 首屏/静默拉取未完成或显式刷新中：侧栏列表与刷新按钮应显示加载态 */
      sessionListLoading,
      isUpdatingLabel,
      isCreatingNewSession,
      fetchSessions,
      handleGatewayEvent,
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
    };
  }, [
    fetchSessions,
    handleCompactSession,
    handleGatewayEvent,
    handleClearAllHistory,
    handleDeleteGroup,
    handleDeleteSession,
    handleModelChange,
    handleSelectSession,
    handleThinkingLevelChange,
    handleUpdateLabel,
    isCreatingNewSession,
    isUpdatingLabel,
    loadingSessions,
    sessionListLoading,
    sessions,
    startNewSession,
    fetchMoreSessions,
    hasMoreSessions,
    initialSessionListFetched,
    status
  ]);
}
