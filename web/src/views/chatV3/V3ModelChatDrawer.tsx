import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Avatar, Button, Drawer, Input, Select, message as antdMessage } from 'antd';
import { Bot, Copy, Cpu, Loader2, MessageCircle, Send, Trash2, User, X, Zap } from 'lucide-react';
import Tooltip from '../../components/common/AppTooltip';
import { streamModelChatCompletions, type ChatCompletionMessage } from '../../api';
import { V3ModelChatMarkdown } from './v3ModelChatMarkdown';

export type ModelChatMessage = ChatCompletionMessage & {
  id: string;
  timestamp: string;
  modelId?: string;
  ttft?: number;
};

export interface V3ModelChatDrawerProps {
  t: any;
  isDarkMode?: boolean;
  botsModels: any;
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';
  open: boolean;
  onClose: () => void;
  copyToClipboard?: (text: string) => void;
}

function groupModels(models: any[]): Record<string, any[]> {
  return (models || []).reduce((acc: Record<string, any[]>, m: any) => {
    let p = 'Others';
    if (m.id && String(m.id).includes('/')) p = String(m.id).split('/')[0];
    else if (m.provider) p = m.provider;
    if (!acc[p]) acc[p] = [];
    acc[p].push(m);
    return acc;
  }, {});
}

function pickDefaultModelId(botsModels: any): string {
  const models = botsModels?.data?.models;
  if (Array.isArray(models) && models.length > 0) {
    return models[0].id || '';
  }
  const bot = botsModels?.data?.bots?.[0];
  return bot?.model || '';
}

