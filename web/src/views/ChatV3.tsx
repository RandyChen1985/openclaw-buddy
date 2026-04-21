import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import { message } from 'antd';
import { useTranslation } from 'react-i18next';
import { Monitor, MessageCircle, Send, Globe, Clock, Zap, Sparkles, Settings } from 'lucide-react';
import 'katex/dist/katex.min.css';
import * as nacl from 'tweetnacl';
import { sha256 } from 'js-sha256';
import storage from '../utils/storage';
import GatewayOfflineMask from '../components/GatewayOfflineMask';
import V3SessionList from '../components/Chat/V3SessionList';
import type { InputAreaHandle } from '../components/Chat/V3InputArea';
import ChatV3Auth from '../components/Chat/ChatV3Auth';
import ChatV3EmptyState from '../components/Chat/ChatV3EmptyState';
import { useChatV3WebSocket } from '../hooks/useChatV3WebSocket';
import { V3QuickCommands } from './chatV3/V3QuickCommands';
import { V3ChatHeader } from './chatV3/V3ChatHeader';
import { V3FloatingButtons } from './chatV3/V3FloatingButtons';
import { V3MessagePane } from './chatV3/V3MessagePane';
import { V3ComposerBar } from './chatV3/V3ComposerBar';
import { useV3Theme } from '../hooks/chatV3/useV3Theme';
import '../styles/ChatV3.css';

// --- Utils & Config ---
const parseSessionKey = (key: string) => {
  if (!key || !key.startsWith('agent:')) return { botId: 'main', source: 'dashboard' };
  const parts = key.split(':');
  return {
    botId: parts[1] || 'main',
    source: parts[2] || 'dashboard'
  };
};

const SourceConfig: Record<string, { icon: any; color: string; labelKey: string; defaultLabel: string }> = {
  'buddy': { icon: <Sparkles size={12} />, color: '#0ea5e9', labelKey: 'chat.source.buddy', defaultLabel: 'buddy平台' },
  'main': { icon: <Settings size={12} />, color: '#475569', labelKey: 'chat.source.system', defaultLabel: '系统渠道' },
  'dashboard': { icon: <Monitor size={12} />, color: '#6366f1', labelKey: 'chat.source.dashboard', defaultLabel: '管理后台' },
  'weixin': { icon: <MessageCircle size={12} />, color: '#07c160', labelKey: 'chat.source.weixin', defaultLabel: '微信' },
  'feishu': { icon: <Send size={12} />, color: '#3370ff', labelKey: 'chat.source.feishu', defaultLabel: '飞书' },
  'telegram': { icon: <Send size={12} />, color: '#24A1DE', labelKey: 'chat.source.telegram', defaultLabel: 'Telegram' },
  'cron': { icon: <Clock size={12} />, color: '#8b5cf6', labelKey: 'chat.source.cron', defaultLabel: '定时任务' },
  'openai-user': { icon: <Zap size={12} />, color: '#f59e0b', labelKey: 'chat.source.openaiUser', defaultLabel: 'OpenAI API' },
  'fallback': { icon: <Globe size={12} />, color: '#94a3b8', labelKey: 'chat.source.fallback', defaultLabel: '其他渠道' }
};

// --- Types ---
interface ChatV3Props {
  botsModels: any;
  loadingBots: boolean;
  onRefreshBots: () => void;
  isMobile?: boolean;
  isRunning?: boolean;
  onNavigateToDashboard?: () => void;
}

// --- Utils ---
const hexToUint8Array = (hex: string): Uint8Array => {
  const matched = hex.match(/.{1,2}/g);
  return new Uint8Array(matched ? matched.map(byte => parseInt(byte, 16)) : []);
};

