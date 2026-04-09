import React, { useMemo } from 'react';
import { Avatar, Tooltip, Button, Input } from 'antd';
import { User, Bot, Copy, Quote, Pencil, RefreshCw, Zap, Cpu, Terminal, CheckCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeSanitize from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import { Mermaid, CodeBlock } from '../ChatComponents';

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

const V3MessageItem: React.FC<V3MessageItemProps> = ({
  msg, index, isMobile, showThinking,
  editingMsgIndex, editContent, setEditContent,
  onEdit, onSaveEdit, onCancelEdit, onQuote, onRegenerate,
  copyToClipboard, isTyping, isLast, isStalled, tpsData, t
}) => {
  
  // 核心优化：只有内容或设置变化时才重新处理正则
  const processedContent = useMemo(() => {
    let content = msg.content;
    if (!showThinking) {
      const isMetaOnly = content.includes(':::thinking') || 
                         content.includes(':::toolCall') || 
                         content.includes(':::toolResult');
      
      const cleanText = content
        .replace(/> :::thinking[\s\S]*?:::/g, '')
        .replace(/> :::toolCall[\s\S]*?:::/g, '')
        .replace(/> :::toolResult[\s\S]*?:::/g, '')
        .trim();
      
      if (isMetaOnly && !cleanText) return null;
      content = cleanText;
    }
    return content;
  }, [msg.content, showThinking]);

  if (processedContent === null) return null;

  const isUser = msg.role === 'user';

  return (
    <div 
      className="message-in" 
      style={{ 
        display: 'flex', gap: 14, flexDirection: isUser ? 'row-reverse' : 'row', marginBottom: 20,
        animation: 'v3-message-enter 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) forwards' 
      }}
    >
      {isUser ? (
        <Avatar icon={<User size={18} />} style={{ background: '#1e293b', flexShrink: 0, marginTop: 4, boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }} />
      ) : (
        <div style={{ flexShrink: 0, marginTop: 4 }}>
          <div style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: '50%', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #c7d2fe' }}>
            <Bot size={isMobile ? 22 : 25} color="#6366f1" />
          </div>
        </div>
      )}
      
      <div style={{ 
        maxWidth: isMobile ? '92%' : '85%', padding: isMobile ? '10px 14px' : '12px 18px', borderRadius: isUser ? '18px 18px 4px 18px' : '4px 18px 18px 18px', 
        background: isUser ? '#2563eb' : '#fff',
        color: isUser ? '#fff' : '#1e293b',
        boxShadow: isUser ? '0 4px 15px rgba(37, 99, 235, 0.15)' : '0 4px 12px rgba(0,0,0,0.03)',
        border: !isUser ? '1px solid #e8eff6' : 'none',
        position: 'relative', wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0,
      }}>
        {editingMsgIndex === index ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: isMobile ? 220 : 400 }}>
            <Input.TextArea
              autoFocus
              autoSize={{ minRows: 2, maxRows: 15 }}
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              style={{ borderRadius: 12, border: '1px solid rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.1)', color: isUser ? '#fff' : '#1e293b', fontSize: isMobile ? 13 : 14 }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button size="small" ghost={isUser} onClick={onCancelEdit}>{t('common.cancel')}</Button>
              <Button size="small" style={{ background: '#fff', color: '#2563eb', border: 'none', fontWeight: 600 }} onClick={onSaveEdit}>{t('chat.saveAndRegenerate', { defaultValue: '重新生成' })}</Button>
            </div>
          </div>
        ) : (
          msg.content === t('chat.thinking') ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, color: '#64748b' }}>{msg.content}</span>
              <div className="typing-indicator" style={{ display: 'flex', gap: 4 }}>
                <div className="typing-dot" style={{ width: 4, height: 4, background: '#2563eb', borderRadius: '50%' }}></div>
                <div className="typing-dot" style={{ width: 4, height: 4, background: '#2563eb', borderRadius: '50%' }}></div>
                <div className="typing-dot" style={{ width: 4, height: 4, background: '#2563eb', borderRadius: '50%' }}></div>
              </div>
            </div>
          ) : (
            <>
              <div className="markdown-body-v3">
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
                      if (fullText.includes(':::thinking')) return <div className="v3-thought-container"><div className="v3-thought-header"><Cpu size={12} /><span>Thinking Process</span></div>{children}</div>;
                      if (fullText.includes(':::toolCall')) return <div className="v3-tool-call-container"><div className="v3-tool-header"><Terminal size={12} /><span>System Tool</span></div>{children}</div>;
                      if (fullText.includes(':::toolResult')) return <div className="v3-tool-result-container"><div className="v3-tool-result-header"><CheckCircle size={12} /><span>Tool Output</span></div>{children}</div>;
                      return <blockquote style={{ borderLeft: '4px solid #e2e8f0', paddingLeft: '12px', color: '#64748b', fontStyle: 'italic', margin: '8px 0' }}>{children}</blockquote>;
                    },
                    code: ({ inline, className, children, ...props }: any) => {
                      const match = /language-(\w+)/.exec(className || '');
                      const language = match ? match[1] : '';
                      if (!inline && language === 'mermaid') return <Mermaid chart={String(children).replace(/\n$/, '')} />;
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
                    <Tooltip title={t('chat.copy', { defaultValue: '复制' })}><Button type="text" size="small" icon={<Copy size={11} />} onClick={() => copyToClipboard(msg.content)} style={{ color: isUser ? 'rgba(255,255,255,0.85)' : '#64748b' }} /></Tooltip>
                    <Tooltip title={t('chat.reply', { defaultValue: '引用' })}><Button type="text" size="small" icon={<Quote size={11} />} onClick={() => onQuote(msg.content)} style={{ color: isUser ? 'rgba(255,255,255,0.85)' : '#64748b' }} /></Tooltip>
                    {isUser && <Tooltip title={t('common.edit', { defaultValue: '编辑' })}><Button type="text" size="small" icon={<Pencil size={11} />} onClick={() => onEdit(index, msg.content)} style={{ color: 'rgba(255,255,255,0.85)' }} /></Tooltip>}
                    {!isUser && isLast && <Tooltip title={t('chat.retry', { defaultValue: '重试' })}><Button type="text" size="small" icon={<RefreshCw size={11} />} onClick={onRegenerate} style={{ color: '#64748b' }} /></Tooltip>}
                  </div>
                )}
                <span>{msg.timestamp}</span>
                {!isMobile && !isUser && msg.metrics && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
                    <div style={{ width: 1, height: 8, background: '#e2e8f0' }}></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, fontSize: 9, fontFamily: 'monospace' }}>
                      <Zap size={10} color="#f59e0b" fill="#f59e0b" /><span>{msg.metrics.ttft}ms</span>
                    </div>
                    {msg.metrics.tps && <div style={{ display: 'flex', alignItems: 'center' }}><span style={{ fontSize: 9, fontFamily: 'monospace' }}>{msg.metrics.tps.toFixed(1)} ch/s</span>{isTyping && isLast && tpsData && <Sparkline data={tpsData} />}</div>}
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
  // 核心优化：只有在内容、编辑状态或关键状态发生变化时才重绘
  return prev.editContent === next.editContent && // 必须包含编辑内容，否则无法输入
         prev.editingMsgIndex === next.editingMsgIndex &&
         prev.msg.content === next.msg.content &&
         prev.showThinking === next.showThinking &&
         prev.isTyping === next.isTyping &&
         prev.isLast === next.isLast &&
         prev.isStalled === next.isStalled &&
         (prev.tpsData?.length === next.tpsData?.length);
});