/** 模型试聊侧栏（Drawer 弹层，不影响主会话布局） */
export function V3ModelChatDrawer({
  t,
  isDarkMode = false,
  botsModels,
  status,
  open,
  onClose,
  copyToClipboard,
}: V3ModelChatDrawerProps) {
  const [selectedModel, setSelectedModel] = useState('');
  /** 全模型共享同一份对话记录，切换模型仅影响后续请求使用的 modelID */
  const [messages, setMessages] = useState<ModelChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const streamAbortRef = useRef<AbortController | null>(null);

  const focusInput = useCallback(() => {
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const len = el.value.length;
      el.setSelectionRange(len, len);
    });
  }, []);

  const canSend = useMemo(
    () => status === 'authenticated' && !!selectedModel && !!input.trim() && !isSending,
    [status, selectedModel, input, isSending],
  );

  const sendButtonStyle = useMemo(() => {
    if (!canSend) {
      return {
        width: 40,
        height: 40,
        borderRadius: 12,
        background: isDarkMode ? '#334155' : '#e2e8f0',
        border: 'none',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: isDarkMode ? '#64748b' : '#94a3b8',
        transition: 'all 0.2s',
      } as const;
    }
    return {
      width: 40,
      height: 40,
      borderRadius: 12,
      background: '#2563eb',
      border: 'none',
      flexShrink: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 4px 12px rgba(37,99,235,0.25)',
      transition: 'all 0.2s',
      color: '#fff',
    } as const;
  }, [canSend, isDarkMode]);

  const shell = useMemo(
    () =>
      isDarkMode
        ? {
            title: '#f1f5f9',
            subtitle: '#94a3b8',
            border: '#334155',
            surface: '#1e293b',
            body: '#0f172a',
            userBubble: '#334155',
            userText: '#e2e8f0',
            assistantBubble: '#1e293b',
            assistantText: '#cbd5e1',
            inputBg: '#0f172a',
            muted: '#64748b',
          }
        : {
            title: '#0f172a',
            subtitle: '#64748b',
            border: '#e2e8f0',
            surface: '#fff',
            body: '#f8fafc',
            userBubble: 'var(--v3-primary, #4f46e5)',
            userText: '#fff',
            assistantBubble: '#fff',
            assistantText: '#334155',
            inputBg: '#fff',
            muted: '#94a3b8',
          },
    [isDarkMode],
  );

  const inputContainerStyle = useMemo(
    () => ({
      display: 'flex',
      background: isDarkMode ? shell.surface : 'var(--v3-surface, #fff)',
      borderRadius: 16,
      boxShadow: isInputFocused
        ? isDarkMode
          ? '0 20px 40px -10px rgba(99, 102, 241, 0.22), 0 0 0 4px rgba(165, 180, 252, 0.28)'
          : '0 20px 40px -10px rgba(99, 102, 241, 0.25), 0 0 0 4px rgba(99, 102, 241, 0.3)'
        : isDarkMode
          ? '0 10px 28px -6px rgba(0, 0, 0, 0.45), 0 0 0 2px rgba(99, 102, 241, 0.14)'
          : '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 0 0 2px rgba(99, 102, 241, 0.1)',
      border: 'none',
      overflow: 'visible',
      transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
      width: '100%',
      boxSizing: 'border-box' as const,
    }),
    [isInputFocused, isDarkMode, shell.surface],
  );

  const modelGroups = useMemo(
    () => groupModels(botsModels?.data?.models || []),
    [botsModels],
  );

  const thinkingLabel = t('chat.thinking', { defaultValue: '思考中...' });

  const isThinkingContent = useCallback(
    (content: string) => content === thinkingLabel,
    [thinkingLabel],
  );

  useEffect(() => {
    if (!open) return;
    if (selectedModel) return;
    const def = pickDefaultModelId(botsModels);
    if (def) setSelectedModel(def);
  }, [open, botsModels, selectedModel]);

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, open, isSending]);

  useEffect(() => {
    if (open) return;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
  }, [open]);

  const handleDrawerAfterOpen = useCallback(
    (visible: boolean) => {
      if (visible) focusInput();
    },
    [focusInput],
  );

  const handleClearCurrent = useCallback(() => {
    setMessages([]);
    focusInput();
  }, [focusInput]);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || !selectedModel || isSending) return;
    if (status !== 'authenticated') {
      antdMessage.warning(t('chat.gatewayConnecting', { defaultValue: '网关连接中，请稍候' }));
      return;
    }

    const userMsg: ModelChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    const prior = messages;
    const nextHistory = [...prior, userMsg];
    setMessages(nextHistory);
    setInput('');
    setIsSending(true);

    const apiMessages: ChatCompletionMessage[] = nextHistory
      .filter(m => !isThinkingContent(m.content))
      .map(m => ({
        role: m.role,
        content: m.content,
      }));

    const assistantId = `a-${Date.now()}`;
    const requestModelId = selectedModel;
    const assistantPlaceholder: ModelChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: thinkingLabel,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      modelId: requestModelId,
    };
    setMessages(prev => [...prev, assistantPlaceholder]);

    streamAbortRef.current?.abort();
    const abortController = new AbortController();
    streamAbortRef.current = abortController;

    let streamed = '';
    const startTime = performance.now();
    let ttftRecorded = false;

    const patchAssistant = (patch: Partial<Pick<ModelChatMessage, 'content' | 'ttft' | 'modelId'>>) => {
      setMessages(prev => prev.map(m => (m.id === assistantId ? { ...m, ...patch } : m)));
    };

    const recordTtftOnce = () => {
      if (ttftRecorded) return;
      ttftRecorded = true;
      patchAssistant({ ttft: Math.round(performance.now() - startTime), modelId: requestModelId });
    };

    try {
      const reply = await streamModelChatCompletions(selectedModel, apiMessages, {
        signal: abortController.signal,
        onDelta: chunk => {
          recordTtftOnce();
          streamed += chunk;
          patchAssistant({ content: streamed });
        },
      });
      recordTtftOnce();
      const trimmed = (reply || streamed || '').trim();
      patchAssistant({
        content: trimmed || t('chat.modelChatEmptyReply', { defaultValue: '（模型未返回内容）' }),
        modelId: requestModelId,
      });
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return;
      }
      const errMsg =
        err?.response?.data?.message ||
        err?.message ||
        t('chat.modelChatFailed', { defaultValue: '模型对话失败' });
      antdMessage.error(typeof errMsg === 'string' ? errMsg : t('chat.modelChatFailed', { defaultValue: '模型对话失败' }));
      setMessages(prev => prev.filter(m => m.id !== assistantId));
      setInput(text);
    } finally {
      if (streamAbortRef.current === abortController) {
        streamAbortRef.current = null;
      }
      setIsSending(false);
      if (!abortController.signal.aborted) {
        focusInput();
      }
    }
  }, [focusInput, input, isSending, isThinkingContent, messages, selectedModel, status, t, thinkingLabel]);

  const handleClose = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    onClose();
  }, [onClose]);

  return (
    <Drawer
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <MessageCircle size={18} color="var(--v3-primary, #6366f1)" />
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: shell.title }}>
              {t('chat.modelChatTitle', { defaultValue: '模型试聊' })}
            </div>
            <div style={{ fontSize: 11, color: shell.subtitle, fontWeight: 500 }}>
              {t('chat.modelChatSubtitle', { defaultValue: '选择模型独立对话，不影响主会话' })}
            </div>
          </div>
        </div>
      }
      placement="right"
      width={420}
      open={open}
      onClose={handleClose}
      afterOpenChange={handleDrawerAfterOpen}
      destroyOnClose={false}
      styles={{
        body: { padding: 0, display: 'flex', flexDirection: 'column', height: '100%', background: shell.body },
        header: { borderBottom: `1px solid ${shell.border}`, background: shell.surface },
      }}
      extra={
        <Button type="text" size="small" icon={<X size={16} />} onClick={handleClose} aria-label={t('common.close', { defaultValue: '关闭' })} />
      }
    >
      <div
        style={{
          padding: '10px 16px',
          background: isDarkMode ? 'rgba(99, 102, 241, 0.12)' : 'rgba(79, 70, 229, 0.06)',
          borderBottom: `1px solid ${shell.border}`,
          fontSize: 12,
          color: shell.subtitle,
          lineHeight: 1.5,
        }}
      >
        {t('chat.modelChatHint', { defaultValue: '用于测试模型以及简单问答用途' })}
      </div>
      <div style={{ padding: '10px 16px', borderBottom: `1px solid ${shell.border}`, background: shell.surface }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: shell.subtitle, marginBottom: 4 }}>
              {t('chat.modelChatSelectModel', { defaultValue: '选择模型' })}
            </div>
            <Select
          showSearch
          style={{ width: '100%' }}
          placeholder={t('chat.sessionModelPlaceholder', { defaultValue: '选择模型' })}
          value={selectedModel || undefined}
          onChange={setSelectedModel}
          disabled={isSending}
          optionFilterProp="label"
          dropdownStyle={{ borderRadius: 10 }}
        >
          {Object.keys(modelGroups)
            .sort()
            .map(provider => (
              <Select.OptGroup label={provider.toUpperCase()} key={provider}>
                {modelGroups[provider].map((m: any) => (
                  <Select.Option key={m.id} value={m.id} label={m.name || m.id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Cpu size={14} style={{ color: '#6366f1', flexShrink: 0 }} />
                      <span style={{ fontSize: 13 }}>{m.name || m.id}</span>
                    </div>
                  </Select.Option>
                ))}
              </Select.OptGroup>
            ))}
        </Select>
          </div>
          <Tooltip title={t('chat.modelChatClear', { defaultValue: '清空对话' })}>
            <Button
              type="text"
              icon={<Trash2 size={16} />}
              onClick={handleClearCurrent}
              disabled={messages.length === 0 || isSending}
              aria-label={t('chat.modelChatClear', { defaultValue: '清空对话' })}
              style={{
                flexShrink: 0,
                height: 32,
                width: 32,
                color: messages.length === 0 || isSending ? undefined : shell.muted,
              }}
            />
          </Tooltip>
        </div>
      </div>

      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '12px 16px',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {messages.length === 0 && !isSending && (
          <div style={{ textAlign: 'center', color: shell.muted, fontSize: 13, marginTop: 40, padding: '0 12px' }}>
            {t('chat.modelChatEmpty', { defaultValue: '选择模型后发送消息，可切换模型对比回复' })}
          </div>
        )}
        {messages.map(msg => {
          const isUser = msg.role === 'user';
          const isThinking = !isUser && isThinkingContent(msg.content);
          const showCopy = copyToClipboard && msg.content?.trim() && !isThinking;
          const showAssistantMeta = !isUser && !isThinking && (msg.modelId || (msg.ttft != null && msg.ttft > 0));
          return (
            <div
              key={msg.id}
              style={{
                display: 'flex',
                flexDirection: isUser ? 'row-reverse' : 'row',
                alignItems: 'flex-start',
                gap: 10,
                alignSelf: isUser ? 'flex-end' : 'flex-start',
                maxWidth: '100%',
              }}
            >
              <div style={{ flexShrink: 0, marginTop: 2 }}>
                {isUser ? (
                  <Avatar
                    size={32}
                    icon={<User size={16} />}
                    style={{ background: isDarkMode ? '#475569' : '#1e293b' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: isDarkMode ? 'rgba(99, 102, 241, 0.2)' : '#eef2ff',
                      border: isDarkMode ? '1px solid #475569' : '1px solid #c7d2fe',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <Bot size={18} color="var(--v3-primary, #6366f1)" />
                  </div>
                )}
              </div>
              <div
                style={{
                  maxWidth: 'calc(100% - 42px)',
                  padding: '8px 12px',
                  borderRadius: isUser ? '12px 12px 4px 12px' : '12px 12px 12px 4px',
                  background: isUser ? shell.userBubble : shell.assistantBubble,
                  color: isUser ? shell.userText : shell.assistantText,
                  border: isUser ? 'none' : `1px solid ${shell.border}`,
                  fontSize: 13,
                  lineHeight: 1.55,
                  boxShadow: isUser ? 'none' : '0 1px 3px rgba(0,0,0,0.04)',
                }}
              >
              {isThinking ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    color: shell.muted,
                    fontSize: 13,
                  }}
                >
                  <Loader2 size={16} strokeWidth={2} className="v3-thinking-spinner" aria-hidden />
                  <span>{thinkingLabel}</span>
                </div>
              ) : (
                <V3ModelChatMarkdown content={msg.content} isDarkMode={isDarkMode} isUser={isUser} />
              )}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: isUser ? 'flex-end' : 'flex-start',
                  gap: 6,
                  marginTop: 4,
                  fontSize: 10,
                  opacity: 0.85,
                  flexWrap: 'wrap',
                }}
              >
                {showCopy && (
                  <Tooltip title={t('chat.copy', { defaultValue: '复制' })}>
                    <Button
                      type="text"
                      size="small"
                      icon={<Copy size={11} />}
                      onClick={() => copyToClipboard!(msg.content)}
                      style={{
                        height: 20,
                        width: 20,
                        minWidth: 20,
                        padding: 0,
                        color: isUser ? 'rgba(255,255,255,0.85)' : shell.muted,
                      }}
                    />
                  </Tooltip>
                )}
                {showAssistantMeta && (
                  <>
                    {msg.ttft != null && msg.ttft > 0 && (
                      <>
                        {showCopy && (
                          <div
                            style={{
                              width: 1,
                              height: 8,
                              background: isDarkMode ? '#475569' : '#e2e8f0',
                              flexShrink: 0,
                            }}
                          />
                        )}
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            fontSize: 9,
                            fontFamily: 'monospace',
                            color: shell.muted,
                          }}
                          title={t('chat.modelChatTtft', { defaultValue: '首 token 延迟 (TTFT)' })}
                        >
                          <Zap size={10} color="#f59e0b" fill="#f59e0b" />
                          {msg.ttft}ms
                        </span>
                      </>
                    )}
                    {msg.modelId && (
                      <span
                        style={{
                          fontSize: 9,
                          fontFamily: 'monospace',
                          color: shell.muted,
                          maxWidth: 140,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={msg.modelId}
                      >
                        {msg.modelId}
                      </span>
                    )}
                  </>
                )}
                <span style={{ color: isUser ? 'rgba(255,255,255,0.65)' : shell.muted }}>{msg.timestamp}</span>
              </div>
              </div>
            </div>
          );
        })}
      </div>

      <div
        style={{
          padding: '14px 16px',
          borderTop: `1px solid ${shell.border}`,
          background: shell.surface,
        }}
      >
        <div style={inputContainerStyle} className="input-container-v3">
          <div
            className={`v3-input-wrapper ${isInputFocused ? 'focused' : ''} ${isDarkMode ? 'v3-input-wrapper--dark' : ''}`}
            style={{ width: '100%' }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: 8,
                padding: '8px 12px 10px',
                boxSizing: 'border-box',
              }}
            >
              <div style={{ flex: 1, position: 'relative', minWidth: 0 }}>
                <Input.TextArea
                  ref={inputRef}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={t('chat.modelChatInputPlaceholder', {
                    defaultValue: '输入消息，Enter 发送，Shift+Enter 换行',
                  })}
                  autoSize={{ minRows: 3, maxRows: 8 }}
                  variant="borderless"
                  disabled={!selectedModel || isSending || status !== 'authenticated'}
                  onFocus={() => setIsInputFocused(true)}
                  onBlur={() => setIsInputFocused(false)}
                  onPressEnter={e => {
                    if (!e.shiftKey) {
                      e.preventDefault();
                      void handleSend();
                    }
                  }}
                  style={{
                    padding: '4px 0',
                    fontSize: 13,
                    lineHeight: 1.55,
                    minHeight: 32,
                    color: isDarkMode ? '#e2e8f0' : undefined,
                    background: 'transparent',
                  }}
                />
              </div>
              <Button
                type="primary"
                icon={<Send size={17} />}
                onClick={() => void handleSend()}
                loading={isSending}
                disabled={!canSend}
                style={sendButtonStyle as CSSProperties}
              />
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