const ChatV3: React.FC<ChatV3Props> = ({ botsModels, loadingBots, isMobile, isRunning, onNavigateToDashboard }) => {
  const { t } = useTranslation();
  const v3Theme = useV3Theme();

  /**
   * 获取会话来源（渠道）的 icon/color/label。
   *
   * 说明：label 走 i18n，避免顶部 `SourceConfig` 出现硬编码文案。
   */
  const getSourceMeta = useCallback((source: string) => {
    const s = source?.toLowerCase();
    const cfg =
      s && SourceConfig[s]
        ? SourceConfig[s]
        : s === 'api'
          ? SourceConfig['openai-user']
          : s === 'openclaw-weixin'
            ? SourceConfig['weixin']
            : SourceConfig['fallback'];
    return {
      icon: cfg.icon,
      color: cfg.color,
      label: t(cfg.labelKey, { defaultValue: cfg.defaultLabel })
    };
  }, [t]);
  
  // Local UI States
  const [selectedBot, setSelectedBot] = useState<string>('');
  const [keyPair, setKeyPair] = useState<nacl.BoxKeyPair | null>(null);
  const [deviceId, setDeviceId] = useState<string>('');
  const [showThinking, setShowThinking] = useState<boolean>(() => storage.getItem('v3_show_thinking') === 'true');
  const showThinkingRef = useRef(showThinking);
  showThinkingRef.current = showThinking;

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const inputAreaRef = useRef<InputAreaHandle>(null);

  // Hook usage
  const {
    messages, setMessages,
    status,
    sessionKey,
    sessionLabel,
    sessionModel,
    thinkingLevel,
    sessions,
    loadingSessions,
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
    handleUpdateLabel,
    handleAutoSummarize,
    handleModelChange,
    handleThinkingLevelChange,
    sendRPC,
    connect,
    showScrollBtnRef
  } = useChatV3WebSocket({
    keyPair,
    deviceId,
    selectedBot,
    setSelectedBot: (bot: string) => setSelectedBot(bot),
    botsModels,
    t,
    inputAreaRef,
    virtuosoRef,
    scrollRef,
    showThinkingRef
  });

  // Local UI States
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [editingLabelText, setEditingLabelText] = useState('');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showScrollTopBtn, setShowScrollTopBtn] = useState(false);
  const [showSider, setShowSider] = useState(!isMobile);
  const [quotedMsg, setQuotedMsg] = useState<string | null>(null);
  const [editingMsgIndex, setEditingMsgIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [sessionSearch, setSessionSearch] = useState('');


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
      let hashArray: number[];
      if (typeof crypto !== 'undefined' && crypto.subtle) {
        const hashBuffer = await crypto.subtle.digest('SHA-256', kp.publicKey.buffer as ArrayBuffer);
        hashArray = Array.from(new Uint8Array(hashBuffer));
      } else {
        hashArray = Array.from(hexToUint8Array(sha256(kp.publicKey)));
      }
      setDeviceId(hashArray.map(b => b.toString(16).padStart(2, '0')).join(''));
    };
    initKeys();
  }, []);

  useEffect(() => {
    if (!selectedBot && botsModels?.data?.bots?.length > 0) {
      const firstBot = botsModels.data.bots[0];
      setSelectedBot(`openclaw:${firstBot.id}`);
    }
  }, [botsModels, selectedBot]);

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
      .then(() => { message.success(t('chat.copySuccess')); })
      .catch(() => { message.error(t('chat.copyFailed', { defaultValue: '复制失败，请手动复制' })); });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (e.key === 'Escape') {
        if (editingMsgIndex !== null) { setEditingMsgIndex(null); return; }
        if (quotedMsg) { setQuotedMsg(null); return; }
      }
      if (isMod && e.key === 'k') {
        e.preventDefault();
        startNewSession();
        return;
      }
      if (isMod && e.key === '\\') {
        e.preventDefault();
        setShowSider(prev => !prev);
        return;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [editingMsgIndex, quotedMsg, startNewSession]);

  const handleWrappedSend = React.useCallback((text: string, files?: any[]) => {
    let finalContent = text;
    if (quotedMsg) {
      const quotedStr = quotedMsg.split('\n').map(line => `> ${line}`).join('\n');
      finalContent = `${quotedStr}\n\n${text}`;
      setQuotedMsg(null);
    }
    handleSend(finalContent, files);
  }, [handleSend, quotedMsg]);

  const handleSendReasoningCommand = useCallback(
    (text: string) => {
      if (status !== 'authenticated') {
        message.warning(t('chat.v3Connecting'));
        return;
      }
      if (isTyping) {
        message.info(t('chat.reasoningWaitReply', { defaultValue: '请等待当前回复结束后再切换思考模式' }));
        return;
      }
      if (isCreatingNewSession) return;
      void handleSend(text);
    },
    [status, isTyping, isCreatingNewSession, handleSend, t]
  );

  return (
    <>
      {!isRunning && <GatewayOfflineMask onNavigateToDashboard={onNavigateToDashboard} />}
      <div
        className="chat-v3-root"
        data-v3-theme={v3Theme.rootAttrs['data-v3-theme']}
        style={{
          ...(v3Theme.rootAttrs.styleVars || {}),
          flex: 1,
          display: 'flex',
          background: '#f8fafc',
          overflowX: 'hidden',
          height: '100%',
          position: 'relative',
          width: '100%'
        } as any}
      >
        
        <div style={{ position: 'absolute', width: '100%', height: '100%', overflow: 'hidden', zIndex: 0, pointerEvents: 'none' }}>
          <div className="v3-blob" style={{ background: '#6366f1', top: '-10%', left: '-10%', animationDelay: '0s' }} />
          <div className="v3-blob" style={{ background: '#ec4899', bottom: '10%', right: '-5%', animationDelay: '-5s', width: 600, height: 600 }} />
          <div className="v3-blob" style={{ background: '#3b82f6', top: '40%', left: '30%', animationDelay: '-10s', opacity: 0.08 }} />
        </div>

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
            boxShadow: isMobile ? '4px 0 20px rgba(0,0,0,0.15)' : 'none',
            flexShrink: 0
          }}>
            <V3SessionList
              sessions={sessions}
              sessionKey={sessionKey}
              typingSessionKeys={typingSessionKeys}
              loadingSessions={loadingSessions}
              sessionSearch={sessionSearch}
              setSessionSearch={setSessionSearch}
              onSelectSession={handleSelectSession}
              onNewSession={startNewSession}
              newSessionBusy={isCreatingNewSession}
              onDeleteSession={handleDeleteSession}
              onDeleteGroup={handleDeleteGroup}
              onClearAll={handleClearAllHistory}
              fetchSessions={fetchSessions}
              isMobile={!!isMobile}
              setShowSider={setShowSider}
              copyToClipboard={copyToClipboard}
              t={t}
            />
          </div>
        </>
      )}

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', background: '#fafafa', position: 'relative', width: '100%', minWidth: 0, overflow: 'hidden' }}>
        
        {/* 💡 注入局部样式强制锁死浮动按钮在各种状态下的颜色 */}
        <style>{`
          .v3-floating-btn-active {
            background: #2563eb !important;
            color: #ffffff !important;
            border: none !important;
          }
          .v3-floating-btn-active:hover {
            background: #1d4ed8 !important;
            color: #ffffff !important;
            opacity: 1 !important;
          }
          .v3-floating-btn-active .anticon, 
          .v3-floating-btn-active .lucide {
            color: #ffffff !important;
          }
        `}</style>

        <V3ChatHeader
          t={t}
          isMobile={!!isMobile}
          showSider={showSider}
          onToggleSider={() => setShowSider(!showSider)}
          status={status}
          lastHealth={lastHealth}
          latencyHistory={latencyHistory}
          pulse={pulse}
          onReconnect={connect}
          sessionKey={sessionKey}
          sessionLabel={sessionLabel}
          isSummarizing={isSummarizing}
          isUpdatingLabel={isUpdatingLabel}
          onAutoSummarize={async () => {
            // 手动触发应当“点击即有反馈”。当本地消息为空时，尝试先拉取历史再生成标题。
            if (!sessionKey) return;
            if (messages.length > 0) {
              await handleAutoSummarize(messages, false, undefined, true);
              return;
            }

            try {
              const hRes = await sendRPC('chat.history', { sessionKey, limit: 10 });
              if (!hRes.ok) {
                message.warning(t('chat.noMessagesForTitle', { defaultValue: '暂无可用于生成标题的消息' }));
                return;
              }
              const raw = hRes.payload?.messages || hRes.payload?.items || [];
              if (!Array.isArray(raw) || raw.length === 0) {
                message.warning(t('chat.noMessagesForTitle', { defaultValue: '暂无可用于生成标题的消息' }));
                return;
              }
              const msgs = raw.map((m: any) => ({
                id: m.id || `hist-${sessionKey}-${Math.random().toString(36).slice(2)}`,
                role: (m.role === 'toolResult' ? 'assistant' : m.role) as any,
                content: (typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')).toString(),
                timestamp: ''
              })).filter((m: any) => (m.content || '').trim().length > 0);
              await handleAutoSummarize(msgs, false, sessionKey, true);
            } catch {
              message.error(t('common.error', { defaultValue: '错误' }));
            }
          }}
          onUpdateLabel={handleUpdateLabel}
          onCopy={copyToClipboard}
          isEditingLabel={isEditingLabel}
          editingLabelText={editingLabelText}
          setEditingLabelText={setEditingLabelText}
          setIsEditingLabel={setIsEditingLabel}
          showThinking={showThinking}
          setShowThinking={(val) => {
            setShowThinking(val);
            storage.setItem('v3_show_thinking', val ? 'true' : 'false');
          }}
          thinkingLevel={thinkingLevel}
          onThinkingLevelChange={handleThinkingLevelChange}
          onSendReasoningCommand={handleSendReasoningCommand}
          parseSessionKey={parseSessionKey}
          getSourceMeta={getSourceMeta}
          botsModels={botsModels}
          v3Theme={v3Theme}
        />
  
        <V3MessagePane
          t={t}
          isMobile={!!isMobile}
          messages={messages}
          isTyping={isTyping}
          showThinking={showThinking}
          isStalled={isStalled}
          isLoadingHistory={isLoadingHistory}
          tpsData={tpsData}
          selectedBot={selectedBot}
          scrollRef={scrollRef}
          virtuosoRef={virtuosoRef}
          inputAreaRef={inputAreaRef}
          emptyState={<ChatV3EmptyState isMobile={!!isMobile} t={t} />}
          scrollState={{
            showScrollBtnRef,
            setShowScrollBtn,
            showScrollTopBtn,
            setShowScrollTopBtn,
            setHasNewMessages
          }}
          editingMsgIndex={editingMsgIndex}
          editContent={editContent}
          setEditContent={setEditContent}
          onEdit={(idx, content) => {
            setEditingMsgIndex(idx);
            setEditContent(content);
          }}
          onSaveEdit={() => {
            if (editingMsgIndex === null) return;
            handleSaveEdit(editingMsgIndex, editContent);
            setEditingMsgIndex(null);
          }}
          onCancelEdit={() => setEditingMsgIndex(null)}
          onDelete={(idx) => setMessages((prev: any) => {
            const target = prev[idx];
            if (!target) return prev;
            // 主气泡被删除时，同步清理同 runId 的思考信息附录气泡（_uiMetaOnly），避免孤儿
            const runId = target.runId;
            const isMainDeletion = !target._uiMetaOnly && !!runId;
            return prev.filter((m: any, i: number) => {
              if (i === idx) return false;
              if (isMainDeletion && m._uiMetaOnly && m.runId === runId) return false;
              return true;
            });
          })}
          onQuote={setQuotedMsg}
          onSend={handleWrappedSend}
          onRegenerate={handleRegenerate}
          copyToClipboard={copyToClipboard}
        />

        <V3FloatingButtons
          t={t}
          isMobile={!!isMobile}
          showScrollTopBtn={showScrollTopBtn}
          showScrollBottomBtn={showScrollBtn}
          hasNewMessages={hasNewMessages}
          onScrollTop={() => {
            virtuosoRef.current?.scrollToIndex({ index: 0, behavior: 'smooth', align: 'start' });
            setShowScrollTopBtn(false);
          }}
          onScrollBottom={() => {
            virtuosoRef.current?.scrollToIndex({ index: messages.length - 1, behavior: 'smooth', align: 'end' });
            setHasNewMessages(false);
            setShowScrollBtn(false);
          }}
        />

        <div style={{ padding: isMobile ? '8px 12px' : '0 24px 20px', background: '#fafafa', borderTop: '1px solid #f1f5f9', width: '100%', boxSizing: 'border-box' }}>

           <V3QuickCommands
             t={t}
             status={status}
             onSend={handleWrappedSend}
             isMobile={!!isMobile}
             sendBlocked={isCreatingNewSession}
           />

            <V3ComposerBar
              t={t}
              isMobile={!!isMobile}
              status={status}
              isTyping={isTyping}
              sessionComposeBlocked={isCreatingNewSession}
              sessionKey={sessionKey}
              isLoadingHistory={isLoadingHistory}
              onRefreshSession={() => {
                if (!sessionKey) return;
                void loadSessionHistory(sessionKey);
              }}
              loadingBots={loadingBots}
              selectedBot={selectedBot}
              setSelectedBot={setSelectedBot}
              botsModels={botsModels}
              sessionModel={sessionModel}
              onSessionModelChange={handleModelChange}
              inputAreaRef={inputAreaRef}
              quotedMsg={quotedMsg}
              onClearQuote={() => setQuotedMsg(null)}
              onSend={handleWrappedSend}
              onStop={handleStopGeneration}
            />

          </div>
        </div>
        <ChatV3Auth 
          status={status} 
          isMobile={!!isMobile} 
          onConnect={connect} 
          t={t} 
        />
      </div>

    </>
  );
};

export default ChatV3;
