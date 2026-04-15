import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message as antdMessage, Modal } from 'antd';
import storage from '../../utils/storage';
import type { Message } from '../useChatV3WebSocket';

export interface UseV3SessionsParams {
  t: any;
  sendRPC: (method: string, params: any) => Promise<any>;
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';

  sessionKey: string | null;
  setSessionKey: (key: string | null) => void;
  sessionLabel: string | null;
  setSessionLabel: (label: string | null) => void;
  setSessionModel: (model: string) => void;
  setThinkingLevel: (level: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh') => void;

  setSelectedBot: (bot: string) => void;

  /**
   * 消息层操作集合（通过 ref 注入），用于解耦会话层与消息层的互相依赖。
   */
  messageOpsRef: React.MutableRefObject<{
    setMessages?: (updater: ((prev: Message[]) => Message[]) | Message[]) => void;
    loadSessionHistory?: (key: string) => Promise<void> | void;
    setHasNewMessages?: (val: boolean) => void;
    getMessagesCount?: () => number;
  }>;
  inputAreaRef: React.RefObject<any>;
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
  sessionKey,
  setSessionKey,
  sessionLabel,
  setSessionLabel,
  setSessionModel,
  setThinkingLevel,
  setSelectedBot,
  messageOpsRef,
  inputAreaRef
}: UseV3SessionsParams) {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [isUpdatingLabel, setIsUpdatingLabel] = useState(false);

  const sessionKeyRef = useRef<string | null>(null);
  useEffect(() => { sessionKeyRef.current = sessionKey; }, [sessionKey]);
  const sessionLabelRef = useRef<string | null>(null);
  useEffect(() => { sessionLabelRef.current = sessionLabel; }, [sessionLabel]);

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
  const fetchSessions = useCallback(async (isSilent = false) => {
    if (!isSilent) setLoadingSessions(true);

    const [res] = await Promise.all([
      sendRPC('sessions.list', { limit: 50 }),
      isSilent ? Promise.resolve() : new Promise(resolve => setTimeout(resolve, 800))
    ]);

    if (res.ok) {
      const list = res.payload?.items || res.payload?.sessions || (Array.isArray(res.payload) ? res.payload : []);
      const patchedList = list.map((s: any) => {
        if (s.key === sessionKeyRef.current && (!s.label || s.label.trim() === '') && sessionLabelRef.current) {
          return { ...s, label: sessionLabelRef.current };
        }
        return s;
      });
      setSessions(patchedList);
    }

    if (!isSilent) setLoadingSessions(false);
  }, [sendRPC]);

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
    setSessionKey(key);

    const s = sessions.find(x => x.key === key);
    if (s) {
      const nextLabel = (s.label || '').trim();
      if (nextLabel && nextLabel !== '未命名会话' && nextLabel !== 'New Session') setSessionLabel(nextLabel);
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
  }, [messageOpsRef, sessionKey, sessions, setSelectedBot, setSessionKey, setSessionLabel, setSessionModel]);

  /**
   * 开始新会话：清空当前会话状态并提示用户。
   */
  const startNewSession = useCallback(() => {
    setSessionKey(null);
    messageOpsRef.current.setMessages?.([]);
    setSessionLabel(null);
    messageOpsRef.current.setHasNewMessages?.(false);

    antdMessage.info({ content: t('chat.newSessionReady', { defaultValue: '新会话已就绪' }), key: 'newSessionReady' });
    setTimeout(() => inputAreaRef.current?.focus(), 100);
  }, [inputAreaRef, messageOpsRef, setSessionKey, setSessionLabel, t]);

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
    setSessionModel(newModel);
    if (!sessionKey) return;
    const res = await sendRPC('sessions.patch', { key: sessionKey, model: newModel || null });
    if (res.ok) {
      antdMessage.success(t('chat.modelSwitchSuccess'));
      fetchSessions();
    }
  }, [fetchSessions, sendRPC, sessionKey, setSessionModel, t]);

  /**
   * 切换思考等级（会话维度）。
   */
  const handleThinkingLevelChange = useCallback(async (newLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh') => {
    setThinkingLevel(newLevel);
    if (!sessionKey) return;
    const res = await sendRPC('sessions.patch', { key: sessionKey, thinkingLevel: newLevel });
    if (res.ok) {
      antdMessage.success(t('chat.thinkingLevelUpdated', { defaultValue: '思考等级已更新' }));
    }
  }, [sendRPC, sessionKey, setThinkingLevel, t]);

  /**
   * 当连接状态为 authenticated 且有 sessionKey 时，确保会话列表和历史被加载（对齐旧行为）。
   */
  useEffect(() => {
    if (status !== 'authenticated') return;
    // 首次进入 authenticated 时拉一下列表
    fetchSessions(true);
    if (sessionKeyRef.current) {
      // 保持旧逻辑：只有当消息为空时才加载历史（避免“撤自/清屏”）
      const count = messageOpsRef.current.getMessagesCount?.() ?? 0;
      if (count === 0) {
        messageOpsRef.current.loadSessionHistory?.(sessionKeyRef.current);
      }
    }
  }, [fetchSessions, messageOpsRef, status]);

  return useMemo(() => {
    return {
      sessions,
      setSessions,
      loadingSessions,
      isUpdatingLabel,
      fetchSessions,
      handleGatewayEvent,
      handleSelectSession,
      startNewSession,
      handleUpdateLabel,
      handleDeleteSession,
      handleDeleteGroup,
      handleClearAllHistory,
      handleModelChange,
      handleThinkingLevelChange
    };
  }, [
    fetchSessions,
    handleGatewayEvent,
    handleClearAllHistory,
    handleDeleteGroup,
    handleDeleteSession,
    handleModelChange,
    handleSelectSession,
    handleThinkingLevelChange,
    handleUpdateLabel,
    isUpdatingLabel,
    loadingSessions,
    sessions,
    startNewSession
  ]);
}

