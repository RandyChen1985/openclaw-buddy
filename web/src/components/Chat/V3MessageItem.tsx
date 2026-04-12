import React, { useMemo, useState, useEffect } from 'react';
import { Avatar, Tooltip, Button, Input, message } from 'antd';
import { 
  User, Bot, Copy, Quote, Pencil, RefreshCw, Zap, Cpu, Terminal, 
  FileText, ChevronRight, ShieldAlert, ShieldCheck 
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import { Mermaid, CodeBlock, ECharts } from '../ChatComponents';

interface V3MessageItemProps {
  msg: any;
  index: number;
  isMobile: boolean;
  showThinking: boolean;
  selectedBot: string;
  editingMsgIndex: number | null;
  editContent: string;
  setEditContent: (val: string) => void;
  onEdit: (index: number, content: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (index: number) => void;
  onQuote: (content: string) => void;
  onSend: (content: string) => void; // 新增：直接发送
  onRegenerate: () => void;
  copyToClipboard: (text: string) => void;
  isTyping: boolean;
  isLast: boolean;
  isStalled?: boolean;
  tpsData?: number[];
  t: any;
}

const Sparkline = ({ data }: { data: number[] }) => {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const height = 12;
  const width = 40;
  const step = width / (data.length - 1);
  const points = data.map((d, i) => `${i * step},${height - (d / max) * height}`).join(' ');
  
  return (
      <svg width={width} height={height} style={{ marginLeft: 6 }}>
          <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
  );
};

const CollapsibleMeta = ({ title, icon: Icon, children, defaultExpanded = true }: any) => {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded);

  React.useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  return (
    <div className={`v3-meta-collapsible ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div 
        className="v3-meta-header" 
        onClick={() => setIsExpanded(!isExpanded)}
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, opacity: 0.8, fontSize: 12, padding: '4px 0' }}
      >
        <div style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'flex', alignItems: 'center' }}>
          <ChevronRight size={12} />
        </div>
        <Icon size={12} />
        <span style={{ fontWeight: 500 }}>{title}</span>
      </div>
      {isExpanded && (
        <div className="v3-meta-content" style={{ animation: 'v3-fade-in 0.3s' }}>
          {children}
        </div>
      )}
    </div>
  );
};

const V3MessageItem: React.FC<V3MessageItemProps> = ({ 
  msg, index, isMobile, showThinking,
  editingMsgIndex, editContent, setEditContent,
  onEdit, onSaveEdit, onCancelEdit, onQuote, onSend, onRegenerate,
  copyToClipboard, isTyping, isLast, isStalled, tpsData, t
}) => {
  const [thinkingSeconds, setThinkingSeconds] = useState(0);

  const processedContent = useMemo(() => {
    let content = msg.content;
    
    // 1. :::toolResult 物理隐藏
    content = content.replace(/> :::toolResult[\s\S]*?:::\n*/g, '');

    // 注意：不要在此处剔除 :::approval，否则 blockquote 渲染器无法捕获并渲染卡片

    if (!showThinking) {
      content = content
        .replace(/> :::thinking[\s\S]*?:::\n*/g, '')
        .replace(/> :::toolCall[\s\S]*?:::\n*/g, '')
        .trim();
      
      if (!content && (msg.content.includes(':::thinking') || msg.content.includes(':::toolCall'))) return null;
    }

    return content.trim();
  }, [msg.content, showThinking]);

  const isUser = msg.role === 'user';
  const hasApproval = msg.content.includes(':::approval');
  const isThinkingState = msg.content === t('chat.thinking') || (!processedContent && isTyping && isLast && !isUser);

  useEffect(() => {
    let interval: any;
    if (isThinkingState) {
      interval = setInterval(() => {
        setThinkingSeconds((s: number) => s + 1);
      }, 1000);
    } else {
      setThinkingSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isThinkingState]);

  if (!processedContent && !(isTyping && isLast && !isUser) && !hasApproval) return null;

  return (
    <div 
      className="message-in" 
      style={{ 
        display: 'flex', gap: 14, flexDirection: isUser ? 'row-reverse' : 'row',
        animation: 'v3-message-enter 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) forwards' 
      }}
    >
      {isUser ? (
        <Avatar icon={<User size={18} />} style={{ background: '#1e293b', flexShrink: 0, marginTop: 4, visibility: 'visible' }} />
      ) : (
        <div style={{ flexShrink: 0, marginTop: 4, visibility: 'visible' }}>
          <div style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: '50%', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #c7d2fe' }}>
            <Bot size={isMobile ? 22 : 25} color="#6366f1" />
          </div>
        </div>
      )}
      
      <div style={{ 
        maxWidth: isMobile ? '92%' : '85%', padding: isMobile ? '10px 14px' : '12px 18px', borderRadius: isUser ? '18px 18px 4px 18px' : '4px 18px 18px 18px', 
        background: isUser ? '#4f46e5' : '#fff', color: isUser ? '#fff' : '#1e293b',
        boxShadow: isUser ? '0 4px 15px rgba(79, 70, 229, 0.15)' : '0 4px 12px rgba(0,0,0,0.03)',
        border: !isUser ? '1px solid #e8eff6' : 'none',
        position: 'relative', wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0,
      }}>
        {editingMsgIndex === index ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: isMobile ? 220 : 400 }}>
            <Input.TextArea
              autoFocus autoSize={{ minRows: 2, maxRows: 15 }} value={editContent}
              onChange={e => setEditContent(e.target.value)}
              style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.1)', color: isUser ? '#fff' : '#1e293b', fontSize: isMobile ? 13 : 14 }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button size="small" ghost={isUser} onClick={onCancelEdit}>{t('common.cancel')}</Button>
              <Button size="small" style={{ background: '#fff', color: '#2563eb', border: 'none', fontWeight: 600 }} onClick={onSaveEdit}>{t('chat.saveAndRegenerate', { defaultValue: '重新生成' })}</Button>
            </div>
          </div>
        ) : (
          isThinkingState ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#64748b' }}>{t('chat.thinking')}{thinkingSeconds > 0 ? ` (${thinkingSeconds}s)` : ''}</span>
              <div className="typing-indicator" style={{ display: 'flex', gap: 4 }}>
                <div className="typing-dot" style={{ width: 4, height: 4, background: '#2563eb', borderRadius: '50%' }}></div>
                <div className="typing-dot" style={{ width: 4, height: 4, background: '#2563eb', borderRadius: '50%' }}></div>
                <div className="typing-dot" style={{ width: 4, height: 4, background: '#2563eb', borderRadius: '50%' }}></div>
              </div>
            </div>
          ) : (
            <>
              <div className="markdown-body-v3" id={`msg-content-v3-${index}`}>
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} 
                  rehypePlugins={[rehypeSanitize, rehypeKatex]}
                  components={{
                    p: ({children}: any) => <p style={{margin: 0, wordBreak: 'break-word', overflowWrap: 'anywhere'}}>{children}</p>,
                    img: ({ node, ...props }: any) => (
                      <img 
                        {...props} 
                        style={{ maxWidth: '100%', borderRadius: 8, marginTop: 8, cursor: 'zoom-in', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }} 
                        onClick={() => window.open(props.title || props.src, '_blank')}
                      />
                    ),
                    pre: ({children}: any) => <pre style={{ overflowX: 'auto', maxWidth: '100%', margin: '8px 0', padding: '10px', background: '#f8fafc', borderRadius: 8 }}>{children}</pre>,
                    blockquote: ({ children }: any) => {
                      const extractText = (node: any): string => {
                        if (typeof node === 'string') return node;
                        if (Array.isArray(node)) return node.map(extractText).join('');
                        if (node?.props?.children) return extractText(node.props.children);
                        return '';
                      };
                      const fullText = extractText(children);
                      if (fullText.includes(':::thinking')) {
                        return <CollapsibleMeta title={t('chat.thinkingProcess', { defaultValue: 'Thinking Process' })} icon={Cpu} defaultExpanded={false}>{children}</CollapsibleMeta>;
                      }
                      if (fullText.includes(':::toolCall')) {
                        return <CollapsibleMeta title={t('chat.systemTool', { defaultValue: 'System Tool' })} icon={Terminal} defaultExpanded={false}>{children}</CollapsibleMeta>;
                      }
                      if (fullText.includes(':::approval')) {
                        // 改进的 Slug 提取：支持加粗、原样或独立单词
                        const slugMatch = /\*\*([a-f0-9]{8,})\*\*/.exec(fullText) || /([a-f0-9]{8,})/.exec(fullText);
                        const slug = slugMatch ? (slugMatch[1] || slugMatch[0]) : '';
                        return (
                          <div style={{ 
                            margin: '12px 0', padding: '16px', background: '#fef2f2', 
                            border: '1px solid #fee2e2', borderRadius: 12,
                            boxShadow: '0 2px 8px rgba(239, 68, 68, 0.05)'
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: '#ef4444' }}>
                              <ShieldAlert size={18} />
                              <span style={{ fontWeight: 600, fontSize: 14 }}>{t('chat.approvalRequired')}</span>
                            </div>
                            <div style={{ marginBottom: 12, opacity: 0.9 }}>{children}</div>
                            <Button 
                              type="primary" danger block icon={<ShieldCheck size={16} />}
                              onClick={() => {
                                if (slug) {
                                  onSend(`/approve ${slug} allow-once`);
                                  message.success(t('chat.approvalSent', { defaultValue: '已提交审批指令' }));
                                }
                              }}
                              style={{ borderRadius: 8, fontWeight: 600, height: 36 }}
                            >
                              {t('chat.approveNow')}
                            </Button>
                          </div>
                        );
                      }
                      // 💡 关键新增：渲染未知/警告块
                      if (fullText.includes(':::warning')) {
                        return (
                          <div style={{ 
                            margin: '12px 0', padding: '12px', background: '#fffbeb', 
                            border: '1px solid #fef3c7', borderRadius: 8,
                            fontSize: 12
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: '#d97706' }}>
                              <ShieldAlert size={14} />
                              <span style={{ fontWeight: 600 }}>{fullText.split('\n')[0].replace('> :::warning ', '')}</span>
                            </div>
                            {children}
                          </div>
                        );
                      }
                      return <blockquote style={{ borderLeft: '4px solid #e2e8f0', paddingLeft: '12px', color: '#64748b', fontStyle: 'italic', margin: '8px 0' }}>{children}</blockquote>;
                    },
                    code: ({ inline, className, children, ...props }: any) => {
                      const match = /language-(\w+)/.exec(className || '');
                      const language = match ? match[1] : '';
                      if (!inline && language === 'mermaid') return <Mermaid chart={String(children).replace(/\n$/, '')} />;
                      if (!inline && language === 'echarts') return <ECharts optionStr={String(children).replace(/\n$/, '')} isTyping={isLast && isTyping} />;
                      if (!inline && language) return <CodeBlock language={language} value={String(children).replace(/\n$/, '')} isMobile={isMobile} {...props} />;
                      return <code {...props} style={{ padding: '0.2em 0.4em', backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : 'rgba(175, 184, 193, 0.2)', borderRadius: '6px', fontSize: '85%' }}>{children}</code>;
                    }
                  }}
                >
                  {processedContent}
                </ReactMarkdown>
              </div>

              {isStalled && isTyping && isLast && msg.role === 'assistant' && (
                <div style={{ marginTop: 8, padding: '4px 10px', background: '#f8fafc', borderRadius: 8, border: '1px dashed #e2e8f0', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div className="typing-dot" style={{ width: 4, height: 4, background: '#94a3b8' }}></div>
                  <span style={{ fontSize: 11, color: '#94a3b8', fontStyle: 'italic' }}>AI 正在深度思考中...</span>
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: isUser ? 'flex-end' : 'flex-start', gap: 6, marginTop: 6, fontSize: 10, color: isUser ? 'rgba(255,255,255,0.7)' : '#94a3b8' }} className="msg-footer">
                {!(isTyping && isLast) && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    <Tooltip title={t('chat.copy')}><Button type="text" size="small" icon={<Copy size={11} />} onClick={() => copyToClipboard(msg.content)} style={{ color: isUser ? 'rgba(255,255,255,0.85)' : '#64748b' }} /></Tooltip>
                    <Tooltip title={t('chat.reply')}><Button type="text" size="small" icon={<Quote size={11} />} onClick={() => onQuote(msg.content)} style={{ color: isUser ? 'rgba(255,255,255,0.85)' : '#64748b' }} /></Tooltip>
                    {!isUser && (
                      <Tooltip title={t('chat.exportPDF')}>
                        <Button 
                          type="text" size="small" icon={<FileText size={11} />} 
                          onClick={async () => {
                            const element = document.getElementById(`msg-content-v3-${index}`);
                            if (!element) return;
                            const hide = message.loading(t('chat.exporting'), 0);
                            try {
                              const html2pdf = (await import('html2pdf.js')).default;
                              const opt = {
                                margin: 10, filename: `Message_${index + 1}.pdf`, image: { type: 'jpeg' as const, quality: 0.98 },
                                html2canvas: { scale: 2, useCORS: true, logging: false, onclone: (clonedDoc: Document) => {
                                    const clonedEl = clonedDoc.getElementById(`msg-content-v3-${index}`);
                                    if (clonedEl) { clonedEl.style.width = '1100px'; clonedEl.style.padding = '40px'; clonedEl.style.background = '#fff'; clonedEl.style.color = '#000'; clonedEl.style.borderRadius = '0'; clonedEl.style.boxShadow = 'none'; clonedEl.style.border = 'none'; clonedEl.style.maxWidth = 'none'; }
                                  }
                                },
                                jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'landscape' as const }
                              };
                              await html2pdf().from(element).set(opt).save();
                              message.success(t('chat.exportSuccess'));
                            } catch (err) { message.error(t('chat.exportFailed')); } finally { hide(); }
                          }} 
                          style={{ color: '#64748b' }} 
                        />
                      </Tooltip>
                    )}
                    {isUser && <Tooltip title={t('common.edit')}><Button type="text" size="small" icon={<Pencil size={11} />} onClick={() => onEdit(index, msg.content)} style={{ color: 'rgba(255,255,255,0.85)' }} /></Tooltip>}
                    {!isUser && isLast && <Tooltip title={t('chat.retry')}><Button type="text" size="small" icon={<RefreshCw size={11} />} onClick={onRegenerate} style={{ color: '#64748b' }} /></Tooltip>}
                  </div>
                )}
                <span>{msg.timestamp}</span>
                {!isMobile && !isUser && msg.metrics && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
                    <div style={{ width: 1, height: 8, background: '#e2e8f0' }}></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, fontFamily: 'monospace' }}>
                      <Zap size={10} color="#f59e0b" fill="#f59e0b" /><span>{msg.metrics.ttft}ms</span>
                    </div>
                    {msg.metrics.tps && <div style={{ display: 'flex', alignItems: 'center' }}><span style={{ fontSize: 9, fontFamily: 'monospace' }}>~{msg.metrics.tps.toFixed(1)} ch/s</span>{isTyping && isLast && tpsData && <Sparkline data={tpsData} />}</div>}
                    {msg.metrics.duration && <span style={{ fontSize: 9, color: '#10b981', fontFamily: 'monospace', fontWeight: 600 }}>{msg.metrics.duration.toFixed(1)}s</span>}
                  </div>
                )}
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
};

export default React.memo(V3MessageItem, (prev, next) => {
  return prev.editContent === next.editContent && 
         prev.editingMsgIndex === next.editingMsgIndex &&
         prev.msg.content === next.msg.content &&
         prev.showThinking === next.showThinking &&
         prev.isTyping === next.isTyping &&
         prev.isLast === next.isLast &&
         prev.isStalled === next.isStalled &&
         (prev.tpsData?.length === next.tpsData?.length);
});
