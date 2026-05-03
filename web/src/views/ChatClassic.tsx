import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Card, Select, Input, Button, Avatar, Spin, message, Modal, Form, Tooltip, Upload } from 'antd';
import { useTranslation } from 'react-i18next';
import { Send, Bot, User, RefreshCw, Trash2, MessageSquare, Zap, Settings, Copy, RotateCcw, StopCircle, ListRestart, Plus, ChevronUp, ChevronDown, Quote, X, ExternalLink, Share2, ArrowDown, ZapOff, Activity, Paperclip, FileText, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import api, { getFullUrl } from '../api';
import { getBaseURL } from '../utils/url';
import storage from '../utils/storage';
import { Mermaid, CodeBlock, ECharts, isEchartsCodeFenceLanguage } from '../components/ChatComponents';


const { Option } = Select;

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
}

const ChatClassic: React.FC<ChatClassicProps> = ({ 
  botsModels, loadingBots, onRefreshBots, isMobile, onRestartGateway, isDarkMode = false
}) => {


  const { t } = useTranslation();
  const [selectedBot, setSelectedBot] = useState<string>('');
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>(() => {
    const saved = storage.getItem('chat_history');
    return saved ? JSON.parse(saved) : [];
  });
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
  
  // 持久化存储
  useEffect(() => {
    storage.setItem('chat_history', JSON.stringify(messages));
  }, [messages]);

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
   const [showScrollTopBtn, setShowScrollTopBtn] = useState(false);   const [isComposing, setIsComposing] = useState(false);
  const inputRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [chatEnabled, setChatEnabled] = useState<boolean | null>(null);
  const [checkingEnabled, setCheckingEnabled] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [generatedSessionId, setGeneratedSessionId] = useState<string | null>(null);
  
  const [quickCommands, setQuickCommands] = useState<any[]>([]);
  const [showQuickActions, setShowQuickActions] = useState<boolean>(() => {
    return storage.getItem('chat_show_quick_actions') !== 'false';
  });
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [form] = Form.useForm();

  const queryParams = new URLSearchParams(window.location.search);
  const urlBot = queryParams.get('bot');
  const urlUser = queryParams.get('user');
  const isEmbedMode = queryParams.get('embed') === 'true';

  useEffect(() => {
    checkChatStatus();
    fetchQuickCommands();
  }, []);

  useEffect(() => {
    if (!urlUser) {
      let storedSessionId = storage.getItem('chat_session_id');
      if (!storedSessionId) {
        storedSessionId = `s-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        storage.setItem('chat_session_id', storedSessionId);
      }
      setGeneratedSessionId(storedSessionId);
    } else {
      setGeneratedSessionId(null);
    }
  }, [urlUser]);

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
      mascotRing: isDarkMode ? '#1e293b' : '#fff',
      subtle: '#94a3b8',
      dot: isDarkMode ? '#475569' : '#cbd5e1',
      uploadDashed: isDarkMode ? '#1e3a5f' : '#eff6ff'
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
    `}</style>
  ), [c]);

  const handleSend = async (textOverride?: string) => {
    const text = textOverride || inputText;
    if ((!text.trim() && attachedFiles.length === 0) || isTyping || !selectedBot || isUploading) return;

    if (!textOverride) setInputText('');
    const currentQuoted = quotedMsg;
    const currentFiles = [...attachedFiles];
    
    setQuotedMsg(null); 
    setAttachedFiles([]); // 清空已上传文件
    setIsTyping(true);
    
    abortControllerRef.current = new AbortController();

    // 整合文件信息到文本中 (Markdown 格式)
    let finalContent = text;
    if (currentFiles.length > 0) {
      const fileLinks = currentFiles.map(f => {
        const isImage = f.ext.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
        if (isImage) {
          return `\n![${f.filename}](${f.thumbUrl || f.url} "${f.url}")\n(File path: ${f.path})`;
        }
        return `\n[${f.filename}](${f.url}) (File path: ${f.path})`;
      }).join('');
      
      // 增加明确的专家指令
      const fileInstruction = `\n\n**System Note for Expert:** The user has uploaded files. For any file analysis, reading, or processing tasks, please access the files directly using the absolute **"File path"** provided above. Do not attempt to download via URL.`;
      finalContent += fileLinks + fileInstruction;
    }

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newUserMessage: Message = { role: 'user', content: finalContent, timestamp, quotedMessage: currentQuoted || undefined };
    const newMessages = [...messages, newUserMessage];
    setMessages(newMessages);

    // 1. 发送瞬间：先挂载一个带有“正在思考”标志的 Assistant 消息气泡
    const thinkingTip = t('chat.thinking');
    const assistantTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const assistantMessage: Message = { role: 'assistant', content: thinkingTip, timestamp: assistantTimestamp };
    setMessages(prev => [...prev, assistantMessage]);

    const formattedMessages = newMessages.map(m => {
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
        if (response.status === 403 || response.status === 401) {
          try {
            const errorData = await response.clone().json();
            if (errorData.error?.message?.includes('operator.write')) {
              message.error(t('chat.permissionError'), 10);
              setIsTyping(false);
              return;
            }
          } catch (e) {}
        }
        throw new Error(t('chat.networkError'));
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error(t('chat.streamError'));

      const decoder = new TextDecoder();
      let accumulatedContent = '';
      let isFirstChunk = true; 
      let firstTokenTime: number | null = null;
      const startTime = Date.now();
      let totalLength = 0;
      
      streamLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) {
          isStreamingFinished = true;
          break streamLoop;
        }

        const chunk = decoder.decode(value);
        if (!firstTokenTime && (chunk.includes('"content":') || chunk.includes('"delta":'))) {
          firstTokenTime = Date.now();
        }

        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') {
              isStreamingFinished = true;
              break streamLoop;
            }
            try {
                const data = JSON.parse(dataStr);
                const content = data.choices[0]?.delta?.content || '';
                if (content) {
                  if (isFirstChunk) {
                    // 核心变更：首个有效字符到达，彻底抹除“正在思考中...”提示
                    displayedContent = ''; 
                    isFirstChunk = false;
                  }
                  for (const char of content) {
                    charQueue.push(char);
                  }
                  totalLength += content.length;
                  accumulatedContent += content;
                }
            } catch (e) {}
          }
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
      } else {
        message.error(t('common.error'));
      }
    } finally {
      // 任意出口（含 try 内 return / 抛错）都必须结束，否则 rAF 在「流未标记结束且队列已空」时会空转占满 CPU
      isStreamingFinished = true;
      setIsTyping(false);
      abortControllerRef.current = null;
    }
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
    // 找到最后一条用户消息
    const lastUserIndex = [...messages].reverse().findIndex(m => m.role === 'user');
    if (lastUserIndex !== -1) {
      const actualIndex = messages.length - 1 - lastUserIndex;
      const lastUserMsg = messages[actualIndex];
      
      // 移除该用户消息之后的所有 AI 消息
      setMessages(prev => prev.slice(0, actualIndex + 1));
      
      // 重新触发发送
      handleSend(lastUserMsg.content);
    }
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
        storage.removeItem('chat_history');
        const newSessionId = `s-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        storage.setItem('chat_session_id', newSessionId);
        setGeneratedSessionId(newSessionId);
        message.success(t('chat.historyCleared'));
      }
    });
  };

  const botList = botsModels?.data?.bots || [];

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
    <div style={{ 
      flex: 1,
      display: 'flex', 
      flexDirection: 'column', 
      gap: isEmbedMode ? 0 : 16,
      background: c.pageBg,
      width: '100%',
      height: '100%',
      minHeight: 0,
      minWidth: 0,
      position: 'relative',
      overflow: 'hidden'
    }}>
      {markdownStyles}
      {/* Top Bar */}
      <Card 
        styles={{ body: { padding: isMobile ? '8px 12px' : '12px 20px' } }} 
        style={{ 
          borderRadius: isEmbedMode ? 0 : 12, 
          boxShadow: isEmbedMode ? 'none' : c.cardShadow,
          border: isEmbedMode ? 'none' : `1px solid ${c.border}`,
          borderBottom: isEmbedMode ? `1px solid ${c.hairline}` : 'none',
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
            {!isMobile && <span style={{ color: c.body, fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>{t('chat.selectBotTip')}:</span>}
            <Select 
              placeholder={t('chat.selectBotTip')} 
              style={{ width: isMobile ? 'auto' : 240, flex: isMobile ? 1 : 'none', minWidth: isMobile ? 120 : 0, height: 40 }} 
              value={selectedBot}
              onChange={setSelectedBot}
              loading={loadingBots}
              variant="borderless"
              dropdownStyle={{ borderRadius: 8, minWidth: 260 }}
              listHeight={400}
            >
              {botList.map((bot: any) => (
                <Option key={bot.id} value={`openclaw:${bot.id}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                    <ProviderIcon provider={bot.provider || (bot.id === 'main' ? 'openai' : '')} size={20} />
                    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
                      <span style={{ fontWeight: 600, color: c.heading, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bot.name || bot.id}</span>
                      <span style={{ fontSize: 10, color: c.subtle, marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {bot.model || t('common.loading')}
                      </span>
                    </div>
                  </div>
                </Option>
              ))}
            </Select>
            <Button icon={<RefreshCw size={14} />} onClick={onRefreshBots} loading={loadingBots} title={t('common.refresh')} />
            {!isMobile && !isEmbedMode && (
              <Button 
                icon={<ExternalLink size={14} />} 
                title={t('chat.labDescription')}
                onClick={() => {
                  const token = storage.getItem('guardian_token');
                  const botId = selectedBot.replace('openclaw:', '');
                  const url = `${window.location.origin}/?page=chat&token=${token}&bot=${botId}&embed=true`;
                  window.open(url, '_blank');
                }}
              />
            )}
            {!isMobile && (
            <Button 
                icon={<Share2 size={14} />} 
                title={t('chat.shareTitle')}
                onClick={() => {
                  const token = storage.getItem('guardian_token');
                  const botId = selectedBot.replace('openclaw:', '');
                  const url = `${window.location.origin}/?page=chat&token=${token}&bot=${botId}&embed=true`;
                  const iframeCode = `<iframe src="${url}" width="100%" height="600" frameborder="0"></iframe>`;
                  Modal.info({
                    title: t('chat.shareTitle'),
                    width: 500,
                    content: (
                      <div style={{ marginTop: 16 }}>
                        <p style={{ fontSize: 13, color: c.body }}>{t('chat.shareDesc')}</p>
                        <Input.TextArea 
                          readOnly 
                          value={iframeCode} 
                          autoSize={{ minRows: 3 }} 
                          style={{ fontFamily: 'monospace', fontSize: 12, background: c.shareTa, color: isDarkMode ? '#e2e8f0' : undefined }}
                        />
                        <Button 
                          type="primary" 
                          size="small" 
                          icon={<Copy size={12} />} 
                          style={{ marginTop: 12 }}
                          onClick={() => {
                            navigator.clipboard.writeText(iframeCode);
                            message.success(t('chat.copySuccess'));
                          }}
                        >
                          {t('chat.copyIframe')}
                        </Button>
                      </div>
                    ),
                    okText: t('common.close')
                  });
                }}
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
        borderRadius: isEmbedMode ? 0 : 12, 
        border: isEmbedMode ? 'none' : `1px solid ${c.border}`,
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
            <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 640, padding: isMobile ? '20px' : '40px', width: '100%' }}>
              <div style={{ marginBottom: 24, position: 'relative', display: 'inline-block' }}>
                <img 
                  src={`${getBaseURL()}/openclaw.png`} 
                  style={{ width: 80, height: 80, borderRadius: 20, boxShadow: '0 20px 40px rgba(0,0,0,0.1)', border: `4px solid ${c.mascotRing}` }} 
                  alt="Mascot"
                />
                <div style={{ position: 'absolute', bottom: -5, right: -5, width: 24, height: 24, background: '#22c55e', borderRadius: '50%', border: `4px solid ${c.mascotRing}`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Zap size={10} color="#fff" fill="#fff" />
                </div>
              </div>
              <h2 style={{ color: c.heading, fontWeight: 800, fontSize: isMobile ? 20 : 26, letterSpacing: '-0.02em', marginBottom: 8 }}>
                {t('chat.welcomeTitle')}
              </h2>
              <p style={{ color: c.body, fontSize: isMobile ? 13 : 15, marginBottom: 32, maxWidth: 440, margin: '0 auto 32px' }}>
                {t('chat.welcomeSubtitle')}
              </p>
              
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 12 }}>
                {[
                  ...quickCommands.map(c => ({ icon: '🍭', title: c.label || t('chat.quickCommand'), text: c.prompt })),
                  { icon: '💡', title: t('login.features.monit'), text: t('chat.guidePrompt') },
                  { icon: '🚀', title: t('common.restart'), text: t('chat.latencyPrompt') },
                  { icon: '🛡️', title: t('common.dashboard'), text: t('chat.guardianPrompt') },
                  { icon: '🔧', title: t('common.assets'), text: t('chat.codePrompt') }
                ].filter((v, i, a) => a.findIndex(t => t.text === v.text) === i).slice(0, 8).map((item, i) => (
                  <div 
                    key={i} 
                    className="stagger-entry card-float"
                    onClick={() => {
                        if (!selectedBot || isTyping) {
                            if (!selectedBot) message.warning(t('chat.selectBot'));
                            return;
                        }
                        handleSend(item.text);
                    }}
                    style={{ 
                      padding: '16px', background: c.pickCard, borderRadius: 14, border: `1px solid ${c.border}`, 
                      cursor: isTyping ? 'not-allowed' : 'pointer', transition: 'all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
                      display: 'flex', flexDirection: 'column', gap: 6,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                      opacity: isTyping ? 0.6 : 1,
                      '--delay': `${i * 0.05}s`
                    } as React.CSSProperties}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 18 }}>{item.icon}</span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: c.heading }}>{item.title}</span>
                    </div>
                    <span style={{ fontSize: 12, color: c.body, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.text}</span>
                  </div>
                ))}
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
                    ) : (
                      msg.content
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 2, alignItems: 'center' }}>
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
                      >{t('chat.reply')}</Button>
                    </Tooltip>
                    <Button 
                      type="text" 
                      size="small" 
                      icon={<Copy size={12} />} 
                        style={{ color: c.subtle, height: 22, fontSize: 11, padding: '0 4px' }} 
                      onClick={() => copyToClipboard(msg.content)}
                    >{t('chat.copy')}</Button>
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
        <div style={{ padding: isMobile ? '12px' : '16px 24px', background: c.inputFoot, borderTop: `1px solid ${c.hairline}`, position: 'relative' }}>
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
                action={`${getBaseURL()}/v1/openclaw/chat/upload`}
                data={{ botId: selectedBot.replace('openclaw:', '') }}
                headers={{
                  Authorization: `Bearer ${storage.getItem('guardian_token')}`
                }}
                showUploadList={false}
                disabled={isUploading || isTyping}
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
                    disabled={isUploading || isTyping}
                    style={{ 
                      color: (isUploading || isTyping) ? c.dot : c.subtle, 
                      borderRadius: 10, 
                      height: 40, width: 40, 
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      opacity: (isUploading || isTyping) ? 0.5 : 1
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
                disabled={!selectedBot || !inputText.trim()}
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
        width={500}
        bodyStyle={{ paddingTop: 16 }}
      >
        <div style={{ marginBottom: 24 }}>
            <h4 style={{ fontSize: 13, color: c.body, marginBottom: 12 }}>{t('chat.currentCommands')}</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {quickCommands.map(cmd => (
                    <div key={cmd.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: c.cmdRowBg, borderRadius: 8, border: `1px solid ${c.cmdRowBorder}` }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 600, color: c.heading, fontSize: 14 }}>{cmd.label}</div>
                            <div style={{ fontSize: 12, color: c.subtle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd.prompt}</div>
                        </div>
                        {!cmd.is_system && (
                            <Button 
                                type="text" 
                                danger 
                                icon={<Trash2 size={14} />} 
                                size="small" 
                                onClick={() => handleDeleteQuickCommand(cmd.id)}
                            />
                        )}
                    </div>
                ))}
            </div>
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
