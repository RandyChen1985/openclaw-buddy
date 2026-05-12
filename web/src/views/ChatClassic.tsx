import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Card, Select, Input, Button, Avatar, Spin, message, Modal, Form, Upload, Radio, Space } from 'antd';
import { useTranslation } from 'react-i18next';
import { Send, Bot, User, RefreshCw, Trash2, MessageSquare, Zap, Settings, Copy, RotateCcw, StopCircle, ListRestart, Plus, ChevronUp, ChevronDown, Quote, X, ExternalLink, Share2, ArrowDown, ZapOff, Activity, Paperclip, FileText, Loader2, Maximize2, Minimize2, Image, Pencil } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import api, { getFullUrl } from '../api';
import { buildChatEmbedPageUrl, type ChatEmbedLayout } from '../utils/chatEmbedUrl';
import storage from '../utils/storage';
import { Mermaid, CodeBlock, ECharts, isEchartsCodeFenceLanguage } from '../components/ChatComponents';
import Tooltip from '../components/common/AppTooltip';


const { Option } = Select;
const LEGACY_CHAT_HISTORY_KEY = 'chat_history';
const CLASSIC_CHAT_HISTORY_PREFIX = 'chat_history_classic';
const CLASSIC_SESSION_ID_KEY = 'chat_session_id';

// Components moved to ChatComponents.tsx

interface FileInfo {
  url: string;
  thumbUrl?: string;
  path: string;
  filename: string;
  size: number;
  ext: string;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string;
  quotedMessage?: string;
  metrics?: {
    ttft?: number;
    tps?: number;
    duration?: number;
  }
}

interface ChatClassicProps {
  botsModels: any;
  loadingBots: boolean;
  onRefreshBots: () => void;
  isMobile?: boolean;
  onRestartGateway?: () => Promise<void>;
  isDarkMode?: boolean;
  /** 当前登录用户名（可选）。用于生成稳定的 HTTP 会话 id */
  usernameForSessionId?: string | null;
}

function sanitizeClassicSessionUsername(username?: string | null): string {
  const raw = (username || '').trim();
  return raw
    ? raw.replace(/:/g, '_').replace(/\s+/g, '').replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 48)
    : '';
}

