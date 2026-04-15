import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import type { VirtuosoHandle } from 'react-virtuoso';
import { Select, Input, Button, Spin, message, Badge, Modal, Form, Tooltip, Drawer, Switch, Tabs } from 'antd';
import { useTranslation } from 'react-i18next';
import { Bot, RefreshCw, Cpu, Plus, Trash2, LayoutPanelLeft, Settings, ChevronUp, ChevronDown, Sparkles, Save, X, Zap, Quote, Wand2, PenLine, Eye, Activity, Monitor, MessageCircle, Send, Globe, Shield, Clock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import * as nacl from 'tweetnacl';
import { sha256 } from 'js-sha256';
import storage from '../utils/storage';
import GatewayOfflineMask from '../components/GatewayOfflineMask';
import V3SessionList from '../components/Chat/V3SessionList';
import V3InputArea from '../components/Chat/V3InputArea';
import type { InputAreaHandle } from '../components/Chat/V3InputArea';
import V3MessageItem from '../components/Chat/V3MessageItem';
import ChatV3Auth from '../components/Chat/ChatV3Auth';
import ChatV3EmptyState from '../components/Chat/ChatV3EmptyState';
import { useChatV3WebSocket } from '../hooks/useChatV3WebSocket';
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

  /**
   * 获取会话来源（渠道）的 icon/color/label。
   *
   * 说明：label 走 i18n，避免顶部 `SourceConfig` 出现硬编码文案。
   */
  const getSourceMeta = useCallback((source: string) => {
    const s = source?.toLowerCase();
    const cfg = (s && SourceConfig[s]) ? SourceConfig[s] : (s === 'api' ? SourceConfig['openai-user'] : SourceConfig['fallback']);
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
    scrollRef
  });


  // Local UI States
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [editingLabelText, setEditingLabelText] = useState('');
  const [showThinking, setShowThinking] = useState<boolean>(() => storage.getItem('v3_show_thinking') === 'true');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [showScrollTopBtn, setShowScrollTopBtn] = useState(false);
  const [quickCommands, setQuickCommands] = useState<any[]>([]);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(() => storage.getItem('v3_show_quick_actions') !== 'false');
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [showSider, setShowSider] = useState(!isMobile);
  const [quotedMsg, setQuotedMsg] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const [editingMsgIndex, setEditingMsgIndex] = useState<number | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isSoulDrawerOpen, setIsSoulDrawerOpen] = useState(false);
  const [soulContent, setSoulContent] = useState('');
  const [isSoulLoading, setIsSoulLoading] = useState(false);
  const [isSoulSaving, setIsSoulSaving] = useState(false);
  const [activeSoulTab, setActiveSoulTab] = useState('edit');
  const [isComposing, setIsComposing] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
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

  const VirtuosoComponents = useMemo(() => ({
    Scroller: React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
      <div ref={(el) => {
        if (typeof ref === 'function') ref(el); 
        else if (ref) (ref as any).current = el;
        (scrollRef as any).current = el;
      }} {...props} style={{ ...(props.style || {}), overflowX: 'hidden' }} />
    ))
  }), []);

  useEffect(() => {
    fetchQuickCommands();
  }, []);

  useEffect(() => {
    if (!selectedBot && botsModels?.data?.bots?.length > 0) {
      const firstBot = botsModels.data.bots[0];
      setSelectedBot(`openclaw:${firstBot.id}`);
    }
  }, [botsModels, selectedBot]);

  const fetchQuickCommands = async () => {
    try {
      const res = await import('../api').then(m => m.default.get('/v1/openclaw/chat/quick-commands'));
      setQuickCommands(res.data || []);
    } catch (err) {
      console.error('Failed to fetch quick commands:', err);
    }
  };

  const handleOpenSoulEditor = async () => {
    if (!selectedBot) return;
    const botId = selectedBot.replace('openclaw:', '');
    try {
      setIsSoulLoading(true);
      setActiveSoulTab('edit');
      setIsSoulDrawerOpen(true);
      const bot = botsModels?.data?.bots?.find((b: any) => b.id === botId);
      const api = await import('../api').then(m => m.default);
      const res = await api.get(`/v1/openclaw/bots/file?id=${botId}&type=soul${bot?.workspace ? `&workspace=${encodeURIComponent(bot.workspace)}` : ''}`);
      setSoulContent(res.data.content || '');
    } catch (err: any) {
      message.error(t('common.loadFailed'));
    } finally {
      setIsSoulLoading(false);
    }
  };

  const handleSaveSoulContent = async () => {
    if (!selectedBot) return;
    const botId = selectedBot.replace('openclaw:', '');
    try {
      setIsSoulSaving(true);
      const bot = botsModels?.data?.bots?.find((b: any) => b.id === botId);
      const api = await import('../api').then(m => m.default);
      await api.post('/v1/openclaw/bots/file', { id: botId, type: 'soul', content: soulContent, workspace: bot?.workspace });
      message.success(t('bots.saveSuccess'));
      setIsSoulDrawerOpen(false);
    } catch (err: any) {
      message.error(t('bots.saveFailed'));
    } finally {
      setIsSoulSaving(false);
    }
  };

  const BotAvatar = ({ provider, size = 34 }: { provider: string, size?: number }) => {
    const p = (provider || '').toLowerCase();
    const wrapStyle = { width: size, height: size, borderRadius: '50%', background: '#fff', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', flexShrink: 0 as const };
    if (p.includes('openai')) return <div style={wrapStyle}><Bot size={size * 0.55} color="#10a37f" /></div>;
    if (p.includes('anthropic')) return <div style={{ ...wrapStyle, fontSize: size * 0.45, fontWeight: 900, color: '#d97706', fontFamily: 'serif' }}>A</div>;
    if (p.includes('google') || p.includes('gemini')) return <div style={wrapStyle}><Zap size={size * 0.55} color="#4285f4" fill="#4285f4" /></div>;
    if (p.includes('deepseek')) return <div style={wrapStyle}><Activity size={size * 0.55} color="#0891b2" /></div>;
    return <div style={wrapStyle}><Bot size={size * 0.55} color="#2563eb" /></div>;
  };

  const handleAddQuickCommand = async (values: any) => {
    try {
      const res = await import('../api').then(m => m.default.post('/v1/openclaw/chat/quick-commands', values));
      if (res.data.status === 'success') { message.success(t('common.success')); form.resetFields(); fetchQuickCommands(); }
    } catch (err) { message.error(t('common.error')); }
  };

  const handleDeleteQuickCommand = async (id: number) => {
    try {
      const res = await import('../api').then(m => m.default.delete(`/v1/openclaw/chat/quick-commands/${id}`));
      if (res.data.status === 'success') { message.success(t('common.success')); fetchQuickCommands(); }
    } catch (err) { message.error(t('common.error')); }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => { message.success(t('chat.copySuccess')); });
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && inputAreaRef.current) {
      inputAreaRef.current.uploadFiles(files);
    }
  };

  useEffect(() => {
    if (!isTyping && messages.length >= 2 && sessionKey) {
      const isUntitled = !sessionLabel || sessionLabel === '未命名会话' || sessionLabel === t('chat.noLabel');
      if (isUntitled && !isSummarizing) {
        const timer = setTimeout(() => {
          handleAutoSummarize(messages, true);
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [isTyping, sessionKey, sessionLabel]);

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

  return (
    <>
      {!isRunning && <GatewayOfflineMask onNavigateToDashboard={onNavigateToDashboard} />}
      <div style={{ flex: 1, display: 'flex', background: '#f8fafc', overflowX: 'hidden', height: '100%', position: 'relative', width: '100%' }}>
        
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
              loadingSessions={loadingSessions}
              sessionSearch={sessionSearch}
              setSessionSearch={setSessionSearch}
              onSelectSession={handleSelectSession}
              onNewSession={startNewSession}
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

        <div style={{ padding: isMobile ? '6px 10px' : '10px 16px', background: '#fff', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, gap: 8, width: '100%', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 10, minWidth: 0, flex: 1 }}>
            <Button 
                type="text" 
                icon={<LayoutPanelLeft size={18} />} 
                onClick={() => setShowSider(!showSider)} 
                style={{ marginLeft: -6, color: showSider ? '#4f46e5' : '#64748b', flexShrink: 0 }}
            />
            {status !== 'authenticated' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                <Badge status={status === 'error' ? 'error' : 'processing'} />
                <span style={{ fontSize: 11, color: status === 'error' ? '#ef4444' : '#94a3b8', fontWeight: 500 }}>
                    {status === 'error' ? t('chat.gatewayConnectFailed') : t('chat.gatewayConnecting')}
                </span>
              </div>
            )}
            
            {status === 'authenticated' && sessionKey ? (() => {
              const { botId, source } = parseSessionKey(sessionKey);
              const sourceMeta = getSourceMeta(source);
              const isMain = sessionKey === 'agent:main:main';
              const bot = botsModels?.data?.bots?.find((b: any) => b.id === botId);
              
              return (
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      {!isMobile && (
                        <Tooltip title={t('chat.clickToCopy', { defaultValue: '点击复制会话 ID' })}>
                          <span 
                              style={{ 
                              fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', cursor: 'pointer',
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                              maxWidth: 120,
                              lineHeight: '12px'
                              }}
                              className="v3-session-id-header"
                              onClick={() => copyToClipboard(sessionKey)}
                          >
                              {sessionKey}
                          </span>
                        </Tooltip>
                      )}
                      
                      {!isMobile && (
                        <div style={{ 
                          display: 'flex', 
                          alignItems: 'center', 
                          gap: 4, 
                          background: `${sourceMeta.color}15`, 
                          padding: '1px 6px', 
                          borderRadius: 4,
                          border: `1px solid ${sourceMeta.color}33`
                        }}>
                          <span style={{ color: sourceMeta.color, display: 'flex', alignItems: 'center' }}>
                            {isMain ? <Shield size={10} fill={sourceMeta.color} /> : React.cloneElement(sourceMeta.icon as React.ReactElement, { size: 10 })}
                          </span>
                          <span style={{ fontSize: 9, fontWeight: 700, color: sourceMeta.color, whiteSpace: 'nowrap' }}>
                            {sourceMeta.label}
                          </span>
                        </div>
                      )}

                      {!isMobile && bot && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>
                          <span>{bot.identityEmoji || '🤖'}</span>
                          <span style={{ fontWeight: 600 }}>{bot.identityName || bot.id}</span>
                        </div>
                      )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isEditingLabel ? (
                      <Input
                        size="small"
                        autoFocus
                        value={editingLabelText}
                        onChange={e => setEditingLabelText(e.target.value)}
                        onBlur={() => { handleUpdateLabel(editingLabelText); setIsEditingLabel(false); }}
                        onPressEnter={() => { handleUpdateLabel(editingLabelText); setIsEditingLabel(false); }}
                        disabled={isUpdatingLabel}
                        style={{ height: 20, fontSize: 12, width: isMobile ? 120 : 200 }}
                      />
                    ) : (
                      <>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: isMobile ? 150 : 300 }}>
                          {isMobile && bot ? `${bot.identityEmoji || '🤖'} ` : ''}
                          {isMain ? t('chat.mainSession', { defaultValue: '主会话' }) : (sessionLabel || t('chat.noLabel', { defaultValue: '未命名会话' }))}
                        </span>
                        {!isMain && (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <Tooltip title={t('chat.autoSummarize', { defaultValue: 'AI 自动总结标题' })}>
                              <Button 
                                size="small" 
                                type="text" 
                                icon={isSummarizing ? <RefreshCw size={10} className="animate-spin" /> : <Wand2 size={10} />} 
                                onClick={() => handleAutoSummarize(undefined, false, undefined, true)}
                                disabled={isSummarizing || messages.length === 0}
                                style={{ padding: 0, height: 16, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6366f1' }}
                              />
                            </Tooltip>
                            <Button 
                              size="small" 
                              type="text" 
                              icon={isUpdatingLabel ? <RefreshCw size={10} className="animate-spin" /> : <Save size={10} />} 
                              onClick={() => {
                                setEditingLabelText(sessionLabel || '');
                                setIsEditingLabel(true);
                              }}
                              style={{ padding: 0, height: 16, width: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })() : (
              !isMobile && status === 'authenticated' && (
                null
              )
            )}
            
            {status === 'authenticated' && !sessionKey && !isMobile && (
              <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 8, flexShrink: 0, marginLeft: 4 }}>
                <div style={{ height: 12, width: 1, background: '#f1f5f9', marginRight: 2 }}></div>
                <span style={{ fontSize: 11, color: lastHealth?.ok === false ? '#f59e0b' : '#10b981', fontWeight: 600, marginRight: 2 }}>
                    {lastHealth?.ok === false ? t('chat.gatewayFluctuating') : t('chat.connected')}
                </span>
                <div key={pulse} style={{ 
                  width: 7, height: 7, borderRadius: '50%', 
                  background: lastHealth?.ok === false ? '#f59e0b' : (lastHealth?.ok ? '#10b981' : '#94a3b8'),
                  animation: lastHealth?.ok ? 'v3-heartbeat 0.8s ease-out' : 'none',
                  flexShrink: 0
                }} />
                {!isMobile && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace', width: 35 }}>
                      {lastHealth ? `${lastHealth.latency}ms` : '---'}
                    </span>
                    <svg width="30" height="12" style={{ opacity: 0.6 }}>
                      <polyline
                        fill="none" stroke="#10b981" strokeWidth="1"
                        points={latencyHistory.map((l: any, i: any) => `${(i / 29) * 30},${12 - (Math.min(l, 200) / 200) * 12}`).join(' ')}
                      />
                    </svg>
                  </div>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 2 : 6, flexShrink: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginRight: 4 }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{t('chat.showThinking', { defaultValue: '思考过程' })}</span>
                  <Switch 
                      size="small" 
                      checked={showThinking} 
                      onChange={(val) => {
                          setShowThinking(val);
                          storage.setItem('v3_show_thinking', val ? 'true' : 'false');
                      }} 
                  />
              </div>
              {!isMobile && (
                <>
                  <div style={{ width: 1, height: 12, background: '#f1f5f9', marginRight: 2 }}></div>
                  <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>{t('chat.thinkingLevel', { defaultValue: '思考等级' })}:</span>
                  <Select size="small" value={thinkingLevel} onChange={handleThinkingLevelChange} style={{ width: 100 }} dropdownStyle={{ borderRadius: 8 }}>
                      <Select.Option value="off">Off</Select.Option>
                      <Select.Option value="minimal">Minimal</Select.Option>
                      <Select.Option value="low">Low</Select.Option>
                      <Select.Option value="medium">Medium</Select.Option>
                      <Select.Option value="high">High</Select.Option>
                      <Select.Option value="xhigh">XHigh</Select.Option>
                  </Select>
                </>
              )}
              {status === 'authenticated' && sessionKey && !isMobile && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', background: '#f8fafc', borderRadius: 8, height: 24, marginLeft: 4 }}>
                    <span style={{ fontSize: 10, color: lastHealth?.ok === false ? '#f59e0b' : '#10b981', fontWeight: 600 }}>
                        {lastHealth?.ok === false ? t('chat.gatewayFluctuating') : t('chat.connected')}
                    </span>
                    <div key={pulse} style={{ 
                      width: 6, height: 6, borderRadius: '50%', 
                      background: lastHealth?.ok === false ? '#f59e0b' : (lastHealth?.ok ? '#10b981' : '#94a3b8'),
                      animation: lastHealth?.ok ? 'v3-heartbeat 0.8s ease-out' : 'none',
                      flexShrink: 0
                    }} />
                    <span style={{ fontSize: 9, color: '#94a3b8', fontFamily: 'monospace', minWidth: 30 }}>
                      {lastHealth ? `${lastHealth.latency}ms` : '---'}
                    </span>
                  </div>
              )}
              <Button size="small" type="text" icon={<RefreshCw size={13} />} onClick={connect} title={t('common.restart')} />
          </div>
        </div>
  
        <div 
          ref={scrollRef}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          style={{ flex: 1, position: 'relative', width: '100%', overflow: 'hidden' }}
        >
          {isDragging && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(79, 70, 229, 0.08)',
              backdropFilter: 'blur(4px)',
              border: '3px dashed #6366f1',
              borderRadius: 16,
              zIndex: 200,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 12,
              pointerEvents: 'none',
              animation: 'v3-fade-in 0.2s'
            }}>
              <div style={{ width: 64, height: 64, borderRadius: 20, background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Plus size={32} color="#4f46e5" />
              </div>
              <span style={{ fontSize: 16, fontWeight: 700, color: '#4f46e5' }}>{t('chat.dropToUpload', { defaultValue: '松开即可上传文件' })}</span>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{t('chat.dropHint', { defaultValue: '支持图片、文档等文件类型' })}</span>
            </div>
          )}

          {isLoadingHistory && (
            <div style={{
              position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
              background: 'rgba(248, 250, 252, 0.85)',
              backdropFilter: 'blur(4px)',
              zIndex: 50,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 12,
              animation: 'v3-fade-in 0.2s'
            }}>
              <Spin size="large" />
              <span style={{ fontSize: 13, color: '#94a3b8', fontWeight: 500 }}>加载会话历史...</span>
            </div>
          )}

          {messages.length === 0 && !isLoadingHistory ? (
            <ChatV3EmptyState isMobile={!!isMobile} t={t} />
          ) : !isLoadingHistory ? (
            <Virtuoso
              ref={virtuosoRef}
              data={messages}
              overscan={200}
              followOutput={(isAtBottom) => isAtBottom ? (isTyping ? 'auto' : 'smooth') : false}
              atBottomStateChange={(atBottom) => {
                // 💡 优化 1：直接响应 Virtuoso 内部到底状态，不再做可能存在误差的手动偏移计算
                setShowScrollBtn(!atBottom);
                if (showScrollBtnRef) showScrollBtnRef.current = !atBottom;
                
                // 到底部即视为已读新消息
                if (atBottom) {
                  setHasNewMessages(false);
                }
              }}
              isScrolling={(scrolling) => {
                if (!scrolling && scrollRef.current) {
                  const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
                  
                  // 💡 优化 2：滚动停止时做一次“双重校验”，确保按钮显示状态绝对正确
                  const isActuallyAtBottom = scrollHeight - scrollTop - clientHeight < 20;
                  if (isActuallyAtBottom) {
                    setShowScrollBtn(false);
                    if (showScrollBtnRef) showScrollBtnRef.current = false;
                    setHasNewMessages(false);
                  } else {
                    setShowScrollBtn(true);
                    if (showScrollBtnRef) showScrollBtnRef.current = true;
                  }

                  // 只要向下滚动超过阈值就显示返回顶部
                  const shouldShowTop = scrollTop > 400;
                  if (showScrollTopBtn !== shouldShowTop) {
                    setShowScrollTopBtn(shouldShowTop);
                  }
                  lastScrollTopRef.current = scrollTop;
                }
              }}
              style={{ flex: 1, width: '100%' }}
              components={VirtuosoComponents}
              itemContent={(index, msg) => (
                <div style={{ padding: isMobile ? '0 12px' : '0 24px', paddingTop: index === 0 ? (isMobile ? 12 : 24) : 0, paddingBottom: 20 }}>
                  <V3MessageItem
                    key={msg.id || index}
                    msg={msg}
                    index={index}
                    isMobile={!!isMobile}
                    showThinking={showThinking}
                    selectedBot={selectedBot}
                    editingMsgIndex={editingMsgIndex}
                    editContent={editContent}
                    setEditContent={setEditContent}
                    onEdit={(idx, content) => {
                      setEditingMsgIndex(idx);
                      setEditContent(content);
                    }}
                    onSaveEdit={() => {
                      handleSaveEdit(editingMsgIndex!, editContent);
                      setEditingMsgIndex(null);
                    }}
                    onCancelEdit={() => setEditingMsgIndex(null)}
                    onDelete={(idx) => setMessages((prev: any) => prev.filter((_: any, i: any) => i !== idx))}
                    onQuote={setQuotedMsg}
                    onSend={handleWrappedSend}
                    onRegenerate={handleRegenerate}
                    copyToClipboard={copyToClipboard}
                    isTyping={isTyping}
                    isLast={index === messages.length - 1}
                    isStalled={isStalled}
                    tpsData={tpsData}
                    t={t}
                  />
                </div>
              )}
            />
          ) : null}
        </div>

        {/* 返回顶部浮动按钮 */}
        {showScrollTopBtn && (
            <div style={{ 
                position: 'absolute', 
                top: isMobile ? 70 : 80, 
                right: isMobile ? 16 : 24, 
                zIndex: 100, 
                animation: 'v3-fade-in 0.3s' 
            }}>
                <Button
                    className="v3-floating-btn"
                    shape="circle"
                    onClick={() => {
                        virtuosoRef.current?.scrollToIndex({ index: 0, behavior: 'smooth', align: 'start' });
                        setShowScrollTopBtn(false);
                    }}
                    icon={<ChevronUp size={16} />}
                    style={{ 
                        height: 36,
                        width: 36,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#64748b',
                        background: 'rgba(255, 255, 255, 0.8)',
                        backdropFilter: 'blur(8px)',
                        border: '1px solid rgba(0,0,0,0.05)',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
                    }}
                />
            </div>
        )}

        {/* 返回底部浮动按钮 */}
        {showScrollBtn && (
            <div style={{ 
                position: 'absolute', 
                bottom: isMobile ? (showQuickActions ? 170 : 130) : (showQuickActions ? 210 : 160), 
                right: isMobile ? 16 : 24, 
                zIndex: 100, 
                animation: 'v3-fade-in 0.3s' 
            }}>
                <Button
                    className={`v3-floating-btn ${hasNewMessages ? 'v3-floating-btn-active' : ''}`}
                    shape="round"
                    onClick={() => {
                        virtuosoRef.current?.scrollToIndex({
                            index: messages.length - 1,
                            behavior: 'smooth',
                            align: 'end'
                        });
                        setHasNewMessages(false);
                        setShowScrollBtn(false);
                    }}
                    icon={hasNewMessages ? <Activity size={14} className="animate-pulse" /> : <ChevronDown size={14} />}
                    style={{
                        height: 32,
                        fontSize: 12,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: hasNewMessages ? '0 12px' : '0 10px',
                        background: hasNewMessages ? '#2563eb' : '#fff',
                        color: hasNewMessages ? '#fff' : '#64748b',
                        border: hasNewMessages ? 'none' : '1px solid #e2e8f0',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        transition: 'all 0.2s'
                    }}
                >

                    {hasNewMessages && t('chat.newMessages')}
                </Button>
            </div>
        )}

        <div style={{ padding: isMobile ? '8px 12px' : '0 24px 20px', background: '#fafafa', borderTop: '1px solid #f1f5f9', width: '100%', boxSizing: 'border-box' }}>

           <div style={{ display: 'flex', gap: 8, marginBottom: showQuickActions ? 12 : 8, alignItems: 'center', transition: 'all 0.3s ease', paddingTop: 12, width: '100%', overflow: 'hidden', boxSizing: 'border-box' }}>
             {showQuickActions ? (
               <>
                 <div style={{ display: 'flex', gap: 8, overflowX: 'auto', flex: 1, paddingBottom: 6, scrollbarWidth: 'none', WebkitOverflowScrolling: 'touch', whiteSpace: 'nowrap', minWidth: 0 } as React.CSSProperties}>
                   {quickCommands.length === 0 ? (
                     <span
                       onClick={() => setIsManageModalOpen(true)}
                       style={{ fontSize: 12, color: '#94a3b8', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, userSelect: 'none' }}
                     >
                      {t('chat.noQuickCommandsAdd')} <Settings size={12} />
                     </span>
                   ) : quickCommands.map((item: any) => (
                     <Button
                       key={item.id}
                       size="small"
                       style={{ borderRadius: 16, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, background: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0', flexShrink: 0 }}
                       onClick={() => handleWrappedSend(item.prompt)}
                       disabled={status !== 'authenticated' || isTyping}
                     >
                       {item.label}
                     </Button>
                   ))}
                 </div>
                 <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                   <Button
                     type="text" size="small" icon={<Settings size={14} />}
                     style={{ color: '#94a3b8', background: '#f1f5f9', borderRadius: 12, height: 24, width: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                     onClick={() => setIsManageModalOpen(true)}
                   />
                   <Button
                     type="text" size="small" icon={<ChevronUp size={16} />}
                     style={{ color: '#94a3b8', background: '#f1f5f9', borderRadius: 12, height: 24, width: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                     onClick={() => { setShowQuickActions(false); storage.setItem('v3_show_quick_actions', 'false'); }}
                   />
                 </div>
               </>
             ) : (
               <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                 <div style={{ height: 1, flex: 1, background: '#f1f5f9' }}></div>
                 <Button
                   type="text" size="small" icon={<ChevronDown size={14} style={{ marginRight: 4 }} />}
                   onClick={() => { setShowQuickActions(true); storage.setItem('v3_show_quick_actions', 'true'); }}
                   style={{ fontSize: 11, color: '#94a3b8', height: 20, padding: '0 8px', borderRadius: 10, background: '#f8fafc', display: 'flex', alignItems: 'center', flexShrink: 0 }}
                 >
                   {t('chat.expandQuickCommands', { defaultValue: '快捷指令' })}
                 </Button>
                 <div style={{ height: 1, flex: 1, background: '#f1f5f9' }}></div>
               </div>
             )}
           </div>

            <div style={{ 
              display: 'flex', 
              background: '#fff', 
              borderRadius: 20, 
              // 💡 视觉加固：增强版聚焦效果。加大发光半径 (4px) 与位移 (-4px)，带来更强的悬浮确认感
              boxShadow: isFocused 
                ? '0 20px 40px -10px rgba(99, 102, 241, 0.25), 0 0 0 4px rgba(99, 102, 241, 0.3)' 
                : '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 0 0 2px rgba(99, 102, 241, 0.1)', 
              border: 'none',
              flexDirection: 'column',
              overflow: 'hidden',
              transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
              width: '100%',
              boxSizing: 'border-box',
              transform: isFocused ? 'translateY(-4px)' : 'none'
            }} className="input-container-v3">
              <div style={{ width: '100%', display: 'flex', alignItems: 'center', padding: isMobile ? '6px 12px 0' : '12px 16px 0', gap: 8, boxSizing: 'border-box' }}>
                 <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    background: '#f8fafc', 
                    borderRadius: 10, 
                    border: 'none',
                    padding: '2px 4px',
                    height: 38,
                    flex: isMobile ? 1 : '0 0 auto',
                    width: isMobile ? 'auto' : 420,
                    minWidth: 0,
                    boxShadow: 'none'
                 }}>
                   <Select
                       placeholder={t('chat.selectBotTip')}
                       style={{ width: isMobile ? '45%' : 220, fontSize: isMobile ? 11 : 13 }}
                       value={selectedBot}
                       onChange={setSelectedBot}
                       loading={loadingBots}
                       disabled={isTyping}
                       variant="borderless"
                       dropdownStyle={{ borderRadius: 10, minWidth: 240 }}
                       dropdownMatchSelectWidth={false}
                       listHeight={400}
                   >
                       {botsModels?.data?.bots?.map((bot: any) => (
                           <Select.Option key={bot.id} value={`openclaw:${bot.id}`}>
                               <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                                   <div style={{ flexShrink: 0 }}>
                                       <BotAvatar provider={bot.provider || (bot.id === 'main' ? 'openai' : '')} size={20} />
                                   </div>
                                   <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2', minWidth: 0 }}>
                                       <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                           {bot.name || bot.id}
                                       </span>
                                       <span style={{ fontSize: 9, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                           {bot.model || '---'} {t('chat.defaultSuffix', { defaultValue: '(默认)' })}
                                       </span>
                                   </div>
                               </div>
                           </Select.Option>
                       ))}
                   </Select>
                    <div style={{ width: 1, height: 16, background: "#bfdbfe", margin: "0 4px" }}></div>
                    <Select
                        placeholder={t("chat.sessionModelPlaceholder", { defaultValue: "自由切换会话模型" })}
                        style={{ flex: 1, fontSize: isMobile ? 11 : 13, minWidth: 0 }}
                        value={sessionModel}
                        onChange={handleModelChange}
                        loading={loadingBots}
                        disabled={isTyping}
                        variant="borderless"
                        dropdownStyle={{ borderRadius: 10, minWidth: 200 }}
                        dropdownMatchSelectWidth={false}
                    >
                        <Select.Option value="">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#94a3b8' }}>
                                <RefreshCw size={14} />
                                <span style={{ fontSize: 13 }}>{t('chat.defaultModel', { defaultValue: '使用默认模型' })}</span>
                            </div>
                        </Select.Option>
                        {(() => {
                            const groups = (botsModels?.data?.models || []).reduce((acc: Record<string, any[]>, m: any) => {
                                // 核心修复：解析 id 中的 provider 部分 (e.g. "aliyun/qwen" -> "aliyun")
                                let p = 'Others';
                                if (m.id && m.id.includes('/')) {
                                    p = m.id.split('/')[0];
                                } else if (m.provider) {
                                    p = m.provider;
                                }
                                
                                if (!acc[p]) acc[p] = [];
                                acc[p].push(m);
                                return acc;
                            }, {});
                            
                            // 按照提供商名称排序，让列表更稳定
                            return Object.keys(groups).sort().map(provider => (
                                <Select.OptGroup label={provider.toUpperCase()} key={provider}>
                                    {groups[provider].map((m: any) => (
                                        <Select.Option key={m.id} value={m.id}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <Cpu size={14} style={{ color: '#6366f1' }} />
                                                <span style={{ fontSize: 13 }}>{m.name || m.id}</span>
                                            </div>
                                        </Select.Option>
                                    ))}
                                </Select.OptGroup>
                            ));
                        })()}
                    </Select>
                 </div>
                 
                 <Button 
                   type="text" 
                   size="small" 
                   icon={<Sparkles size={18} color="#eab308" />} 
                   onClick={handleOpenSoulEditor}
                   disabled={!selectedBot || status !== 'authenticated'}
                   style={{ 
                     display: 'flex', alignItems: 'center', justifyContent: 'center',
                     background: '#fffbeb', 
                     border: 'none',
                     borderRadius: 10, 
                     height: 38, 
                     width: 38, 
                     padding: 0,
                     boxShadow: '0 2px 4px rgba(234, 179, 8, 0.05)'
                   }}
                 />
               </div>
              
              {quotedMsg && (
                 <div style={{ padding: isMobile ? '6px 12px 0' : '8px 16px 0', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6, boxSizing: 'border-box', width: '100%', overflow: 'hidden' }}>
                   <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 12, color: '#64748b', background: '#f1f5f9', padding: '4px 8px', borderRadius: 6, minWidth: 0, flex: 1, overflow: 'hidden' }}>
                     <Quote size={12} style={{ flexShrink: 0, marginTop: 2 }} />
                     <span style={{ overflow: 'hidden', display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: 2, wordBreak: 'break-all' } as React.CSSProperties}>{quotedMsg}</span>
                   </div>
                   <Button type="text" size="small" icon={<Plus size={14} style={{ transform: 'rotate(45deg)' }} />} onClick={() => setQuotedMsg(null)} style={{ flexShrink: 0 }} />
                 </div>
               )}

              <V3InputArea
                ref={inputAreaRef}
                status={status}
                isMobile={!!isMobile}
                isTyping={isTyping}
                onSend={handleWrappedSend}
                onStop={handleStopGeneration}
                t={t}
                isComposing={isComposing}
                setIsComposing={setIsComposing}
                isFocused={isFocused}
                setIsFocused={setIsFocused}
                selectedBot={selectedBot}
              />
            </div>

          </div>
        </div>
        <ChatV3Auth 
          status={status} 
          isMobile={!!isMobile} 
          onConnect={connect} 
          t={t} 
        />
      </div>

      {/* 管理快捷指令 Modal */}
      <Modal
        title={<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Settings size={20} color="#2563eb" /><span>{t('chat.manageQuickCommands', { defaultValue: '管理快捷指令' })}</span></div>}
        open={isManageModalOpen}
        onCancel={() => setIsManageModalOpen(false)}
        footer={null}
        width={500}
      >
        <div style={{ marginBottom: 24 }}>
          <h4 style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>{t('chat.currentCommands', { defaultValue: '已添加' })}</h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {quickCommands.map((cmd: any) => (
              <div key={cmd.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 14 }}>{cmd.label}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd.prompt}</div>
                </div>
                {!cmd.is_system && (
                  <Button type="text" danger icon={<Trash2 size={14} />} size="small" onClick={() => handleDeleteQuickCommand(cmd.id)} />
                )}
              </div>
            ))}
          </div>
        </div>
        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 24 }}>
          <h4 style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>{t('chat.addCommand', { defaultValue: '添加新指令' })}</h4>
          <Form form={form} layout="vertical" onFinish={handleAddQuickCommand}>
            <Form.Item name="label" label={t('chat.commandLabel', { defaultValue: '按钮名称' })} rules={[{ required: true }]}>
              <Input placeholder={t('chat.commandLabelPlaceholder', { defaultValue: '例如：写一首诗' })} style={{ borderRadius: 8 }} />
            </Form.Item>
            <Form.Item name="prompt" label={t('chat.commandPrompt', { defaultValue: '指令内容' })} rules={[{ required: true }]}>
              <Input.TextArea placeholder={t('chat.commandPromptPlaceholder', { defaultValue: '输入该按钮触发的内容...' })} autoSize={{ minRows: 2 }} style={{ borderRadius: 8 }} />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<Plus size={16} />} block style={{ borderRadius: 8, height: 40 }}>
              {t('chat.addCommandBtn', { defaultValue: '添加快捷指令' })}
            </Button>
          </Form>
        </div>
      </Modal>

      {/* 专家灵魂快捷编辑器 (Quick Soul Editor) */}
      <Drawer
        title={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', paddingRight: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ background: '#fffbeb', padding: 6, borderRadius: 10, border: '1px solid #fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Sparkles size={18} color="#d97706" />
              </div>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: '#1e293b' }}>{t('bots.editSoul', { defaultValue: '编辑专家灵魂' })}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{selectedBot?.replace('openclaw:', '')}</div>
              </div>
            </div>
          </div>
        }
        placement="right"
        onClose={() => setIsSoulDrawerOpen(false)}
        open={isSoulDrawerOpen}
        width={isMobile ? '100%' : 600}
        extra={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button icon={<X size={16} />} onClick={() => setIsSoulDrawerOpen(false)} />
            <Button 
                type="primary" 
                icon={<Save size={16} />} 
                loading={isSoulSaving} 
                onClick={handleSaveSoulContent}
                style={{ background: '#2563eb', borderRadius: 8, height: 32 }}
            >
              {t('common.save', { defaultValue: '保存并应用' })}
            </Button>
          </div>
        }
        styles={{ 
          header: { borderBottom: '1px solid #f1f5f9', padding: '16px 24px' },
          body: { padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }
        }}
        closable={false}
      >
        {isSoulLoading ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16, background: '#f8fafc' }}>
            <Spin size="large" />
            <div style={{ color: '#94a3b8', fontSize: 13, fontFamily: 'monospace' }}>RECOVERING_SOUL_FRAGMENTS...</div>
          </div>
        ) : (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%' }}>
            <Tabs
              activeKey={activeSoulTab}
              onChange={setActiveSoulTab}
              centered
              className="v3-soul-tabs"
              style={{ flex: 1, display: 'flex', flexDirection: 'column' }}
              tabBarStyle={{ marginBottom: 0, padding: '0 16px', borderBottom: '1px solid #f1f5f9', background: '#fff' }}
              items={[
                {
                  key: 'edit',
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                      <PenLine size={16} />
                      <span>{t('common.edit', { defaultValue: '编辑内容' })}</span>
                    </div>
                  ),
                  children: (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 'calc(100vh - 250px)' }}>
                      <div style={{ padding: '8px 16px', background: '#f8fafc', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Soul Source (Markdown)
                      </div>
                      <Input.TextArea
                        value={soulContent}
                        onChange={e => setSoulContent(e.target.value)}
                        placeholder="Enter expert's soul (Prompt)..."
                        style={{ 
                          flex: 1, 
                          border: 'none', 
                          borderRadius: 0, 
                          resize: 'none', 
                          fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                          fontSize: 13,
                          padding: 20,
                          background: '#fff',
                          lineHeight: 1.6,
                          minHeight: 400
                        }}
                      />
                    </div>
                  )
                },
                {
                  key: 'preview',
                  label: (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' }}>
                      <Eye size={16} />
                      <span>{t('common.preview', { defaultValue: '实时预览' })}</span>
                    </div>
                  ),
                  children: (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 'calc(100vh - 250px)', background: '#fafafa' }}>
                      <div style={{ padding: '8px 16px', background: '#f1f5f9', fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: 1 }}>
                        Live Preview
                      </div>
                      <div style={{ flex: 1, padding: 20, overflowY: 'auto' }}>
                        <div style={{ maxWidth: 800, margin: '0 auto', background: '#fff', padding: 24, borderRadius: 12, boxShadow: '0 2px 8px rgba(0,0,0,0.02)', minHeight: '100%' }}>
                          <ReactMarkdown 
                            remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} 
                            rehypePlugins={[rehypeSanitize, rehypeKatex]}
                          >
                            {soulContent || '*No content to preview*'}
                          </ReactMarkdown>
                        </div>
                      </div>
                    </div>
                  )
                }
              ]}
            />
            <div style={{ padding: '12px 20px', background: '#fff', borderTop: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#fbbf24', animation: 'v3-heartbeat 1.5s infinite' }} />
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>
                    修改后点击保存，网关将立即应用最新的专家人格设置。
                </div>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
};

export default ChatV3;
