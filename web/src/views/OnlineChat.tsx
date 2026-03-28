import React, { useState, useEffect, useRef } from 'react';
import { Card, Select, Input, Button, Avatar, Spin, message, Modal, Form } from 'antd';
import { Send, Bot, User, RefreshCw, Trash2, MessageSquare, Zap, Settings, Copy, RotateCcw, StopCircle, ListRestart, Plus, ExternalLink, Share2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeSanitize from 'rehype-sanitize';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import api from '../api';

const { Option } = Select;

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp?: string; // 新增时间戳
}

interface OnlineChatProps {
  botsModels: any;
  loadingBots: boolean;
  onRefreshBots: () => void;
  isMobile?: boolean;
  onRestartGateway?: () => Promise<void>; // 新增
}

const OnlineChat: React.FC<OnlineChatProps> = ({ botsModels, loadingBots, onRefreshBots, isMobile, onRestartGateway }) => {
  const [selectedBot, setSelectedBot] = useState<string>('');
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  
  // --- Markdown 预处理逻辑，修复模型输出不规范导致的渲染问题 ---
  const preprocessMarkdown = (content: string) => {
    if (!content) return '';
    return content
      // 1. 确保标题 (#) 前有空行
      .replace(/([^\n])\n(#{1,6}\s)/g, '$1\n\n$2')
      // 2. 确保表格 (|) 前有空行，且排除表格内部行
      .replace(/([^\n])\n(\|)/g, (match, p1, p2) => {
        return p1.trim().endsWith('|') ? match : p1 + '\n\n' + p2;
      })
      // 3. 确保代码块 (```) 前有空行
      .replace(/([^\n])\n(```)/g, '$1\n\n$2');
  };

  const [isTyping, setIsTyping] = useState(false);
  const [isComposing, setIsComposing] = useState(false); // IME 输入状态
  const inputRef = useRef<any>(null);
  const abortControllerRef = useRef<AbortController | null>(null); // 中断控制器
  const [chatEnabled, setChatEnabled] = useState<boolean | null>(null);
  const [checkingEnabled, setCheckingEnabled] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [generatedSessionId, setGeneratedSessionId] = useState<string | null>(null); // 新增
  
  // 快捷指令相关状态
  const [quickCommands, setQuickCommands] = useState<any[]>([]);
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const [form] = Form.useForm();

  // URL 参数解析
  const queryParams = new URLSearchParams(window.location.search);
  const urlBot = queryParams.get('bot');
  const urlUser = queryParams.get('user');
  const isEmbedMode = queryParams.get('embed') === 'true';

  useEffect(() => {
    checkChatStatus();
    fetchQuickCommands();
  }, []);

  useEffect(() => {
    if (!urlUser) { // 只有当 urlUser 不存在时，才启用内部 session_id 逻辑
      let storedSessionId = localStorage.getItem('chat_session_id');
      if (!storedSessionId) {
        storedSessionId = `s-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`; // 生成一个简单的唯一ID
        localStorage.setItem('chat_session_id', storedSessionId);
      }
      setGeneratedSessionId(storedSessionId);
    } else {
      setGeneratedSessionId(null); // 如果 urlUser 存在，则不需要内部生成的 session ID
    }
  }, [urlUser]); // 依赖 urlUser，当其变化时重新评估

  useEffect(() => {
    if (botsModels?.data?.bots?.length > 0) {
      if (urlBot) {
        // 如果 URL 指定了 Bot，优先使用
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

  useEffect(() => {
    if (!isTyping && chatEnabled) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isTyping, chatEnabled]);

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
        message.success('添加成功');
        form.resetFields();
        fetchQuickCommands();
      }
    } catch (err) {
      message.error('添加失败');
    }
  };

  const handleDeleteQuickCommand = async (id: number) => {
    try {
      const res = await api.delete(`/v1/openclaw/chat/quick-commands/${id}`);
      if (res.data.status === 'success') {
        message.success('已删除');
        fetchQuickCommands();
      }
    } catch (err) {
      message.error('删除失败');
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
      title: '确认一键开启聊天功能？',
      content: '开启后需要自动重启 OpenClaw 网关以使配置生效，重启期间网关服务将短时间不可用。',
      okText: '确认开启并重启',
      cancelText: '取消',
      onOk: async () => {
        setEnabling(true);
        try {
          // 1. 开启配置
          const res = await api.post('/v1/openclaw/chat/enable');
          if (res.data.status === 'success') {
            message.loading('配置已更新，正在重启网关...', 2);
            // 2. 触发重启
            if (onRestartGateway) {
              await onRestartGateway();
            }
            message.success('对话功能已成功开启');
            setChatEnabled(true);
          } else {
            message.error(res.data.error || '开启失败');
          }
        } catch (err) {
          message.error('请求失败: ' + err);
        } finally {
          setEnabling(false);
        }
      }
    });
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const handleSend = async (textOverride?: string) => {
    const text = textOverride || inputText;
    if (!text.trim() || isTyping || !selectedBot) return;

    if (!textOverride) setInputText('');
    setIsTyping(true);
    
    abortControllerRef.current = new AbortController();

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const newUserMessage: Message = { role: 'user', content: text, timestamp };
    const newMessages = [...messages, newUserMessage];
    setMessages(newMessages);

    const requestBody: any = {
      model: selectedBot,
      messages: newMessages,
      stream: true
    };

    let userIdToSend = urlUser; // 默认使用 urlUser
    if (!userIdToSend && generatedSessionId) { // 如果 urlUser 不存在，且内部 session ID 已生成
      userIdToSend = `lobster-${generatedSessionId}`;
    }

    if (userIdToSend) { // 只有当 userIdToSend 有值时才添加到 requestBody
      requestBody.user = userIdToSend;
    }

    try {
      const response = await fetch(`${api.defaults.baseURL || ''}/v1/openclaw/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('guardian_token')}`
        },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal
      });

      if (!response.ok) throw new Error('网络请求失败');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const assistantTimestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const assistantMessage: Message = { role: 'assistant', content: '', timestamp: assistantTimestamp };
      setMessages(prev => [...prev, assistantMessage]);

      const decoder = new TextDecoder();
      let accumulatedContent = '';
      
      streamLoop: while (true) {
        const { done, value } = await reader.read();
        if (done) break streamLoop;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6).trim();
            if (dataStr === '[DONE]') break streamLoop;
            try {
                const data = JSON.parse(dataStr);
                const content = data.choices[0]?.delta?.content || '';
                accumulatedContent += content;
                setMessages(prev => {
                    const last = prev[prev.length - 1];
                    return [...prev.slice(0, -1), { ...last, content: accumulatedContent }];
                });
            } catch (e) {}
          }
        }
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        message.info('回复已停止');
      } else {
        message.error('发送失败，请检查网关连接');
      }
    } finally {
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
      message.success('已复制到剪贴板');
    });
  };

  const handleRegenerate = () => {
    // 找到最后一条用户消息
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (lastUserMsg) {
      // 移除最后一条 AI 消息（如果有）
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant') {
          return prev.slice(0, -1);
        }
        return prev;
      });
      handleSend(lastUserMsg.content);
    }
  };

  const clearHistory = () => {
    setMessages([]);
    // 生成一个新的 session ID 并存储
    const newSessionId = `s-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    localStorage.setItem('chat_session_id', newSessionId);
    setGeneratedSessionId(newSessionId); // 更新状态以确保下次发送使用新的 ID
    message.success('对话记录已清空');
  };

  const botList = botsModels?.data?.bots || [];

  if (checkingEnabled) {
    return (
        <div style={{ padding: 40, textAlign: 'center' }}>
            <Spin tip="正在检查聊天功能配置..." />
        </div>
    );
  }

  if (chatEnabled === false) {
    return (
      <div style={{ height: 'calc(100vh - 120px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Card style={{ width: 450, borderRadius: 16, boxShadow: '0 8px 24px rgba(0,0,0,0.05)', textAlign: 'center' }} bodyStyle={{ padding: '40px 32px' }}>
          <div style={{ background: '#fff7ed', width: 64, height: 64, borderRadius: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 24px', color: '#f97316' }}>
            <Zap size={32} />
          </div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>小龙虾服务未开启聊天功能</h2>
          <p style={{ color: '#64748b', fontSize: 14, lineHeight: 1.6, marginBottom: 32 }}>
            当前的 OpenClaw 网关配置中未启用 <code>chatCompletions</code> 接口。开启后，您可以直接在监控台与机器人进行对话。
          </p>
          <Button 
            type="primary" 
            size="large" 
            icon={<Settings size={18} />} 
            style={{ borderRadius: 10, height: 48, padding: '0 24px', background: '#2563eb' }}
            onClick={handleEnableChat}
            loading={enabling}
          >
            一键开启聊天功能
          </Button>
          <div style={{ marginTop: 16, fontSize: 12, color: '#94a3b8' }}>
            开启操作将自动修改配置文件并重启网关
          </div>
        </Card>
      </div>
    );
  }

  // --- Styles for Markdown Content ---
  const markdownStyles = (
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
        color: #1e293b;
      }
      .markdown-body p { margin-bottom: 6px; }
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
        margin-bottom: 10px;
        width: 100%;
        overflow-x: auto;
        display: block;
        -webkit-overflow-scrolling: touch;
      }
      .markdown-body table th {
        background-color: #f8fafc;
        font-weight: 600;
        text-align: left;
      }
      .markdown-body table tr:nth-child(2n) {
        background-color: #fcfcfc;
      }
      .markdown-body blockquote {
        margin: 0 0 10px 0;
        padding: 0 12px;
        color: #64748b;
        border-left: 4px solid #e2e8f0;
      }
      .markdown-body pre {
        margin-bottom: 10px !important;
        max-width: 100%;
        overflow-x: auto;
      }
    `}</style>
  );

  return (
    <div style={{ 
      flex: 1,
      display: 'flex', 
      flexDirection: 'column', 
      gap: isEmbedMode ? 0 : 16,
      background: '#f8fafc',
      width: '100%',
      height: '100%',
      minHeight: 0,
      minWidth: 0
    }}>
      {markdownStyles}
      {/* Top Bar */}
      <Card 
        bodyStyle={{ padding: isMobile ? '8px 12px' : '12px 20px' }} 
        style={{ 
          borderRadius: isEmbedMode ? 0 : 12, 
          boxShadow: isEmbedMode ? 'none' : '0 1px 2px rgba(0,0,0,0.03)',
          border: isEmbedMode ? 'none' : '1px solid #e2e8f0',
          borderBottom: isEmbedMode ? '1px solid #f1f5f9' : 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'nowrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12 }}>
            <div style={{ padding: isMobile ? 6 : 8, background: '#eff6ff', borderRadius: 10, color: '#2563eb', flexShrink: 0 }}>
                <MessageSquare size={isMobile ? 18 : 20} />
            </div>
            {!isMobile && (
              <div>
                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 15, display: 'flex', alignItems: 'center', gap: 8 }}>
                  对话实验室
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
                      User: {urlUser}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 12, color: '#64748b' }}>实时与 Lobster Bot 进行交互测试</div>
              </div>
            )}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, flex: isMobile ? 1 : 'none', justifyContent: 'flex-end', minWidth: 0 }}>
            {!isMobile && <span style={{ color: '#64748b', fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>请选择机器人:</span>}
            <Select 
              placeholder="选择机器人" 
              style={{ width: isMobile ? 'auto' : 240, flex: isMobile ? 1 : 'none', minWidth: isMobile ? 120 : 0, height: 40 }} 
              value={selectedBot}
              onChange={setSelectedBot}
              loading={loadingBots}
              dropdownStyle={{ borderRadius: 8, minWidth: 260 }}
              listHeight={400}
            >
              {botList.map((bot: any) => (
                <Option key={bot.id} value={`openclaw:${bot.id}`}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
                    <span style={{ fontSize: 18 }}>🦞</span>
                    <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.2' }}>
                      <span style={{ fontWeight: 600, color: '#1e293b', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bot.name || bot.id}</span>
                      <span style={{ fontSize: 10, color: '#94a3b8', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {bot.model || '未设定'}
                      </span>
                    </div>
                  </div>
                </Option>
              ))}
            </Select>
            <Button icon={<RefreshCw size={14} />} onClick={onRefreshBots} loading={loadingBots} title="刷新列表" />
            {!isEmbedMode && !isMobile && (
              <Button 
                icon={<ExternalLink size={14} />} 
                title="在新窗口打开独立聊天"
                onClick={() => {
                  const token = localStorage.getItem('guardian_token');
                  const botId = selectedBot.replace('openclaw:', '');
                  const url = `${window.location.origin}/?page=chat&token=${token}&bot=${botId}&embed=true`;
                  window.open(url, '_blank');
                }}
              />
            )}
            {!isEmbedMode && !isMobile && (
              <Button 
                  icon={<Share2 size={14} />} 
                  title="获取嵌入代码"
                  onClick={() => {
                    const token = localStorage.getItem('guardian_token');
                    const botId = selectedBot.replace('openclaw:', '');
                    const url = `${window.location.origin}/?page=chat&token=${token}&bot=${botId}&embed=true`;
                    const iframeCode = `<iframe src="${url}" width="100%" height="600" frameborder="0"></iframe>`;
                    Modal.info({
                      title: '获取嵌入代码',
                      width: 500,
                      content: (
                        <div style={{ marginTop: 16 }}>
                          <p style={{ fontSize: 13, color: '#64748b' }}>您可以将以下代码复制到其他系统中以嵌入此聊天窗口：</p>
                          <Input.TextArea 
                            readOnly 
                            value={iframeCode} 
                            autoSize={{ minRows: 3 }} 
                            style={{ fontFamily: 'monospace', fontSize: 12, background: '#f8fafc' }}
                          />
                          <Button 
                            type="primary" 
                            size="small" 
                            icon={<Copy size={12} />} 
                            style={{ marginTop: 12 }}
                            onClick={() => {
                              navigator.clipboard.writeText(iframeCode);
                              message.success('代码已复制');
                            }}
                          >
                            复制 Iframe 代码
                          </Button>
                        </div>
                      ),
                      okText: '关闭'
                    });
                  }}
              />
            )}
            <Button danger icon={<Trash2 size={14} />} onClick={clearHistory} disabled={messages.length === 0}>{isMobile ? '' : '清空'}</Button>
          </div>
        </div>
      </Card>

      {/* Chat Area */}
      <div style={{ 
        flex: 1, 
        background: '#fff', 
        borderRadius: isEmbedMode ? 0 : 12, 
        border: isEmbedMode ? 'none' : '1px solid #e2e8f0',
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
            background: 'rgba(255,255,255,0.65)',
            backdropFilter: 'blur(3px)',
            zIndex: 10,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 12,
            animation: 'fade-in 0.3s ease'
          }}>
            <div style={{ padding: '24px 32px', background: '#fff', borderRadius: 16, boxShadow: '0 12px 40px rgba(0,0,0,0.1)', border: '1px solid #f1f5f9', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>☝️</div>
              <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 16 }}>请先在右上方选择一个对话机器人</div>
              <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>选择后即可开始实时交互测试</div>
            </div>
          </div>
        )}
        <div 
          ref={scrollRef}
          style={{ 
            flex: 1, 
            overflowY: 'auto', 
            padding: isMobile ? '16px' : '24px',
            display: 'flex',
            flexDirection: 'column',
            gap: isMobile ? 12 : 20,
            background: '#fafafa'
          }}
        >
          {messages.length === 0 ? (
            <div style={{ margin: 'auto', textAlign: 'center' }}>
              <div style={{ fontSize: 48, marginBottom: 16 }}>🦞</div>
              <h3 style={{ color: '#1e293b', fontWeight: 600 }}>准备好开始对话了吗？</h3>
              <p style={{ color: '#64748b', maxWidth: 300 }}>选择一个机器人，输入您的问题，系统将通过 OpenClaw 网关为您转发。</p>
            </div>
          ) : (
            messages.map((msg, index) => (
              <div 
                key={index} 
                style={{ 
                  display: 'flex', 
                  gap: 12,
                  flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                  alignItems: 'flex-start'
                }}
              >
                <Avatar 
                  size={36} 
                  style={{ 
                    background: msg.role === 'user' ? '#2563eb' : '#fff',
                    border: msg.role === 'assistant' ? '1px solid #e2e8f0' : 'none',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
                    flexShrink: 0
                  }}
                  icon={msg.role === 'user' ? <User size={18} /> : <Bot size={18} color="#2563eb" />}
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
                    background: msg.role === 'user' ? '#2563eb' : '#fff',
                    color: msg.role === 'user' ? '#fff' : '#1e293b',
                    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                    fontSize: 14,
                    lineHeight: 1.6,
                    whiteSpace: 'pre-wrap',
                    position: 'relative'
                  }}>
                    {msg.role === 'assistant' ? (
                      <div className="markdown-body" style={{ whiteSpace: 'normal' }}>
                        <ReactMarkdown 
                          remarkPlugins={[remarkGfm, remarkBreaks]}
                          rehypePlugins={[rehypeSanitize]}
                          components={{
                            table: ({ node, ...props }: any) => (
                              <div style={{ 
                                width: '100%', 
                                overflowX: 'auto', 
                                marginBottom: 12, 
                                borderRadius: 8,
                                border: '1px solid #e2e8f0',
                                background: '#fff'
                              }}>
                                <table {...props} style={{ 
                                  width: '100%', 
                                  borderCollapse: 'collapse',
                                  fontSize: isMobile ? '12px' : '13px',
                                  minWidth: isMobile ? '500px' : 'auto'
                                }} />
                              </div>
                            ),
                            th: ({ node, ...props }: any) => (
                              <th {...props} style={{ 
                                padding: '8px 12px', 
                                background: '#f8fafc', 
                                borderBottom: '1px solid #e2e8f0', 
                                borderRight: '1px solid #e2e8f0',
                                textAlign: 'left',
                                fontWeight: 600
                              }} />
                            ),
                            td: ({ node, ...props }: any) => (
                              <td {...props} style={{ 
                                padding: '8px 12px', 
                                borderBottom: '1px solid #e2e8f0', 
                                borderRight: '1px solid #e2e8f0'
                              }} />
                            ),
                            code: ({ node, inline, className, children, ...props }: any) => {
                              const match = /language-(\w+)/.exec(className || '');
                              const language = match ? match[1] : '';
                              
                              if (!inline && language) {
                                return (
                                  <div style={{ position: 'relative', margin: '12px 0', border: 'none' }}>
                                    <div style={{ 
                                      position: 'absolute', 
                                      right: 8, 
                                      top: 8, 
                                      zIndex: 1, 
                                      fontSize: 10, 
                                      color: '#94a3b8',
                                      textTransform: 'uppercase',
                                      fontWeight: 600,
                                      pointerEvents: 'none'
                                    }}>
                                      {language}
                                    </div>
                                    <SyntaxHighlighter
                                      {...props}
                                      style={vscDarkPlus}
                                      language={language}
                                      PreTag="div"
                                      customStyle={{
                                        margin: 0,
                                        borderRadius: '8px',
                                        fontSize: '13px',
                                        padding: '16px 12px'
                                      }}
                                    >
                                      {String(children).replace(/\n$/, '')}
                                    </SyntaxHighlighter>
                                  </div>
                                );
                              }
                              
                              return (
                                <code className={className} {...props} style={{
                                  padding: '0.2em 0.4em',
                                  backgroundColor: 'rgba(175, 184, 193, 0.2)',
                                  borderRadius: '6px',
                                  fontSize: '85%'
                                }}>
                                  {children}
                                </code>
                              );
                            }
                          }}
                        >
                          {preprocessMarkdown(msg.content)}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      msg.content
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 8, marginTop: 2, alignItems: 'center' }}>
                    <Button 
                      type="text" 
                      size="small" 
                      icon={<Copy size={12} />} 
                      style={{ color: '#94a3b8', height: 22, fontSize: 11, padding: '0 4px' }} 
                      onClick={() => copyToClipboard(msg.content)}
                    >复制</Button>
                    {msg.role === 'assistant' && index === messages.length - 1 && !isTyping && (
                      <Button 
                        type="text" 
                        size="small" 
                        icon={<RotateCcw size={12} />} 
                        style={{ color: '#94a3b8', height: 22, fontSize: 11, padding: '0 4px' }} 
                        onClick={handleRegenerate}
                      >重试</Button>
                    )}
                    <span style={{ fontSize: 10, color: '#94a3b8', opacity: 0.8, marginLeft: 4 }}>
                      {msg.timestamp}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
          {isTyping && (
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
                <Avatar size={36} style={{ background: '#fff', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }} icon={<Bot size={18} color="#2563eb" />} />
                <div style={{ padding: '8px 12px', background: '#fff', borderRadius: 12, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Spin size="small" />
                    <span style={{ fontSize: 12, color: '#64748b' }}>Lobster 正在思考回复中...</span>
                </div>
            </div>
          )}
        </div>

        {/* Input Area */}
        <div style={{ padding: isMobile ? '12px' : '16px 24px', background: '#fff', borderTop: '1px solid #f1f5f9' }}>
          {/* Quick Actions */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', flex: 1, paddingBottom: 4, scrollbarWidth: 'none' }}>
              {quickCommands.map(item => (
                <Button 
                  key={item.id}
                  size="small"
                  style={{ borderRadius: 16, fontSize: 12, display: 'flex', alignItems: 'center', gap: 4, background: '#f8fafc', color: '#64748b', borderColor: '#e2e8f0', flexShrink: 0 }}
                  onClick={() => handleSend(item.prompt)}
                >
                  {item.label}
                </Button>
              ))}
            </div>
            <Button 
                type="text" 
                size="small" 
                icon={<Settings size={14} />} 
                style={{ color: '#94a3b8', background: '#f1f5f9', borderRadius: 12, height: 24, width: 24, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                onClick={() => setIsManageModalOpen(true)}
                title="管理快捷指令"
            />
          </div>

          <div style={{ display: 'flex', gap: isMobile ? 8 : 12, alignItems: 'flex-end' }}>
            <Input.TextArea 
              ref={inputRef}
              placeholder={selectedBot ? (isMobile ? "输入消息" : "输入消息，Shift + Enter 换行...") : "选机器人"}
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
              style={{ borderRadius: 12, padding: isMobile ? '8px 12px' : '10px 16px', fontSize: isMobile ? 15 : 14 }}
              disabled={!selectedBot || (isTyping && !abortControllerRef.current)}
            />
            {isTyping ? (
              <Button 
                danger 
                icon={<StopCircle size={18} />} 
                style={{ borderRadius: 12, height: 40, width: 40, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                onClick={handleStopGeneration}
                title="停止生成"
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
            <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8', display: 'flex', gap: 16 }}>
              <span>⚡️ 支持流式响应</span>
              <span>🤖 User: {urlUser || (generatedSessionId ? `lobster-${generatedSessionId}` : '匿名')}</span>
              <span>🔒 Gateway Token 已隐藏</span>
            </div>
          )}
        </div>
      {/* Manage Quick Commands Modal */}
      <Modal
        title={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ListRestart size={20} color="#2563eb" />
                <span>管理快捷指令</span>
            </div>
        }
        open={isManageModalOpen}
        onCancel={() => setIsManageModalOpen(false)}
        footer={null}
        width={500}
        bodyStyle={{ paddingTop: 16 }}
      >
        <div style={{ marginBottom: 24 }}>
            <h4 style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>当前指令</h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {quickCommands.map(cmd => (
                    <div key={cmd.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #f1f5f9' }}>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontWeight: 600, color: '#1e293b', fontSize: 14 }}>{cmd.label}</div>
                            <div style={{ fontSize: 12, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cmd.prompt}</div>
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

        <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 24 }}>
            <h4 style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>新增指令</h4>
            <Form form={form} layout="vertical" onFinish={handleAddQuickCommand}>
                <Form.Item name="label" label="显示标签" rules={[{ required: true, message: '请输入标签名称' }]}>
                    <Input placeholder="例如：我的背景" style={{ borderRadius: 8 }} />
                </Form.Item>
                <Form.Item name="prompt" label="指令内容" rules={[{ required: true, message: '请输入指令快捷话术' }]}>
                    <Input.TextArea placeholder="填入点击按钮后自动发送的内容" autoSize={{ minRows: 2 }} style={{ borderRadius: 8 }} />
                </Form.Item>
                <Button type="primary" htmlType="submit" icon={<Plus size={16} />} block style={{ borderRadius: 8, height: 40 }}>添加指令</Button>
            </Form>
        </div>
      </Modal>
    </div>
  </div>
);
};

export default OnlineChat;
