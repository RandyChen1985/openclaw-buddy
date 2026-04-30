import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { VirtuosoHandle } from 'react-virtuoso';
import { message, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import { Monitor, MessageCircle, Send, Globe, Clock, Zap, Sparkles, Settings, GitBranch } from 'lucide-react';
import 'katex/dist/katex.min.css';
import storage from '../utils/storage';

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
import { V3DebugPane } from './chatV3/V3DebugPane';
import FileExplorer from '../components/FileExplorer';
import { useV3Theme } from '../hooks/chatV3/useV3Theme';
import '../styles/ChatV3.css';

// --- Utils & Config ---
const parseSessionKey = (key: string) => {
  if (!key || !key.startsWith('agent:')) return { botId: 'main', source: 'dashboard' as const, openAIUser: undefined as string | undefined };
  const parts = key.split(':');
  const botId = parts[1] || 'main';
  const source = parts[2] || 'dashboard';

  // openai-user: agent:{botId}:openai-user:{username}-{uuid}
  let openAIUser: string | undefined;
  if ((source || '').toLowerCase() === 'openai-user') {
    const raw = (parts[3] || '').trim();
    if (raw) {
      // 约定：用户名不包含 "-"；uuid 会包含多个 "-"
      openAIUser = raw.split('-')[0] || raw;
    }
  }

  return { botId, source, openAIUser };
};

const SourceConfig: Record<string, { icon: any; color: string; labelKey: string; defaultLabel: string }> = {
  'buddy': { icon: <Sparkles size={12} />, color: '#0ea5e9', labelKey: 'chat.source.buddy', defaultLabel: 'buddy平台' },
  'main': { icon: <Settings size={12} />, color: '#475569', labelKey: 'chat.source.system', defaultLabel: '系统渠道' },
  'dashboard': { icon: <Monitor size={12} />, color: '#6366f1', labelKey: 'chat.source.dashboard', defaultLabel: '管理后台' },
  'weixin': { icon: <MessageCircle size={12} />, color: '#07c160', labelKey: 'chat.source.weixin', defaultLabel: '微信' },
  'feishu': { icon: <Send size={12} />, color: '#3370ff', labelKey: 'chat.source.feishu', defaultLabel: '飞书' },
  'telegram': { icon: <Send size={12} />, color: '#24A1DE', labelKey: 'chat.source.telegram', defaultLabel: 'Telegram' },
  'subagent': { icon: <GitBranch size={12} />, color: '#0d9488', labelKey: 'chat.source.subagent', defaultLabel: '子代理' },
  'cron': { icon: <Clock size={12} />, color: '#8b5cf6', labelKey: 'chat.source.cron', defaultLabel: '定时任务' },
  'openai-user': { icon: <Zap size={12} />, color: '#f59e0b', labelKey: 'chat.source.openaiUser', defaultLabel: 'OpenAI API' },
  'fallback': { icon: <Globe size={12} />, color: '#94a3b8', labelKey: 'chat.source.fallback', defaultLabel: '其他渠道' }
};

interface ChatV3Props {
  botsModels: any;
  loadingBots: boolean;
  onRefreshBots: () => void;
  isMobile?: boolean;
}


// --- Utils ---

const ChatV3: React.FC<ChatV3Props> = ({ botsModels, loadingBots, isMobile }) => {

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
  const [showThinking, setShowThinking] = useState<boolean>(() => storage.getItem('v3_show_thinking') !== 'false');
  const showThinkingRef = useRef(showThinking);
  showThinkingRef.current = showThinking;

  // Debug Logs
  const [showDebug, setShowDebug] = useState(() => storage.getItem('v3_show_debug') === 'true');
  const [wsLogs, setWsLogs] = useState<any[]>([]);

  const handleAddLog = useCallback((log: any) => {
    // 💡 只有开启调试模式且非心跳包时才记录，防止内存溢出与性能损耗
    if (!storage.getItem('v3_show_debug')) return;
    if (log.data?.event === 'health') return; 
    setWsLogs(prev => [...prev.slice(-99), log]);
  }, []);

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  const inputAreaRef = useRef<InputAreaHandle>(null);

  // Hook usage
  const handleSetSelectedBot = React.useCallback((bot: string) => setSelectedBot(bot), []);

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
    selectedBot,
    setSelectedBot: handleSetSelectedBot,
    botsModels,
    t,
    inputAreaRef,
    virtuosoRef,
    scrollRef,
    showThinkingRef,
    onLog: handleAddLog
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [explorerPath, setExplorerPath] = useState('');
  const [explorerTitle, setExplorerTitle] = useState('');
  const [pendingSaveContent, setPendingSaveContent] = useState<string | undefined>(undefined);

  const handleSendToChat = useCallback((content: string, fileName: string, fileInfo?: any) => {
    if (inputAreaRef.current) {
      if (fileInfo) {
        inputAreaRef.current.addFiles([fileInfo]);
        inputAreaRef.current.setValue((prev: string) => {
          const current = prev.trim();
          return current ? current : t('chat.defaultAnalyzePrompt', { defaultValue: '请帮我分析这个文件' });
        });
        message.success(t('chat.contentAttached', { defaultValue: '文件已附加到输入框' }));
      } else {
        if (!content) return;
        const wrapped = `File: ${fileName}\n---\n${content}\n`;
        inputAreaRef.current.setValue((prev: string) => {
          const current = prev.trim();
          return current ? `${current}\n\n${wrapped}` : wrapped;
        });
        message.success(t('chat.contentAttached', { defaultValue: '文件内容已附加到输入框' }));
      }
    }
  }, [t]);

  useEffect(() => {
    if (botsModels?.data?.bots?.length > 0) {
      const quickChatBot = window.sessionStorage.getItem('v3_quick_chat_bot');
      if (quickChatBot) {
        window.sessionStorage.removeItem('v3_quick_chat_bot');
        const botId = quickChatBot.replace('openclaw:', '');
        setSelectedBot(quickChatBot);
        startNewSession(botId);
      } else if (!selectedBot && !sessionKey) {
        const firstBot = botsModels.data.bots[0];
        setSelectedBot(`openclaw:${firstBot.id}`);
      }
    }
  }, [botsModels, selectedBot, sessionKey, startNewSession]);

  // 首次进入/刷新：若已恢复 sessionKey，则强制将 bot 下拉与会话 key 对齐，避免“默认选中第一个 bot”造成错配
  useEffect(() => {
    if (!sessionKey) return;
    const { botId } = parseSessionKey(sessionKey);
    const desired = `openclaw:${botId}`;
    if (desired && desired !== selectedBot) {
      setSelectedBot(desired);
    }
  }, [sessionKey, selectedBot]);

  const copyToClipboard = (text: string) => {
    if (!text) return;
    
    // 优先尝试现代 Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        message.success(t('chat.copySuccess'));
      }).catch(err => {
        console.warn('Modern Clipboard API failed, trying fallback:', err);
        fallbackCopyTextToClipboard(text);
      });
    } else {
      // API 不可用（如非安全上下文）时使用后备方案
      fallbackCopyTextToClipboard(text);
    }
  };

  const fallbackCopyTextToClipboard = (text: string) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      
      // 确保元素在视口外且不可见
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      
      textArea.focus();
      textArea.select();

      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);

      if (successful) {
        message.success(t('chat.copySuccess'));
      } else {
        throw new Error('execCommand copy returned false');
      }
    } catch (err) {
      console.error('Fallback copy failed:', err);
      message.error(t('chat.copyFailed', { defaultValue: '复制失败，请手动复制' }));
    }
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
      if (isMod && e.key === 'f') {
        e.preventDefault();
        setIsFullscreen(prev => !prev);
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

  const currentSessionBotId = React.useMemo(() => {
    if (!sessionKey) return null;
    return parseSessionKey(sessionKey).botId;
  }, [sessionKey]);

  const handleOpenWorkspace = useCallback(() => {
    if (!sessionKey) return;
    const { botId } = parseSessionKey(sessionKey);
    const bot = botsModels?.data?.bots?.find((b: any) => b.id === botId);
    if (bot?.workspace) {
      setExplorerPath(bot.workspace);
      setExplorerTitle(`${bot.name || bot.id} ${t('bots.workspace', { defaultValue: '工作区' })}`);
      setExplorerOpen(true);
    }
  }, [sessionKey, botsModels, t]);

  const handleSaveToWorkspace = useCallback((content: string) => {
    setPendingSaveContent(content);
    handleOpenWorkspace();
    message.info(t('chat.chooseFolderToSave', { defaultValue: '已进入保存模式，请在文件浏览器中选择目标文件夹并右键保存' }));
  }, [handleOpenWorkspace, t]);

  const handleRequestNewSessionWithBot = React.useCallback((botValue: string) => {
    const nextBot = (botValue || '').trim();
    if (!nextBot) return;

    // 没有会话时允许直接切换 bot（用于首次进入/准备阶段）
    if (!sessionKey) {
      setSelectedBot(nextBot);
      return;
    }

    if (status !== 'authenticated') {
      message.warning(t('chat.v3Connecting'));
      return;
    }
    if (isTyping) {
      message.info(t('chat.refreshWaitReply', { defaultValue: '请等待当前回复结束后再切换' }));
      return;
    }
    if (isCreatingNewSession) return;

    const agentId = nextBot.replace(/^openclaw:/, '').trim();
    const bot = botsModels?.data?.bots?.find((b: any) => b.id === agentId);
    const botName = bot?.name || agentId;

    Modal.confirm({
      title: t('chat.confirmCreateNewSessionTitle', { defaultValue: '确认创建新会话？' }),
      content: t('chat.confirmCreateNewSessionContent', {
        defaultValue: `将以「${botName}」创建一个新的会话。当前会话不会被覆盖。`,
        botName
      }),
      okText: t('common.confirm', { defaultValue: '确定' }),
      cancelText: t('common.cancel', { defaultValue: '取消' }),
      onOk: async () => {
        // 先更新下拉选择的显示，再创建新会话
        setSelectedBot(nextBot);
        startNewSession(agentId);
      }
    });
  }, [botsModels, isCreatingNewSession, isTyping, sessionKey, startNewSession, status, t]);

  return (
    <>
      <div
        className={`chat-v3-root ${isFullscreen ? 'chat-v3-root-fullscreen' : ''}`}
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
              botsModels={botsModels}
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
          showDebug={showDebug}
          setShowDebug={(val) => {
            setShowDebug(val);
            storage.setItem('v3_show_debug', val ? 'true' : 'false');
            if (!val) setWsLogs([]); // 关闭时自动清屏
          }}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
          onOpenWorkspace={handleOpenWorkspace}
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
          onSaveToWorkspace={handleSaveToWorkspace}
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
              onRequestNewSessionWithBot={handleRequestNewSessionWithBot}
              currentSessionBotId={currentSessionBotId}
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
        {showDebug && !isMobile && (
          <V3DebugPane 
            t={t} 
            logs={wsLogs} 
            onClear={() => setWsLogs([])} 
            onClose={() => {
              setShowDebug(false);
              storage.setItem('v3_show_debug', 'false');
              setWsLogs([]);
            }} 
          />
        )}
        <ChatV3Auth 
          status={status} 
          isMobile={!!isMobile} 
          onConnect={connect} 
          t={t} 
        />
      </div>

      <FileExplorer
        open={explorerOpen}
        onClose={() => setExplorerOpen(false)}
        rootPath={explorerPath}
        title={explorerTitle}
        t={t}
        isMobile={!!isMobile}
        onSendToChat={handleSendToChat}
        pendingSaveContent={pendingSaveContent}
        onClearPendingSave={() => setPendingSaveContent(undefined)}
      />
    </>
  );
};

export default ChatV3;
