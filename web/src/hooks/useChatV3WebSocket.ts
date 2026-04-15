import { useState, useEffect, useRef } from 'react';
// antd message 已下沉到子模块（sessions/messages/summarize）内部处理
import * as nacl from 'tweetnacl';
import storage from '../utils/storage';
import { useV3GatewayConnection } from './chatV3/useV3GatewayConnection';
import { useV3Messages } from './chatV3/useV3Messages';
import { useV3AutoSummarize } from './chatV3/useV3AutoSummarize';
import { useV3Sessions } from './chatV3/useV3Sessions';

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
  const [sessionKey, setSessionKey] = useState<string | null>(() => storage.getItem('v3_current_session_key'));
  const [sessionLabel, setSessionLabel] = useState<string | null>(() => storage.getItem('v3_current_session_label'));
  const [sessionModel, setSessionModel] = useState<string>('');

  const [thinkingLevel, setThinkingLevel] = useState<'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'>('medium');
  const [messages, setMessages] = useState<Message[]>([]);

  // --- Refs ---
  const sessionKeyRef = useRef<string | null>(null);
  useEffect(() => { sessionKeyRef.current = sessionKey; }, [sessionKey]);
  const autoSummarizeRef = useRef<any>(null);
  
  const sessionLabelRef = useRef<string | null>(null);
  useEffect(() => { sessionLabelRef.current = sessionLabel; }, [sessionLabel]);

  const showScrollBtnRef = useRef(false);

  // 消息层 API 引用（用于在网关事件路由中调用，避免 TDZ）
  const messagesApiRef = useRef<null | { handleChatDelta: (payload: any) => void }>(null);
  const sessionMessageOpsRef = useRef<{
    setMessages?: (updater: ((prev: Message[]) => Message[]) | Message[]) => void;
    loadSessionHistory?: (key: string) => Promise<void> | void;
    setHasNewMessages?: (val: boolean) => void;
  }>({});

  /**
   * 网关事件处理函数引用（通过 ref 注入），用于避免“连接层在上游，而业务处理函数在下游”造成的 TDZ 问题。
   */
  const gatewayEventHandlerRef = useRef<((data: any) => void) | null>(null);

  const {
    status,
    connect,
    sendRPC,
    lastHealth,
    latencyHistory,
    pulse
  } = useV3GatewayConnection({
    keyPair,
    deviceId,
    handlers: {
      onEvent: (data) => gatewayEventHandlerRef.current?.(data)
    }
  });

  const {
    sessions,
    setSessions,
    loadingSessions,
    isUpdatingLabel,
    fetchSessions,
    handleSelectSession,
    startNewSession,
    handleUpdateLabel,
    handleDeleteSession,
    handleDeleteGroup,
    handleClearAllHistory,
    handleModelChange,
    handleThinkingLevelChange
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
    handleChatDelta,
    loadSessionHistory,
    handleSend,
    handleStopGeneration,
    handleRegenerate,
    handleSaveEdit
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
    showScrollBtnRef
  });

  useEffect(() => {
    sessionMessageOpsRef.current = {
      setMessages: setV3Messages,
      loadSessionHistory,
      setHasNewMessages
    };
  }, [loadSessionHistory, setHasNewMessages, setV3Messages]);

  // 与网关事件路由兼容：将 chat delta 处理函数注入 ref
  useEffect(() => {
    messagesApiRef.current = { handleChatDelta };
  }, [handleChatDelta]);

  // 保持对外 messages/setMessages API 不变：对外仍以 messages 作为单一来源
  useEffect(() => {
    setMessages(v3Messages);
  }, [v3Messages]);

  // 消息/流式/历史加载等逻辑已迁移到 useV3Messages

  /**
   * 注入网关事件路由：将连接层 event 分发到 chat/sessions/approval 等业务处理。
   */
  useEffect(() => {
    gatewayEventHandlerRef.current = (data: any) => {
      if (!data || data.type !== 'event') return;
      if (['tick', 'presence'].includes(data.event)) return;
      if (data.event === 'chat') messagesApiRef.current?.handleChatDelta(data.payload);
      else if (data.event === 'sessions.changed') fetchSessions(true);
      else if (data.event === 'exec.approval.requested') {
        const { id, request } = data.payload;
        const slug = id.substring(0, 8);
        const command = request.command;
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
        // typing/stall 等状态由消息层统一维护，这里不额外干预
      } else if (data.event === 'agent') {
        const { stream, data: agentData } = data.payload;
        if (stream === 'item' && agentData.status === 'blocked') {
          // typing/stall 等状态由消息层统一维护，这里不额外干预
        }
      }
    };
    return () => {
      gatewayEventHandlerRef.current = null;
    };
  }, [fetchSessions, t]);

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
    startNewSession,
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