function ensureClassicSessionId(urlUser: string | null, username?: string | null): string | null {
  if (urlUser) return null;

  let storedSessionId = storage.getItem(CLASSIC_SESSION_ID_KEY);
  const safeU = sanitizeClassicSessionUsername(username);
  const shouldForceUsernameSession = !!safeU && (!storedSessionId || !storedSessionId.includes(safeU));

  if (!storedSessionId || shouldForceUsernameSession) {
    storedSessionId = safeU
      ? `s-${Date.now()}-${safeU}`
      : `s-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    storage.setItem(CLASSIC_SESSION_ID_KEY, storedSessionId);
  }

  return storedSessionId;
}

function loadClassicMessages(key: string, allowLegacyFallback = false): Message[] {
  const savedForKey = storage.getItem(key);
  const legacySaved = allowLegacyFallback && key !== LEGACY_CHAT_HISTORY_KEY ? storage.getItem(LEGACY_CHAT_HISTORY_KEY) : null;
  const saved = savedForKey || legacySaved;
  if (!saved) return [];

  try {
    const parsed = JSON.parse(saved);
    if (!savedForKey && legacySaved) storage.removeItem(LEGACY_CHAT_HISTORY_KEY);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    storage.removeItem(key);
    if (key !== LEGACY_CHAT_HISTORY_KEY) storage.removeItem(LEGACY_CHAT_HISTORY_KEY);
    return [];
  }
}

const ChatClassic: React.FC<ChatClassicProps> = ({ 
  botsModels, loadingBots, onRefreshBots, isMobile, onRestartGateway, isDarkMode = false, usernameForSessionId
}) => {


  const { t } = useTranslation();
  const queryParams = new URLSearchParams(window.location.search);
  const urlBot = queryParams.get('bot');
  const urlUser = queryParams.get('user');
  const isEmbedMode = queryParams.get('embed') === 'true';

  const [selectedBot, setSelectedBot] = useState<string>('');
  const [inputText, setInputText] = useState('');
  const [generatedSessionId, setGeneratedSessionId] = useState<string | null>(() => ensureClassicSessionId(urlUser, usernameForSessionId));
  const [messages, setMessages] = useState<Message[]>([]);
  const [quotedMsg, setQuotedMsg] = useState<string | null>(null);
  const [attachedFiles, setAttachedFiles] = useState<FileInfo[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // --- Provider Icon Component ---
  const ProviderIcon = ({ provider, size = 18 }: { provider: string, size?: number }) => {
    const p = (provider || '').toLowerCase();
    const iconStyle = { width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' };
    
    if (p.includes('openai')) return <div style={iconStyle}><Bot size={size * 0.8} color="#10a37f" /></div>;
    if (p.includes('anthropic') || p.includes('claude')) return <div style={{ ...iconStyle, fontSize: size * 0.7, fontWeight: 900, color: '#d97706', fontFamily: 'serif' }}>A</div>;
    if (p.includes('google') || p.includes('gemini')) return <div style={iconStyle}><Zap size={size * 0.8} color="#4285f4" fill="#4285f4" /></div>;
    if (p.includes('deepseek')) return <div style={iconStyle}><Activity size={size * 0.8} color="#0891b2" /></div>;
    if (p.includes('mistral')) return <div style={iconStyle}><ZapOff size={size * 0.8} color="#f97316" /></div>;
    
    return <div style={{ ...iconStyle, fontSize: size * 0.8 }}>🍭</div>;
  };
  
  // --- Markdown 预处理逻辑 ---
  const preprocessMarkdown = (content: string) => {
    if (!content) return '';
    return content
      // 1. 确保标题 (#) 前后有空行
      .replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2')
      .replace(/(#{1,6}\s.*)\n([^\n])/g, '$1\n\n$2')
      // 2. 确保代码块 (```) 前后有空行
      .replace(/([^\n])\n(```)/g, '$1\n\n$2')
      .replace(/(```[\s\S]*?```)\n([^\n])/g, '$1\n\n$2')
      // 3. 强化表格 (|) 前后空行，确保表格不被普通文本截断
      .replace(/([^\n])\n(\|)/g, (match, p1, p2) => {
        return p1.trim().endsWith('|') ? match : p1 + '\n\n' + p2;
      })
      .replace(/(\|)\n([^|\n][^\n]*)/g, (match, p1, p2) => {
        return p2.trim().startsWith('|') ? match : p1 + '\n\n' + p2;
      })
      // 4. 修复模型输出中可能存在的非标准表格分隔线
      .replace(/(\n\|[^\n]+\|)\n(\|(?:\s*:-+\s*\|)+)/g, '$1\n$2');
  };

  const [isTyping, setIsTyping] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [showScrollTopBtn, setShowScrollTopBtn] = useState(false);
  const [isComposing, setIsComposing] = useState(false);
  const inputRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [chatEnabled, setChatEnabled] = useState<boolean | null>(null);
  const [checkingEnabled, setCheckingEnabled] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const historyLoadedKeyRef = useRef<string | null>(null);
  const suppressNextHistoryPersistRef = useRef(false);
  
  const [quickCommands, setQuickCommands] = useState<any[]>([]);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(() => {
    return storage.getItem('chat_show_quick_actions') !== 'false';
  });
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  /** 管理弹窗内「当前指令」列表：桌面默认展开，移动端默认折叠 */
  const [manageModalCurrentCommandsOpen, setManageModalCurrentCommandsOpen] = useState(() => !isMobile);
  const [form] = Form.useForm();

  const [editingUserMsgIndex, setEditingUserMsgIndex] = useState<number | null>(null);
  const [editUserDraft, setEditUserDraft] = useState('');

  const [embedShareOpen, setEmbedShareOpen] = useState(false);
  const [embedOptions, setEmbedOptions] = useState<{
    botId: string;
    layout: ChatEmbedLayout;
    defaultTab: 'v3' | 'classic';
  }>({ botId: '', layout: 'tabs', defaultTab: 'v3' });

  const historyStorageKey = useMemo(() => {
    const userPart = urlUser
      ? `embed-${urlUser}`
      : generatedSessionId
        ? `session-${generatedSessionId}`
        : 'anonymous';
    const botPart = selectedBot || 'default';
    return `${CLASSIC_CHAT_HISTORY_PREFIX}:${userPart}:${botPart}`;
  }, [generatedSessionId, selectedBot, urlUser]);

  useEffect(() => {
    suppressNextHistoryPersistRef.current = true;
    historyLoadedKeyRef.current = historyStorageKey;
    setMessages(loadClassicMessages(historyStorageKey, !!selectedBot));
  }, [historyStorageKey, selectedBot]);

  // 持久化存储
  useEffect(() => {
    if (historyLoadedKeyRef.current !== historyStorageKey) return;
    if (suppressNextHistoryPersistRef.current) {
      suppressNextHistoryPersistRef.current = false;
      return;
    }
    storage.setItem(historyStorageKey, JSON.stringify(messages));
  }, [historyStorageKey, messages]);

  /** 与 V3 一致：应用内「铺满视口」全屏，不使用浏览器原生 Fullscreen API（避免整页进入 OS 级全屏） */
  const toggleFullscreen = () => setIsFullscreen((prev) => !prev);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isFullscreen]);

  useEffect(() => {
    checkChatStatus();
    fetchQuickCommands();
  }, []);

  useEffect(() => {
    setGeneratedSessionId(ensureClassicSessionId(urlUser, usernameForSessionId));
  }, [urlUser, usernameForSessionId]);

  useEffect(() => {
    if (botsModels?.data?.bots?.length > 0) {
      if (urlBot) {
        const targetBot = botsModels.data.bots.find((b: any) => b.id === urlBot || b.name === urlBot);
        if (targetBot) {
          setSelectedBot(`openclaw:${targetBot.id}`);
        } else if (!selectedBot) {
          setSelectedBot(`openclaw:${botsModels.data.bots[0].id}`);
        }
      } else if (!selectedBot) {
        setSelectedBot(`openclaw:${botsModels.data.bots[0].id}`);
      }
    }
  }, [botsModels, urlBot]);

  const fetchQuickCommands = async () => {
    try {
      const res = await api.get('/v1/openclaw/chat/quick-commands');
      setQuickCommands(res.data || []);
    } catch (err) {
      console.error('Failed to fetch quick commands:', err);
    }
  };

  const handleAddQuickCommand = async (values: any) => {
    try {
      const res = await api.post('/v1/openclaw/chat/quick-commands', values);
      if (res.data.status === 'success') {
        message.success(t('common.success'));
        form.resetFields();
        fetchQuickCommands();
      }
    } catch (err) {
      message.error(t('common.error'));
    }
  };

  const handleDeleteQuickCommand = async (id: number) => {
    try {
      const res = await api.delete(`/v1/openclaw/chat/quick-commands/${id}`);
      if (res.data.status === 'success') {
        message.success(t('common.success'));
        fetchQuickCommands();
      }
    } catch (err) {
      message.error(t('common.error'));
    }
  };

  const checkChatStatus = async () => {
    try {
      const res = await api.get('/v1/openclaw/chat/status');
      setChatEnabled(res.data.enabled);
    } catch (err) {
      console.error('Failed to check chat status:', err);
    } finally {
      setCheckingEnabled(false);
    }
  };

  const handleEnableChat = () => {
    Modal.confirm({
      title: t('chat.enableChatTitle'),
      content: t('chat.enableChatContent'),
      okText: t('chat.enableChatButton'),
      cancelText: t('common.cancel'),
      onOk: async () => {
        setEnabling(true);
        try {
          const res = await api.post('/v1/openclaw/chat/enable');
          if (res.data.status === 'success') {
            message.loading(t('dashboard.asyncRestart'), 2);
            if (onRestartGateway) {
              await onRestartGateway();
            }
            message.success(t('common.success'));
            setChatEnabled(true);
          } else {
            message.error(res.data.error || t('common.error'));
          }
        } catch (err) {
          message.error(t('common.error') + ': ' + err);
        } finally {
          setEnabling(false);
        }
      }
    });
  };

  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      if (scrollRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
        
        // 返回底部逻辑
        setShowScrollButton(scrollHeight - scrollTop - clientHeight > 300);

        // 返回顶部逻辑: 仅向上翻页且超过 150px 时显示
        const isScrollingUp = scrollTop < lastScrollTopRef.current;
        setShowScrollTopBtn(isScrollingUp && scrollTop > 150);

        lastScrollTopRef.current = scrollTop;
      }
    };
    const div = scrollRef.current;
    div?.addEventListener('scroll', handleScroll);
    return () => div?.removeEventListener('scroll', handleScroll);
  }, []);

  const scrollToBottom = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  };

  const scrollToTop = () => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
  };

  const handleScrollToMessage = (content: string) => {
    const messageElements = document.querySelectorAll('[data-msg-content]');
    for (const el of Array.from(messageElements)) {
      if (el.getAttribute('data-msg-content') === content) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('message-highlight');
        setTimeout(() => el.classList.remove('message-highlight'), 2000);
        break;
      }
    }
  };

  useEffect(() => {
    if (scrollRef.current && !showScrollButton) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const c = useMemo(() => {
    const border = isDarkMode ? '#334155' : '#e2e8f0';
    const hairline = isDarkMode ? '#334155' : '#f1f5f9';
    return {
      pageBg: isDarkMode ? '#0f172a' : '#f8fafc',
      card: isDarkMode ? '#1e293b' : '#fff',
      cardShadow: isDarkMode ? '0 1px 2px rgba(0,0,0,0.25)' : '0 1px 2px rgba(0,0,0,0.03)',
      border,
      hairline,
      scrollBg: isDarkMode ? '#0f172a' : '#fafafa',
      heading: isDarkMode ? '#f1f5f9' : '#1e293b',
      body: isDarkMode ? '#94a3b8' : '#64748b',
      assistantBg: isDarkMode ? '#1e293b' : '#fff',
      assistantBorder: isDarkMode ? '#334155' : '#e2e8f0',
      assistantText: isDarkMode ? '#e2e8f0' : '#1e293b',
      overlay: isDarkMode ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.65)',
      pickCard: isDarkMode ? '#1e293b' : '#fff',
      pickCardBorder: hairline,
      mdH: isDarkMode ? '#f1f5f9' : '#1e293b',
      mdTableBorder: border,
      mdThBg: isDarkMode ? '#1e293b' : '#f8fafc',
      mdStrip: isDarkMode ? '#0f172a' : '#fcfcfc',
      mdQuote: isDarkMode ? '#94a3b8' : '#64748b',
      mdQuoteBorder: isDarkMode ? '#475569' : '#e2e8f0',
      inputFoot: isDarkMode ? '#1e293b' : '#fff',
      quoteBar: isDarkMode ? '#0f172a' : '#f8fafc',
      ghostBtnBg: isDarkMode ? '#334155' : '#f1f5f9',
      uploadBg: isDarkMode ? '#1e293b' : '#fff',
      cmdRowBg: isDarkMode ? '#0f172a' : '#f8fafc',
      cmdRowBorder: hairline,
      shareTa: isDarkMode ? '#0f172a' : '#f8fafc',
      subtle: '#94a3b8',
      dot: isDarkMode ? '#475569' : '#cbd5e1',
      uploadDashed: isDarkMode ? '#1e3a5f' : '#eff6ff',
      /** 欢迎页外层：浅色模式与滚动区融为一体（无边无影）；深色保留极弱渐变与轻阴影 */
      welcomeHeroBg: isDarkMode
        ? 'linear-gradient(185deg, rgba(30,41,59,0.35) 0%, rgba(15,23,42,0.05) 52%, rgba(15,23,42,0) 100%)'
        : 'transparent',
      welcomeHeroShadow: isDarkMode ? '0 12px 36px -10px rgba(0,0,0,0.28)' : 'none',
      welcomeAccent: isDarkMode ? '#60a5fa' : '#2563eb',
      welcomeCardShadow: isDarkMode
        ? '0 4px 20px rgba(0,0,0,0.28)'
        : '0 2px 12px rgba(15,23,42,0.05), 0 4px 20px rgba(15,23,42,0.04)',
      welcomeCardShadowHover: isDarkMode
        ? '0 12px 36px -4px rgba(0,0,0,0.45)'
        : '0 10px 28px -6px rgba(15,23,42,0.1), 0 4px 12px rgba(37,99,235,0.08)',
      welcomeIconBg: isDarkMode ? 'rgba(59,130,246,0.16)' : 'rgba(239,246,255,0.98)',
      welcomeIconBorder: isDarkMode ? 'rgba(96,165,250,0.3)' : 'rgba(191,219,254,0.95)'
    };
  }, [isDarkMode]);

  const markdownStyles = useMemo(() => (
    <style>{`
      .markdown-body {
        font-size: 13.5px;
        line-height: 1.5;
        word-wrap: break-word;
        color: inherit;
      }
      .markdown-body > *:first-child { margin-top: 0 !important; }
      .markdown-body > *:last-child { margin-bottom: 0 !important; }
      
      .markdown-body h1, .markdown-body h2, .markdown-body h3 {
        margin-top: 12px;
        margin-bottom: 6px;
        font-weight: 700;
        color: ${c.mdH};
      }
      .markdown-body p { margin-bottom: 6px; }
      .markdown-body a { color: #2563eb; text-decoration: none; }
      .markdown-body a:hover { text-decoration: underline; }
      .markdown-body ul, .markdown-body ol {
        margin-bottom: 6px;
        padding-left: 20px;
      }
      .markdown-body li {
        margin-bottom: 2px;
      }
      .markdown-body table {
        border-spacing: 0;
        border-collapse: collapse;
        margin-bottom: 12px;
        width: 100%;
        overflow-x: auto;
        display: block;
        border-radius: 8px;
        border: 1px solid ${c.mdTableBorder};
      }
      .markdown-body table th, .markdown-body table td {
        padding: 8px 12px;
        border: 1px solid ${c.mdTableBorder};
      }
      .markdown-body table th {
        background-color: ${c.mdThBg};
        font-weight: 600;
        text-align: left;
      }
      .markdown-body table tr:nth-child(2n) {
        background-color: ${c.mdStrip};
      }
      .markdown-body blockquote {
        margin: 0 0 10px 0;
        padding: 0 12px;
        color: ${c.mdQuote};
        border-left: 4px solid ${c.mdQuoteBorder};
      }
      .markdown-body pre {
        margin-bottom: 10px !important;
        max-width: 100%;
        overflow-x: auto;
      }
      @media (max-width: 768px) {
        .markdown-body {
          font-size: 13px;
          word-break: break-word;
          overflow-wrap: anywhere;
        }
        .markdown-body h1 { fontSize: 1.5em; margin-top: 10px; }
        .markdown-body h2 { fontSize: 1.3em; margin-top: 8px; }
        .markdown-body h3 { fontSize: 1.1em; margin-top: 6px; }
        .markdown-body p { margin-bottom: 4px; }
        .markdown-body ul, .markdown-body ol { padding-left: 16px; margin-bottom: 4px; }
        .markdown-body blockquote { margin-bottom: 6px; }
      }

      .chat-classic-welcome-card {
        transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.28s ease, border-color 0.22s ease;
      }
      .chat-classic-welcome-card:hover {
        transform: translateY(-3px);
        box-shadow: ${c.welcomeCardShadowHover};
        border-color: ${c.welcomeAccent}99 !important;
      }
    `}</style>
  ), [c]);

  /** conversationMessages：必须以最后一条用户消息结尾（尚未追加本轮助手回复） */
  const runStreamingCompletion = async (conversationMessages: Message[]) => {
    setIsTyping(true);
    abortControllerRef.current = new AbortController();

    const thinkingTip = t('chat.thinking');
    const assistantTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const assistantMessage: Message = { role: 'assistant', content: thinkingTip, timestamp: assistantTimestamp };
    setMessages([...conversationMessages, assistantMessage]);
    const replaceLastAssistant = (content: string) => {
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant') {
          return [...prev.slice(0, -1), { ...last, content }];
        }
        return prev;
      });
    };

    const formattedMessages = conversationMessages.map(m => {
        let content = m.content;
        if (m.quotedMessage) {
            content = `> ${m.quotedMessage.split('\n')[0]}...\n\n${content}`;
        }
        return { role: m.role, content };
    });

    const requestBody: any = {
      model: selectedBot,
      messages: formattedMessages,
      stream: true
    };

    let userIdToSend = urlUser;
    if (!userIdToSend && generatedSessionId) {
      userIdToSend = `lobster-${generatedSessionId}`;
    }
    if (userIdToSend) {
      requestBody.user = userIdToSend;
    }

    // 打字机状态控制
    let displayedContent = thinkingTip;
    const charQueue: string[] = [];
    let isStreamingFinished = false;
    let queueDrained = false;
    let resolveQueueDrained: () => void = () => {};
    const queueDrainedPromise = new Promise<void>((resolve) => {
      resolveQueueDrained = () => {
        if (queueDrained) return;
        queueDrained = true;
        resolve();
      };
    });

    const processQueue = () => {
      if (charQueue.length > 0) {
        const batchSize = charQueue.length > 20 ? 3 : (charQueue.length > 5 ? 2 : 1);
        for (let i = 0; i < batchSize && charQueue.length > 0; i++) {
          const char = charQueue.shift();
          if (char) displayedContent += char;
        }

        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant') {
            return [...prev.slice(0, -1), { ...last, content: displayedContent }];
          }
          return prev;
        });
      }

      if (!isStreamingFinished || charQueue.length > 0) {
        requestAnimationFrame(processQueue);
      } else {
        resolveQueueDrained();
      }
    };

    requestAnimationFrame(processQueue);

    try {
      const chatUrl = getFullUrl('/v1/openclaw/chat/completions');
      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${storage.getItem('guardian_token')}`
        },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) {
        let errorMessage = t('chat.networkError');
        if (response.status === 403 || response.status === 401) {
          try {
            const errorData = await response.clone().json();
            if (errorData.error?.message?.includes('operator.write')) {
              errorMessage = t('chat.permissionError');
            } else {
              errorMessage = errorData.error?.message || errorData.message || errorMessage;
            }
          } catch (e) {}
        } else {
          try {
            const errorData = await response.clone().json();
            errorMessage = errorData.error?.message || errorData.message || errorMessage;
          } catch (e) {}
        }
        throw new Error(errorMessage);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error(t('chat.streamError'));

      const decoder = new TextDecoder();
      let isFirstChunk = true; 
      let firstTokenTime: number | null = null;
      const startTime = Date.now();
      let totalLength = 0;
      let pendingLine = '';
      const handleDataLine = (line: string) => {
        if (!line.startsWith('data:')) return false;
        const dataStr = line.slice(5).trim();
        if (!dataStr) return false;
        if (dataStr === '[DONE]') {
          isStreamingFinished = true;
          return true;
        }
        const data = JSON.parse(dataStr);
        if (data.error) {
          const errMessage = data.error.message || data.error || t('chat.streamError');
          throw new Error(errMessage);
        }
        const content = data.choices?.[0]?.delta?.content ?? data.choices?.[0]?.message?.content ?? '';
        if (content) {
          if (isFirstChunk) {
            // 首个有效字符到达，彻底抹除“正在思考中...”提示
            displayedContent = '';
            isFirstChunk = false;
          }
          for (const char of content) {
            charQueue.push(char);
          }
          totalLength += content.length;
        }
        return false;
      };
      
      streamLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) {
          pendingLine += decoder.decode();
          if (pendingLine.trim()) {
            const lines = pendingLine.split(/\r?\n/);
            for (const line of lines) {
              if (handleDataLine(line)) break streamLoop;
            }
          }
          isStreamingFinished = true;
          break streamLoop;
        }

        const chunk = decoder.decode(value, { stream: true });
        if (!firstTokenTime && (chunk.includes('"content":') || chunk.includes('"delta":'))) {
          firstTokenTime = Date.now();
        }

        pendingLine += chunk;
        const lines = pendingLine.split(/\r?\n/);
        pendingLine = lines.pop() || '';
        for (const line of lines) {
          if (handleDataLine(line)) break streamLoop;
        }
      }

      const endTime = Date.now();
      const durationSec = (endTime - (firstTokenTime || startTime)) / 1000;
      const ttft = firstTokenTime ? firstTokenTime - startTime : 0;
      const tps = durationSec > 0 ? (totalLength / 4) / durationSec : 0;

      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant') {
          return [...prev.slice(0, -1), { 
            ...last, 
            metrics: { 
              ttft, 
              tps: Math.round(tps * 10) / 10, 
              duration: Math.round((endTime - startTime) / 10) / 100 
            } 
          }];
        }
        return prev;
      });
    } catch (err: any) {
      if (err.name === 'AbortError') {
        message.info(t('chat.stopGenerating'));
        if (!displayedContent || displayedContent === thinkingTip) {
          replaceLastAssistant(t('chat.terminated', { defaultValue: '已停止' }));
        }
      } else {
        const errorText = err?.message || t('common.error');
        message.error(errorText);
        replaceLastAssistant(`> ${t('common.error')}: ${errorText}`);
      }
    } finally {
      // 任意出口（含 try 内 return / 抛错）都必须结束，否则 rAF 在「流未标记结束且队列已空」时会空转占满 CPU
      isStreamingFinished = true;
      await queueDrainedPromise;
      setIsTyping(false);
      abortControllerRef.current = null;
    }
  };

  const handleSend = async (textOverride?: string) => {
    const text = textOverride || inputText;
    if ((!text.trim() && attachedFiles.length === 0) || isTyping || !selectedBot || isUploading) return;

    if (!textOverride) setInputText('');
    const currentQuoted = quotedMsg;
    const currentFiles = [...attachedFiles];

    setQuotedMsg(null);
    setAttachedFiles([]);

    let finalContent = text;
    if (currentFiles.length > 0) {
      const fileLinks = currentFiles.map((f) => {
        const isImage = f.ext.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
        if (isImage) {
          return `\n![${f.filename}](${f.thumbUrl || f.url} "${f.url}")\n(File path: ${f.path})`;
        }
        return `\n[${f.filename}](${f.url}) (File path: ${f.path})`;
      }).join('');
      const fileInstruction = `\n\n**System Note for Expert:** The user has uploaded files. For any file analysis, reading, or processing tasks, please access the files directly using the absolute **"File path"** provided above. Do not attempt to download via URL.`;
      finalContent += fileLinks + fileInstruction;
    }

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newUserMessage: Message = {
      role: 'user',
      content: finalContent,
      timestamp,
      quotedMessage: currentQuoted || undefined,
    };
    await runStreamingCompletion([...messages, newUserMessage]);
  };

  const handleEditAndResend = async (userIndex: number, draft: string) => {
    const trimmed = draft.trim();
    if (!trimmed) {
      message.warning(t('chat.emptyMessage'));
      return;
    }
    if (isTyping || !selectedBot) return;
    const orig = messages[userIndex];
    if (!orig || orig.role !== 'user') return;
    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const editedMsg: Message = {
      role: 'user',
      content: trimmed,
      timestamp,
      quotedMessage: orig.quotedMessage,
    };
    setEditingUserMsgIndex(null);
    await runStreamingCompletion([...messages.slice(0, userIndex), editedMsg]);
  };

  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      message.success(t('chat.copySuccess'));
    });
  };

  const handleRegenerate = () => {
    const lastUserIndexFromEnd = [...messages].reverse().findIndex((m) => m.role === 'user');
    if (lastUserIndexFromEnd === -1) return;
    const actualIndex = messages.length - 1 - lastUserIndexFromEnd;
    const truncated = messages.slice(0, actualIndex + 1);
    void runStreamingCompletion(truncated);
  };

  const clearHistory = () => {
    Modal.confirm({
      title: t('chat.confirmClear'),
      content: t('chat.confirmClearContent'),
      okText: t('chat.newSession'),
      cancelText: t('common.cancel'),
      centered: true,
      onOk: () => {
        setMessages([]);
        storage.removeItem(historyStorageKey);
        storage.removeItem(LEGACY_CHAT_HISTORY_KEY);
        const safeU = sanitizeClassicSessionUsername(usernameForSessionId);
        const newSessionId = safeU
          ? `s-${Date.now()}-${safeU}`
          : `s-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        storage.setItem(CLASSIC_SESSION_ID_KEY, newSessionId);
        setGeneratedSessionId(newSessionId);
        message.success(t('chat.historyCleared'));
      }
    });
  };

  const botList = botsModels?.data?.bots || [];

  const embedPreviewUrl = useMemo(() => {
    const token = storage.getItem('guardian_token');
    const botId =
      embedOptions.botId ||
      selectedBot.replace('openclaw:', '') ||
      (botList[0] as { id?: string } | undefined)?.id ||
      'main';
    return buildChatEmbedPageUrl({
      token,
      botId,
      layout: embedOptions.layout,
      defaultTab: embedOptions.defaultTab,
    });
  }, [embedOptions, selectedBot, botList]);

  const embedIframeCode = useMemo(
    () => `<iframe src="${embedPreviewUrl}" width="100%" height="600" frameborder="0"></iframe>`,
    [embedPreviewUrl]
  );

  if (checkingEnabled) {
    return (
        <div style={{ padding: 40, textAlign: 'center' }}>
            <Spin tip={t('chat.checkStatus')} />
        </div>
    );
  }

  if (chatEnabled === false) {
    return (
      <div style={{ height: 'calc(100vh - 120px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Card style={{ width: 450, borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.05)', textAlign: 'center', background: c.card, borderColor: c.border }} styles={{ body: { padding: '40px 32px' } }}>
          <div style={{ background: '#fff7ed', width: 64, height: 64, borderRadius: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', color: '#f97316' }}>
            <Zap size={32} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: c.heading, marginBottom: 12 }}>{t('chat.notEnabled')}</h2>
          <p style={{ color: c.body, fontSize: 14, lineHeight: 1.6, marginBottom: 32 }}>
            {t('chat.notEnabledDesc')}
          </p>
          <Button 
            type="primary" 
            size="large" 
            icon={<Settings size={18} />} 
            style={{ borderRadius: 10, height: 48, padding: '0 24px', background: '#2563eb' }}
            onClick={handleEnableChat}
            loading={enabling}
          >
            {t('chat.oneClickEnable')}
          </Button>
          <div style={{ marginTop: 16, fontSize: 12, color: c.subtle }}>
            {t('chat.enableWarning')}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div
      ref={rootRef}
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        /* 与顶部 Card 紧贴，避免非嵌入模式下 flex gap 露出 pageBg 形成「缝隙」 */
        gap: 0,
        background: c.pageBg,
        width: '100%',
        height: '100%',
        minHeight: 0,
        minWidth: 0,
        position: 'relative',
        overflow: 'hidden',
        ...(isFullscreen
          ? {
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              zIndex: 500,
              background: c.pageBg,
            }
          : {}),
      }}
    >
      {markdownStyles}
      {/* Top Bar */}
      <Card 
        styles={{ body: { padding: isMobile ? '8px 12px' : '12px 20px' } }} 
        style={{ 
          borderRadius: isEmbedMode ? 0 : '12px 12px 0 0',
          boxShadow: isEmbedMode ? 'none' : c.cardShadow,
          border: isEmbedMode ? 'none' : `1px solid ${c.border}`,
          borderBottom: `1px solid ${c.hairline}`,
          background: c.card
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'nowrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12 }}>
            <div style={{ padding: isMobile ? 6 : 8, background: isDarkMode ? 'rgba(37, 99, 235, 0.22)' : '#eff6ff', borderRadius: 10, color: isDarkMode ? '#93c5fd' : '#2563eb', flexShrink: 0, border: isDarkMode ? '1px solid #334155' : undefined }}>
                <MessageSquare size={isMobile ? 18 : 20} />
            </div>
            {!isMobile && (
              <div>
                <div style={{ fontWeight: 700, color: c.heading, fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  {t('chat.welcomeTitle')}
                  {urlUser && (
                    <span style={{ 
                      fontSize: 10, 
                      fontWeight: 600, 
                      background: '#dcfce7', 
                      color: '#166534', 
                      padding: '2px 8px', 
                      borderRadius: 10,
                      border: '1px solid #bbf7d0'
                    }}>
                      {t('chat.userLabel')}: {urlUser}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: c.body }}>{t('chat.labDescription')}</div>
              </div>
            )}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, flex: isMobile ? 1 : 'none', justifyContent: 'flex-end', minWidth: 0 }}>
            {!isMobile && (
              <span style={{ color: c.body, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>
                {isEmbedMode
                  ? t('chat.currentBotLabel', { defaultValue: '当前机器人' })
                  : t('chat.selectBotTip')}
                :
              </span>
            )}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                padding: '0 10px',
                height: 40,
                borderRadius: 10,
                background: isDarkMode ? '#0f172a' : '#f8fafc',
                border: `1px solid ${c.hairline}`,
                flex: isMobile ? 1 : 'none',
                minWidth: isMobile ? 120 : 0,
                boxSizing: 'border-box',
              }}
            >
              <Select
                placeholder={t('chat.selectBotTip')}
                style={{ width: isMobile ? 'auto' : 240, flex: 1, minWidth: 0, height: 38 }}
                value={selectedBot}
                onChange={setSelectedBot}
                loading={loadingBots}
                disabled={isEmbedMode || isTyping}
                variant="borderless"
                dropdownStyle={{ borderRadius: 8, minWidth: 280 }}
                listHeight={400}
              >
                {botList.map((bot: any) => {
                  const supportsImage = !!(bot.capabilities?.includes?.('image') || bot.input?.includes?.('image'));
                  return (
                    <Option key={bot.id} value={`openclaw:${bot.id}`}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                        <ProviderIcon provider={bot.provider || (bot.id === 'main' ? 'openai' : '')} size={20} />
                        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2', minWidth: 0, flex: 1 }}>
                          <span style={{ fontWeight: 600, color: c.heading, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {bot.name || bot.id}
                          </span>
                          <span style={{ fontSize: 10, color: c.subtle, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {bot.model || t('common.loading')}
                          </span>
                        </div>
                        {supportsImage && (
                          <div style={{ display: 'flex', alignItems: 'center', color: '#0ea5e9', flexShrink: 0 }}>
                            <Image size={12} />
                          </div>
                        )}
                      </div>
                    </Option>
                  );
                })}
              </Select>
            </div>
            {!isEmbedMode && (
              <Button icon={<RefreshCw size={14} />} onClick={onRefreshBots} loading={loadingBots} title={t('common.refresh')} />
            )}
            {!isMobile && !isEmbedMode && (
              <Button
                icon={<ExternalLink size={14} />}
                title={t('chat.labDescription')}
                onClick={() => {
                  const token = storage.getItem('guardian_token');
                  const botId = selectedBot.replace('openclaw:', '');
                  const url = buildChatEmbedPageUrl({
                    token,
                    botId,
                    layout: 'tabs',
                    defaultTab: 'v3',
                  });
                  window.open(url, '_blank');
                }}
              />
            )}
            {!isMobile && !isEmbedMode && (
              <Button
                icon={<Share2 size={14} />}
                title={t('chat.shareTitle')}
                onClick={() => {
                  const id = selectedBot.replace('openclaw:', '') || botList[0]?.id || '';
                  setEmbedOptions({
                    botId: id,
                    layout: 'tabs',
                    defaultTab: 'v3',
                  });
                  setEmbedShareOpen(true);
                }}
              />
            )}
            {!isEmbedMode && (
              <Button
                icon={isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                title={isFullscreen ? t('common.minimize', { defaultValue: '退出全屏' }) : t('common.maximize', { defaultValue: '全屏' })}
                onClick={toggleFullscreen}
              />
            )}
            <Button icon={<Plus size={14} />} onClick={clearHistory} disabled={messages.length === 0}>{isMobile ? '' : t('chat.newSession')}</Button>
          </div>
        </div>
      </Card>

      {/* Chat Area */}
      <div style={{ 
        flex: 1, 
        background: c.card, 
        borderRadius: isEmbedMode ? 0 : '0 0 12px 12px',
        border: isEmbedMode ? 'none' : `1px solid ${c.border}`,
        borderTop: 'none',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative'
      }}>
        {!selectedBot && (
          <div style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: c.overlay,
            backdropFilter: 'blur(3px)',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 12,
            animation: 'fade-in 0.3s ease'
          }}>
            <div style={{ padding: '24px 32px', background: c.pickCard, borderRadius: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.1)', border: `1px solid ${c.pickCardBorder}`, textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>☝️</div>
              <div style={{ fontWeight: 700, color: c.heading, fontSize: 16 }}>{t('chat.selectBot')}</div>
              <div style={{ fontSize: 13, color: c.subtle, marginTop: 4 }}>{t('chat.labDescription')}</div>
            </div>
          </div>
        )}
        <div 
          ref={scrollRef}
          style={{ 
            flex: 1, 
            overflowY: 'auto', 
            padding: isMobile ? '12px 10px' : '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: isMobile ? 12 : 20,
            background: c.scrollBg
          }}
        >
          {messages.length === 0 ? (
            <div style={{ margin: 'auto', width: '100%', maxWidth: 680, padding: isMobile ? '12px 4px 24px' : '28px 8px 48px' }}>
              <div
                style={{
                  textAlign: 'center',
                  padding: isMobile ? '22px 18px 26px' : '32px 36px 38px',
                  borderRadius: isMobile ? 18 : 22,
                  background: c.welcomeHeroBg,
                  border: 'none',
                  outline: 'none',
                  boxShadow: c.welcomeHeroShadow,
                }}
              >
                <h2
                  style={{
                    color: c.heading,
                    fontWeight: 800,
                    fontSize: isMobile ? 21 : 28,
                    letterSpacing: '-0.03em',
                    lineHeight: 1.25,
                    margin: '0 0 12px',
                  }}
                >
                  {t('chat.welcomeTitle')}
                </h2>
                <div
                  style={{
                    width: 52,
                    height: 4,
                    margin: '0 auto 18px',
                    borderRadius: 4,
                    background: `linear-gradient(90deg, ${c.welcomeAccent}, ${isDarkMode ? '#818cf8' : '#6366f1'})`,
                    opacity: isDarkMode ? 0.95 : 1,
                  }}
                />
                <p
                  style={{
                    color: c.body,
                    fontSize: isMobile ? 13 : 15,
                    lineHeight: 1.65,
                    margin: '0 auto 28px',
                    maxWidth: 460,
                  }}
                >
                  {t('chat.welcomeSubtitle')}
                </p>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: isMobile ? 10 : 14,
                    textAlign: 'left',
                  }}
                >
                  {[
                    ...quickCommands.map(q => ({ icon: '', title: q.label || t('chat.quickCommand'), text: q.prompt })),
                    { icon: '💡', title: t('login.features.monit'), text: t('chat.guidePrompt') },
                    { icon: '🚀', title: t('common.restart'), text: t('chat.latencyPrompt') },
                    { icon: '🛡️', title: t('common.dashboard'), text: t('chat.guardianPrompt') },
                    { icon: '🔧', title: t('common.assets'), text: t('chat.codePrompt') }
                  ].filter((v, i, a) => a.findIndex(t => t.text === v.text) === i).slice(0, 8).map((item, i) => (
                    <div
                      key={i}
                      className="stagger-entry chat-classic-welcome-card"
                      onClick={() => {
                        if (!selectedBot || isTyping) {
                          if (!selectedBot) message.warning(t('chat.selectBot'));
                          return;
                        }
                        handleSend(item.text);
                      }}
                      style={{
                        padding: isMobile ? '12px 12px' : '14px 16px',
                        background: c.pickCard,
                        borderRadius: 16,
                        border: `1px solid ${c.hairline}`,
                        cursor: isTyping ? 'not-allowed' : 'pointer',
                        minWidth: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                        boxShadow: c.welcomeCardShadow,
                        opacity: isTyping ? 0.6 : 1,
                        '--delay': `${i * 0.05}s`,
                      } as React.CSSProperties}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: isMobile ? 8 : 10, minWidth: 0 }}>
                        {item.icon ? (
                          <span
                            style={{
                              width: isMobile ? 36 : 40,
                              height: isMobile ? 36 : 40,
                              borderRadius: 12,
                              flexShrink: 0,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: isMobile ? 17 : 19,
                              lineHeight: 1,
                              background: c.welcomeIconBg,
                              border: `1px solid ${c.welcomeIconBorder}`,
                            }}
                          >
                            {item.icon}
                          </span>
                        ) : null}
                        <span
                          style={{
                            fontSize: isMobile ? 12 : 13,
                            fontWeight: 700,
                            color: c.heading,
                            minWidth: 0,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            lineHeight: 1.35,
                            paddingTop: item.icon ? 2 : 0,
                          }}
                        >
                          {item.title}
                        </span>
                      </div>
                      <span
                        style={{
                          fontSize: isMobile ? 11 : 12,
                          color: c.body,
                          lineHeight: 1.45,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          paddingLeft: item.icon ? (isMobile ? 44 : 50) : 0,
                        }}
                      >
                        {item.text}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg, index) => (
              <div 
                key={index} 
                id={`msg-${index}`}
                data-msg-content={msg.content}
                className="stagger-entry"
                style={{ 
                  display: 'flex', 
                  gap: isMobile ? 8 : 12,
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  alignItems: 'flex-start'
                }}
              >
                <Avatar 
                  size={isMobile ? 32 : 36} 
                  style={{ 
                    background: msg.role === 'user' ? '#4f46e5' : c.assistantBg,
                    border: msg.role === 'assistant' ? `1px solid ${c.assistantBorder}` : 'none',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                    flexShrink: 0
                  }}
                  icon={msg.role === 'user' ? <User size={18} /> : <Bot size={18} color="#4f46e5" />}
                />
                <div style={{ 
                  maxWidth: isMobile ? '92%' : '85%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  gap: 4
                }}>
                  <div style={{ 
                    padding: '12px 16px',
                    borderRadius: 16,
                    borderTopRightRadius: msg.role === 'user' ? 4 : 16,
                    borderTopLeftRadius: msg.role === 'assistant' ? 4 : 16,
                    background: msg.role === 'user' ? '#4f46e5' : c.assistantBg,
                    color: msg.role === 'user' ? '#fff' : c.assistantText,
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                    fontSize: 14,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                    position: 'relative'
                  }}>
                    {msg.quotedMessage && (
                      <div 
                        onClick={() => handleScrollToMessage(msg.quotedMessage!)}
                        style={{ 
                          fontSize: 12, 
                          background: 'rgba(0,0,0,0.05)', 
                          padding: '6px 10px', 
                          borderRadius: 8, 
                          marginBottom: 8,
                          borderLeft: `3px solid ${msg.role === 'user' ? '#fff' : '#2563eb'}`,
                          color: msg.role === 'user' ? 'rgba(255,255,255,0.8)' : c.body,
                          maxWidth: '100%',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          cursor: 'pointer'
                        }}
                      >
                        <Quote size={10} style={{ marginRight: 4, opacity: 0.6 }} />
                        {msg.quotedMessage}
                      </div>
                    )}
                    {msg.role === 'assistant' ? (
                      <div className="markdown-body" style={{ whiteSpace: 'normal' }}>
                        {msg.content === t('chat.thinking') ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span>{msg.content}</span>
                            <div className="typing-indicator" style={{ marginTop: 4 }}>
                              <div className="typing-dot" style={{ background: '#2563eb' }}></div>
                              <div className="typing-dot" style={{ background: '#2563eb' }}></div>
                              <div className="typing-dot" style={{ background: '#2563eb' }}></div>
                            </div>
                          </div>
                        ) : (
                          <ReactMarkdown 
                            remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
                            rehypePlugins={[rehypeSanitize, rehypeKatex]}
                            components={{
                              table: ({ node, ...props }: any) => (
                                <div style={{ 
                                  width: '100%', 
                                  overflowX: 'auto', 
                                  marginBottom: 12, 
                                  borderRadius: 8,
                                  border: `1px solid ${c.border}`,
                                  background: c.card,
                                  WebkitOverflowScrolling: 'touch'
                                }}>
                                  <table {...props} style={{ 
                                    width: '100%', 
                                    borderCollapse: 'collapse',
                                    fontSize: isMobile ? '12px' : '13px',
                                    minWidth: '100%'
                                  }} />
                                </div>
                              ),
                              th: ({ node, ...props }: any) => (
                                <th {...props} style={{ 
                                  padding: '8px 12px', 
                                  background: c.mdThBg, 
                                  borderBottom: `1px solid ${c.border}`, 
                                  borderRight: `1px solid ${c.border}`,
                                  textAlign: 'left',
                                  fontWeight: 600,
                                  color: isDarkMode ? '#e2e8f0' : undefined
                                }} />
                              ),
                              td: ({ node, ...props }: any) => (
                                <td {...props} style={{ 
                                  padding: '8px 12px', 
                                  borderBottom: `1px solid ${c.border}`, 
                                  borderRight: `1px solid ${c.border}`,
                                  color: isDarkMode ? '#cbd5e1' : undefined
                                }} />
                              ),
                                code: ({ node, inline, className, children, ...props }: any) => {
                                  const match = /language-(\w+)/.exec(className || '');
                                  const language = match ? match[1] : '';
                                  const codeContent = String(children).replace(/\n$/, '');
                                  
                                  if (!inline && language === 'mermaid') {
                                    return <Mermaid chart={codeContent} />;
                                  }

                                  if (!inline && isEchartsCodeFenceLanguage(language)) {
                                    const isLastMessage = index === messages.length - 1;
                                    return <ECharts optionStr={codeContent} isTyping={isLastMessage && isTyping} />;
                                  }

                                  if (!inline && language) {
                                    return <CodeBlock language={language} value={codeContent} isMobile={isMobile} {...props} />;
                                  }                                
                                return (
                                  <code className={className} {...props} style={{
                                    padding: '0.2em 0.4em',
                                    backgroundColor: 'rgba(175, 184, 193, 0.2)',
                                    borderRadius: '6px',
                                    fontSize: '85%',
                                    wordBreak: 'break-all',
                                    whiteSpace: 'pre-wrap'
                                  }}>
                                    {children}
                                  </code>
                                );
                              },
                              img: ({ node, ...props }: any) => (
                                <img 
                                  {...props} 
                                  style={{ maxWidth: '100%', borderRadius: 8, marginTop: 8, cursor: 'zoom-in', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} 
                                  onClick={() => window.open(props.title || props.src, '_blank')}
                                />
                              )
                            }}
                          >
                            {preprocessMarkdown(msg.content)}
                          </ReactMarkdown>
                        )}
                      </div>
                    ) : editingUserMsgIndex === index ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', minWidth: isMobile ? 200 : 260 }}>
                        <Input.TextArea
                          value={editUserDraft}
                          onChange={(e) => setEditUserDraft(e.target.value)}
                          autoSize={{ minRows: 2, maxRows: 14 }}
                          style={{ fontSize: 14 }}
                        />
                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          <Button size="small" onClick={() => setEditingUserMsgIndex(null)}>
                            {t('chat.cancelEdit')}
                          </Button>
                          <Button
                            type="primary"
                            size="small"
                            onClick={() => void handleEditAndResend(index, editUserDraft)}
                          >
                            {t('chat.saveAndResend')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 2, alignItems: 'center' }}>
                    {editingUserMsgIndex !== index && (
                      <>
                        <Tooltip title={t('chat.reply')}>
                          <Button
                            type="text"
                            size="small"
                            icon={<Quote size={12} />}
                            style={{ color: c.subtle, height: 22, fontSize: 11, padding: '0 4px' }}
                            onClick={() => {
                              setQuotedMsg(msg.content);
                              inputRef.current?.focus();
                            }}
                          >
                            {t('chat.reply')}
                          </Button>
                        </Tooltip>
                        <Button
                          type="text"
                          size="small"
                          icon={<Copy size={12} />}
                          style={{ color: c.subtle, height: 22, fontSize: 11, padding: '0 4px' }}
                          onClick={() => copyToClipboard(msg.content)}
                        >
                          {t('chat.copy')}
                        </Button>
                        {msg.role === 'user' && !isTyping && (
                          <Tooltip title={t('chat.editResend')}>
                            <Button
                              type="text"
                              size="small"
                              icon={<Pencil size={12} />}
                              style={{ color: c.subtle, height: 22, fontSize: 11, padding: '0 4px' }}
                              onClick={() => {
                                setEditingUserMsgIndex(index);
                                setEditUserDraft(msg.content);
                              }}
                            >
                              {isMobile ? '' : t('chat.editResend')}
                            </Button>
                          </Tooltip>
                        )}
                      </>
                    )}
                    {msg.role === 'assistant' && index === messages.length - 1 && !isTyping && (
                      <Button 
                        type="text" 
                        size="small" 
                        icon={<RotateCcw size={12} />} 
                        style={{ color: c.subtle, height: 22, fontSize: 11, padding: '0 4px' }} 
                        onClick={handleRegenerate}
                      >{t('chat.retry')}</Button>
                    )}
                    {!isMobile && msg.metrics && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10, color: c.subtle, opacity: 0.6 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Zap size={10} color="#f59e0b" fill="#f59e0b" />
                          <span>TTFT: {msg.metrics.ttft}ms</span>
                        </div>
                        <div style={{ width: 3, height: 3, borderRadius: '50%', background: c.dot }}></div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Activity size={10} color="#10b981" />
                          <span>Speed: {msg.metrics.tps} tps</span>
                        </div>
                        <div style={{ width: 3, height: 3, borderRadius: '50%', background: c.dot }}></div>
                        <span>Time: {msg.metrics.duration}s</span>
                      </div>
                    )}
                    <span style={{ fontSize: 10, color: c.subtle, opacity: 0.8, marginLeft: 4 }}>
                      {msg.timestamp}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
          {isTyping && messages[messages.length - 1]?.role !== 'assistant' && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, animation: 'fade-in 0.3s ease' }}>
                <Avatar size={isMobile ? 32 : 36} style={{ background: c.assistantBg, border: `1px solid ${c.assistantBorder}`, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }} icon={<Bot size={18} color="#2563eb" />} />
                <div style={{ padding: '12px 16px', background: c.assistantBg, borderRadius: '4px 16px 16px 16px', border: `1px solid ${c.assistantBorder}`, boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 12, color: c.body, fontWeight: 500 }}>{t('chat.thinking')}</span>
                    <div className="typing-indicator">
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                    </div>
                </div>
            </div>
          )}
        </div>

        {/* Scroll to Top Button */}
        {showScrollTopBtn && (
          <Button
            type="default"
            shape="circle"
            icon={<ChevronUp size={20} />}
            onClick={scrollToTop}
            style={{
              position: 'absolute',
              top: 80,
              right: 24,
              zIndex: 100,
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.1)',
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: c.inputFoot,
              color: c.body,
              border: `1px solid ${c.border}`
            }}
          />
        )}

        {/* Scroll to Bottom Button */}
        {showScrollButton && (
          <Button
            type="primary"
            shape="circle"
            icon={<ArrowDown size={20} />}
            onClick={scrollToBottom}
            style={{
              position: 'absolute',
              bottom: 120,
              right: 24,
              zIndex: 100,
              boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
              width: 44,
              height: 44,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 'none',
              background: '#2563eb'
            }}
          />
        )}

        {/* Input Area */}
        <div style={{ padding: isMobile ? '12px' : '16px 24px', background: c.inputFoot, borderTop: showQuickActions ? `1px solid ${c.hairline}` : 'none', position: 'relative' }}>
          {/* Quote Preview */}
          {quotedMsg && (
            <div style={{ 
              background: c.quoteBar, 
              padding: '8px 12px', 
              borderLeft: '4px solid #2563eb', 
              marginBottom: 8, 
              borderRadius: '0 8px 8px 0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              animation: 'slide-up 0.2s ease'
            }}>
              <div style={{ fontSize: 12, color: c.body, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                <span style={{ fontWeight: 700, marginRight: 6 }}>{t('chat.reply')}:</span>
                {quotedMsg}
              </div>
              <Button type="text" size="small" icon={<X size={14} />} onClick={() => setQuotedMsg(null)} />
            </div>
          )}

          {/* Quick Actions */}
          <div style={{ display: 'flex', gap: 8, marginBottom: showQuickActions ? 12 : 8, alignItems: 'center', transition: 'all 0.3s ease' }}>
            {showQuickActions ? (
              <>
                <div style={{ display: 'flex', gap: 8, overflowX: 'auto', flex: 1, paddingBottom: 4, scrollbarWidth: 'none' }}>
                  {quickCommands.map(item => (
                    <Button 
                      key={item.id}
                      size="small"
                      style={{ borderRadius: 16, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, background: c.cmdRowBg, color: c.body, borderColor: c.border, flexShrink: 0, opacity: isTyping ? 0.6 : 1 }}
                      onClick={() => handleSend(item.prompt)}
                      disabled={isTyping}
                    >
                      {item.label}
                    </Button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Button 
                    type="text" 
                    size="small" 
                    icon={<Settings size={14} />} 
                    style={{ color: c.subtle, background: c.ghostBtnBg, borderRadius: 12, height: 24, width: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => setIsManageModalOpen(true)}
                    title={t('chat.manageQuickCommands')}
                  />
                  <Button 
                    type="text" 
                    size="small" 
                    icon={<ChevronUp size={16} />} 
                    style={{ color: c.subtle, background: c.ghostBtnBg, borderRadius: 12, height: 24, width: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    onClick={() => {
                        setShowQuickActions(false);
                        storage.setItem('chat_show_quick_actions', 'false');
                    }}
                    title={t('chat.collapseQuickCommands')}
                  />
                </div>
              </>
            ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                    <div style={{ height: 1, flex: 1, background: c.hairline }}></div>
                    <Button 
                        type="text" 
                        size="small" 
                        icon={<ChevronDown size={14} style={{ marginRight: 4 }} />}
                        onClick={() => {
                            setShowQuickActions(true);
                            storage.setItem('chat_show_quick_actions', 'true');
                        }}
                        style={{ fontSize: 11, color: c.subtle, height: 20, padding: '0 8px', borderRadius: 10, background: c.cmdRowBg, display: 'flex', alignItems: 'center' }}
                    >
                        {t('chat.expandQuickCommands')}
                    </Button>
                    <div style={{ height: 1, flex: 1, background: c.hairline }}></div>
                </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: isMobile ? 8 : 12, alignItems: 'flex-end' }}>
            <div style={{ flexShrink: 0, marginBottom: 2 }}>
              <Upload
                name="file"
                action={getFullUrl('/v1/openclaw/chat/upload')}
                data={{ botId: selectedBot.replace('openclaw:', '') }}
                headers={{
                  Authorization: `Bearer ${storage.getItem('guardian_token')}`
                }}
                showUploadList={false}
                disabled={isUploading || isTyping || !selectedBot}
                onChange={(info) => {
                  if (info.file.status === 'uploading') {
                    setIsUploading(true);
                  }
                  if (info.file.status === 'done') {
                    setIsUploading(false);
                    const res = info.file.response;
                    if (res && res.code === 200) {
                      setAttachedFiles(prev => [...prev, res.data]);
                    } else {
                      message.error(res?.message || 'Upload failed');
                    }
                  } else if (info.file.status === 'error') {
                    setIsUploading(false);
                    message.error(`${info.file.name} upload failed.`);
                  }
                }}
              >
                  <Button 
                    type="text" 
                    icon={<Paperclip size={20} />} 
                    disabled={isUploading || isTyping || !selectedBot}
                    style={{ 
                      color: (isUploading || isTyping || !selectedBot) ? c.dot : c.subtle, 
                      borderRadius: 10, 
                      height: 40, width: 40, 
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      opacity: (isUploading || isTyping || !selectedBot) ? 0.5 : 1
                    }} 
                  />
              </Upload>
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {/* 文件预览区域 */}
              {(attachedFiles.length > 0 || isUploading) && (
                <div style={{ 
                  display: 'flex', 
                  flexWrap: 'wrap', 
                  gap: 8, 
                  padding: '8px 0', 
                  maxHeight: 120,
                  overflowY: 'auto'
                }}>
                  {attachedFiles.map((file, idx) => (
                    <div key={idx} style={{ 
                      position: 'relative', 
                      width: 56, 
                      height: 56, 
                      borderRadius: 8, 
                      border: `1px solid ${c.border}`,
                      background: c.uploadBg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.02)'
                    }}>
                      {file.ext.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i) ? (
                        <img src={file.thumbUrl || file.url} alt={file.filename} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          <FileText size={18} color={c.body} />
                          <span style={{ fontSize: 8, color: c.subtle, maxWidth: 48, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {file.filename}
                          </span>
                        </div>
                      )}
                      <button 
                        onClick={() => setAttachedFiles(prev => prev.filter((_, i) => i !== idx))}
                        style={{ 
                          position: 'absolute', top: 2, right: 2, 
                          background: 'rgba(0,0,0,0.4)', color: '#fff', 
                          border: 'none', borderRadius: '50%', 
                          width: 14, height: 14, cursor: 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          padding: 0
                        }}
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ))}
                  {isUploading && (
                    <div style={{ 
                      width: 56, 
                      height: 56, 
                      borderRadius: 8, 
                      border: '1px dashed #3b82f6',
                      background: c.uploadDashed,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}>
                      <Loader2 size={18} className="animate-spin" color="#3b82f6" />
                    </div>
                  )}
                </div>
              )}

              <Input.TextArea 
                ref={inputRef}
                placeholder={selectedBot ? t('chat.inputPlaceholder') : t('chat.selectBotTip')}
                autoSize={{ minRows: 1, maxRows: 4 }}
                value={inputText}
                onChange={e => setInputText(e.target.value)}
                onCompositionStart={() => setIsComposing(true)}
                onCompositionEnd={() => setIsComposing(false)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                style={{ borderRadius: 12, padding: isMobile ? '8px 12px' : '10px 16px', fontSize: isMobile ? 15 : 14, background: isDarkMode ? '#0f172a' : undefined, color: isDarkMode ? '#e2e8f0' : undefined, borderColor: isDarkMode ? '#334155' : undefined }}
                disabled={!selectedBot || isTyping}
              />
            </div>

            {isTyping ? (
              <Button 
                danger 
                icon={<StopCircle size={18} />} 
                style={{ borderRadius: 12, height: 40, width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                onClick={handleStopGeneration}
                title={t('chat.stopGenerating')}
              />
            ) : (
              <Button 
                type="primary" 
                icon={<Send size={18} />} 
                style={{ borderRadius: 12, height: 40, width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                onClick={() => handleSend()}
                disabled={!selectedBot || isUploading || (!inputText.trim() && attachedFiles.length === 0)}
              />
            )}
          </div>
          {!isMobile && (
            <div style={{ marginTop: 8, fontSize: 11, color: c.subtle, display: 'flex', gap: 16 }}>
              <span>{t('chat.streamingInfo')}</span>
              <span>🤖 User: {urlUser || (generatedSessionId ? `lobster-${generatedSessionId}` : t('chat.anonymous'))}</span>
              <span>{t('chat.persistenceInfo')}</span>
            </div>
          )}
        </div>
      {/* Manage Quick Commands Modal */}
      <Modal
        title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ListRestart size={20} color="#2563eb" />
                <span>{t('chat.manageQuickCommands')}</span>
            </div>
        }
        open={isManageModalOpen}
        onCancel={() => setIsManageModalOpen(false)}
        footer={null}
        width={isMobile ? 500 : 560}
        bodyStyle={{ paddingTop: 16 }}
      >
        <div style={{ marginBottom: 24 }}>
            <div
              role="button"
              tabIndex={0}
              aria-expanded={manageModalCurrentCommandsOpen}
              onClick={() => setManageModalCurrentCommandsOpen((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setManageModalCurrentCommandsOpen((v) => !v);
                }
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                cursor: 'pointer',
                userSelect: 'none',
                marginBottom: manageModalCurrentCommandsOpen ? 12 : 0,
              }}
            >
              <h4 style={{ fontSize: 13, color: c.body, margin: 0, flexShrink: 0 }}>{t('chat.currentCommands')}</h4>
              {!manageModalCurrentCommandsOpen && (
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontSize: 12,
                    color: c.subtle,
                    textAlign: 'right',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t('chat.currentCommandsCollapsedHint', { count: quickCommands.length })}
                </span>
              )}
              {manageModalCurrentCommandsOpen ? (
                <ChevronUp size={18} color={c.subtle} aria-hidden style={{ flexShrink: 0 }} />
              ) : (
                <ChevronDown size={18} color={c.subtle} aria-hidden style={{ flexShrink: 0 }} />
              )}
            </div>
            {manageModalCurrentCommandsOpen && (
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
                {quickCommands.map(cmd => (
                    <div
                      key={cmd.id}
                      style={{
                        position: 'relative',
                        overflow: 'hidden',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 8,
                        padding: '10px 12px',
                        paddingTop: cmd.is_system ? 14 : 10,
                        paddingRight: cmd.is_system ? 36 : 12,
                        background: c.cmdRowBg,
                        borderRadius: 8,
                        border: `1px solid ${c.cmdRowBorder}`,
                        minWidth: 0,
                      }}
                    >
                      {cmd.is_system && (
                        <div
                          title={t('chat.systemQuickCommandTip')}
                          style={{
                            position: 'absolute',
                            top: 14,
                            right: -42,
                            width: 132,
                            padding: '6px 0',
                            fontSize: 10,
                            fontWeight: 800,
                            letterSpacing: '0.22em',
                            color: isDarkMode ? '#1e293b' : '#64748b',
                            textAlign: 'center',
                            background: isDarkMode
                              ? 'linear-gradient(135deg, #cbd5e1 0%, #e2e8f0 48%, #cbd5e1 100%)'
                              : 'linear-gradient(135deg, #eef2f7 0%, #f8fafc 50%, #eef2f7 100%)',
                            transform: 'rotate(45deg)',
                            transformOrigin: 'center',
                            boxShadow: isDarkMode ? '0 1px 6px rgba(0,0,0,0.22)' : '0 1px 6px rgba(15,23,42,0.08)',
                            userSelect: 'none',
                            zIndex: 2,
                            pointerEvents: 'auto',
                          }}
                        >
                          {t('chat.systemQuickCommandBadge')}
                        </div>
                      )}
                      <div style={{ minWidth: 0, flex: 1, paddingRight: cmd.is_system ? 8 : 0 }}>
                        <div style={{ fontWeight: 600, color: c.heading, fontSize: 14 }}>{cmd.label}</div>
                        <div style={{ fontSize: 12, color: c.subtle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd.prompt}</div>
                      </div>
                      {!cmd.is_system && (
                        <Button
                          type="text"
                          danger
                          icon={<Trash2 size={14} />}
                          size="small"
                          style={{ flexShrink: 0 }}
                          onClick={() => handleDeleteQuickCommand(cmd.id)}
                        />
                      )}
                    </div>
                ))}
              </div>
            )}
        </div>

        <div style={{ borderTop: `1px solid ${c.hairline}`, paddingTop: 24 }}>
            <h4 style={{ fontSize: 13, color: c.body, marginBottom: 12 }}>{t('chat.addCommand')}</h4>
            <Form form={form} layout="vertical" onFinish={handleAddQuickCommand}>
                <Form.Item name="label" label={t('chat.commandLabel')} rules={[{ required: true, message: t('chat.labelRequired') }]}>
                    <Input placeholder={t('chat.commandLabelPlaceholder')} style={{ borderRadius: 8 }} />
                </Form.Item>
                <Form.Item name="prompt" label={t('chat.commandPrompt')} rules={[{ required: true, message: t('chat.promptRequired') }]}>
                    <Input.TextArea placeholder={t('chat.commandPromptPlaceholder')} autoSize={{ minRows: 2 }} style={{ borderRadius: 8 }} />
                </Form.Item>
                <Button type="primary" htmlType="submit" icon={<Plus size={16} />} block style={{ borderRadius: 8, height: 40 }}>{t('chat.addCommandBtn')}</Button>
            </Form>
        </div>
      </Modal>

      <Modal
        open={embedShareOpen}
        onCancel={() => setEmbedShareOpen(false)}
        title={t('chat.shareTitle')}
        width={520}
        footer={null}
        destroyOnClose
        styles={{ body: { paddingTop: 12 } }}
      >
        <p style={{ fontSize: 13, color: c.body, marginBottom: 16 }}>{t('chat.shareDesc')}</p>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: c.subtle, marginBottom: 6 }}>{t('chat.embedBotLabel')}</div>
          <Select
            style={{ width: '100%' }}
            value={embedOptions.botId || undefined}
            placeholder={t('chat.selectBotTip')}
            onChange={(v) => setEmbedOptions((o) => ({ ...o, botId: v }))}
            options={botList.map((b: { id: string; name?: string }) => ({
              label: b.name || b.id,
              value: b.id,
            }))}
          />
        </div>
        <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 12, color: c.subtle, marginBottom: 6 }}>{t('chat.embedLayoutLabel')}</div>
          <Radio.Group
            value={embedOptions.layout}
            onChange={(e) =>
              setEmbedOptions((o) => ({ ...o, layout: e.target.value as ChatEmbedLayout }))
            }
          >
            <Space direction="vertical" size={4}>
              <Radio value="tabs">{t('chat.embedLayoutTabs')}</Radio>
              <Radio value="v3">{t('chat.embedLayoutV3')}</Radio>
              <Radio value="classic">{t('chat.embedLayoutClassic')}</Radio>
            </Space>
          </Radio.Group>
        </div>
        {embedOptions.layout === 'tabs' && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, color: c.subtle, marginBottom: 6 }}>{t('chat.embedDefaultTabLabel')}</div>
            <Radio.Group
              value={embedOptions.defaultTab}
              onChange={(e) =>
                setEmbedOptions((o) => ({
                  ...o,
                  defaultTab: e.target.value as 'v3' | 'classic',
                }))
              }
            >
              <Space wrap>
                <Radio value="v3">{t('chat.v3Mode', { defaultValue: 'V3 模式 (RPC)' })}</Radio>
                <Radio value="classic">{t('chat.classicMode', { defaultValue: '经典模式 (HTTP)' })}</Radio>
              </Space>
            </Radio.Group>
          </div>
        )}
        <Input.TextArea
          readOnly
          value={embedIframeCode}
          autoSize={{ minRows: 3, maxRows: 8 }}
          style={{
            fontFamily: 'monospace',
            fontSize: 12,
            background: c.shareTa,
            color: isDarkMode ? '#e2e8f0' : undefined,
          }}
        />
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button
            type="primary"
            size="small"
            icon={<Copy size={12} />}
            onClick={() => {
              navigator.clipboard.writeText(embedIframeCode);
              message.success(t('chat.copySuccess'));
            }}
          >
            {t('chat.copyIframe')}
          </Button>
          <Button size="small" onClick={() => setEmbedShareOpen(false)}>
            {t('common.close')}
          </Button>
        </div>
      </Modal>

      <style>{`
        .typing-indicator {
          display: flex;
          align-items: center;
          gap: 4px;
          height: 12px;
        }
        .typing-dot {
          width: 5px;
          height: 5px;
          background: #2563eb;
          border-radius: 50%;
          opacity: 0.4;
          animation: typing-bounce 1.4s infinite ease-in-out;
        }
        .typing-dot:nth-child(1) { animation-delay: 0s; }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }
        @keyframes typing-bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: 0.4; }
          40% { transform: translateY(-4px); opacity: 1; }
        }
        @keyframes fade-in {
          from { opacity: 0; transform: translateY(5px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .message-highlight {
          animation: highlight-pulse 2s ease-out;
        }
        @keyframes highlight-pulse {
          0% { transform: scale(1); box-shadow: 0 0 0 0 rgba(37, 99, 235, 0.4); }
          30% { transform: scale(1.02); box-shadow: 0 0 20px 5px rgba(37, 99, 235, 0.2); }
          100% { transform: scale(1); box-shadow: 0 0 0 0 rgba(37, 99, 235, 0); }
        }
      `}</style>
    </div>
  </div>
);
};

export default ChatClassic;
