import React, { useState, useEffect, useRef } from 'react';
import { Card, Select, Input, Button, Avatar, Spin, message, Modal } from 'antd';
import { Send, Bot, User, RefreshCw, Trash2, MessageSquare, Zap, Settings } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import api from '../api';

const { Option } = Select;

interface Message {
  role: 'user' | 'assistant';
  content: string;
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
  const [isTyping, setIsTyping] = useState(false);
  const inputRef = useRef<any>(null); // 新增
  const [chatEnabled, setChatEnabled] = useState<boolean | null>(null);
  const [checkingEnabled, setCheckingEnabled] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkChatStatus();
    if (botsModels?.data?.bots?.length > 0 && !selectedBot) {
        setSelectedBot(`openclaw:${botsModels.data.bots[0].id}`);
    }
  }, [botsModels]);

  useEffect(() => {
    if (!isTyping && chatEnabled) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isTyping, chatEnabled]);

  const checkChatStatus = async () => {
    try {
      const res = await fetch('/v1/openclaw/chat/status');
      const data = await res.json();
      setChatEnabled(data.enabled);
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
          const res = await fetch('/v1/openclaw/chat/enable', { method: 'POST' });
          const data = await res.json();
          if (data.status === 'success') {
            message.loading('配置已更新，正在重启网关...', 2);
            // 2. 触发重启
            if (onRestartGateway) {
              await onRestartGateway();
            }
            message.success('对话功能已成功开启');
            setChatEnabled(true);
          } else {
            message.error(data.error || '开启失败');
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

  const handleSend = async () => {
    if (!inputText.trim() || isTyping || !selectedBot) return;

    const userMessage: Message = { role: 'user', content: inputText };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInputText('');
    setIsTyping(true);

    try {
      const response = await fetch(`${api.defaults.baseURL || ''}/v1/openclaw/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('guardian_token')}`
        },
        body: JSON.stringify({
          model: selectedBot,
          messages: newMessages,
          stream: true
        })
      });

      if (!response.ok) throw new Error('网络请求失败');

      const reader = response.body?.getReader();
      if (!reader) throw new Error('无法读取响应流');

      const assistantMessage: Message = { role: 'assistant', content: '' };
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
    } catch (err) {
      message.error('发送失败，请检查网关连接');
    } finally {
      setIsTyping(false);
    }
  };

  const clearHistory = () => {
    setMessages([]);
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
        font-size: 14px;
        line-height: 1.6;
        word-wrap: break-word;
      }
      .markdown-body h1, .markdown-body h2, .markdown-body h3 {
        margin-top: 16px;
        margin-bottom: 8px;
        font-weight: 600;
        color: inherit;
      }
      .markdown-body p { margin-bottom: 8px; }
      .markdown-body code {
        padding: 0.2em 0.4em;
        margin: 0;
        font-size: 85%;
        background-color: rgba(175, 184, 193, 0.2);
        border-radius: 6px;
        font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
      }
      .markdown-body pre {
        padding: 12px;
        overflow: auto;
        font-size: 85%;
        line-height: 1.45;
        background-color: #f6f8fa;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
        margin-bottom: 12px;
      }
      .markdown-body pre code {
        padding: 0;
        margin: 0;
        background-color: transparent;
        border: 0;
      }
      .markdown-body ul, .markdown-body ol {
        margin-bottom: 8px;
        padding-left: 20px;
      }
      .markdown-body table {
        border-spacing: 0;
        border-collapse: collapse;
        margin-bottom: 16px;
        width: 100%;
      }
      .markdown-body table th, .markdown-body table td {
        padding: 6px 13px;
        border: 1px solid #d0d7de;
      }
      .markdown-body table tr:nth-child(2n) {
        background-color: #f6f8fa;
      }
    `}</style>
  );

  return (
    <div style={{ height: 'calc(100vh - 120px)', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {markdownStyles}
      {/* Top Bar */}
      <Card bodyStyle={{ padding: isMobile ? '8px 12px' : '12px 20px' }} style={{ borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'nowrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 12 }}>
            <div style={{ padding: isMobile ? 6 : 8, background: '#eff6ff', borderRadius: 10, color: '#2563eb', flexShrink: 0 }}>
                <MessageSquare size={isMobile ? 18 : 20} />
            </div>
            {!isMobile && (
              <div>
                <div style={{ fontWeight: 700, color: '#1e293b', fontSize: 15 }}>对话实验室</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>实时与 Lobster Bot 进行交互测试</div>
              </div>
            )}
          </div>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, flex: isMobile ? 1 : 'none', justifyContent: 'flex-end', minWidth: 0 }}>
            <Select 
              placeholder="选择机器人" 
              style={{ width: isMobile ? 'auto' : 240, flex: isMobile ? 1 : 'none', minWidth: isMobile ? 120 : 0 }} 
              value={selectedBot}
              onChange={setSelectedBot}
              loading={loadingBots}
              dropdownStyle={{ borderRadius: 8, minWidth: 260 }}
              listHeight={400}
              size={isMobile ? 'middle' : 'middle'}
            >
              {botList.map((bot: any) => (
                <Option key={bot.id} value={`openclaw:${bot.id}`}>
                  <div style={{ display: 'flex', flexDirection: 'column', lineHeight: '1.4', padding: '4px 0' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span>🦞</span>
                      <span style={{ fontWeight: 600, color: '#1e293b' }}>{bot.name || bot.id}</span>
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginLeft: 24, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {bot.model || '未设定'}
                    </div>
                  </div>
                </Option>
              ))}
            </Select>
            <Button icon={<RefreshCw size={14} />} onClick={onRefreshBots} loading={loadingBots} title="刷新列表" />
            <Button danger icon={<Trash2 size={14} />} onClick={clearHistory} disabled={messages.length === 0}>{isMobile ? '' : '清空'}</Button>
          </div>
        </div>
      </Card>

      {/* Chat Area */}
      <div style={{ 
        flex: 1, 
        background: '#fff', 
        borderRadius: 12, 
        border: '1px solid #e2e8f0',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}>
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
                  maxWidth: '75%',
                  padding: '12px 16px',
                  borderRadius: 16,
                  borderTopRightRadius: msg.role === 'user' ? 4 : 16,
                  borderTopLeftRadius: msg.role === 'assistant' ? 4 : 16,
                  background: msg.role === 'user' ? '#2563eb' : '#fff',
                  color: msg.role === 'user' ? '#fff' : '#1e293b',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05)',
                  fontSize: 14,
                  lineHeight: 1.6,
                  whiteSpace: 'pre-wrap'
                }}>
                  {msg.role === 'assistant' ? (
                    <div className="markdown-body">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {msg.content}
                      </ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
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
          <div style={{ display: 'flex', gap: isMobile ? 8 : 12 }}>
            <Input.TextArea 
              ref={inputRef}
              placeholder={selectedBot ? (isMobile ? "输入消息" : "输入消息，Shift + Enter 换行...") : "选机器人"}
              autoSize={{ minRows: 1, maxRows: 4 }}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              style={{ borderRadius: 12, padding: isMobile ? '8px 12px' : '10px 16px', fontSize: isMobile ? 15 : 14 }}
              disabled={!selectedBot || isTyping}
            />
            <Button 
                type="primary" 
                icon={<Send size={18} />} 
                onClick={handleSend}
                disabled={!inputText.trim() || isTyping || !selectedBot}
                style={{ 
                    height: 'auto', 
                    width: isMobile ? 44 : 50, 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'center',
                    borderRadius: 12
                }}
            />
          </div>
          {!isMobile && (
            <div style={{ marginTop: 8, fontSize: 11, color: '#94a3b8', display: 'flex', gap: 16 }}>
              <span>⚡️ 支持流式响应</span>
              <span>🤖 User: lobster</span>
              <span>🔒 Gateway Token 已隐藏</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default OnlineChat;
