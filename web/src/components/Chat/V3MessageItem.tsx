import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Avatar, Tooltip, Button, Input, message } from 'antd';
import { 
  User, Bot, Copy, Quote, Pencil, RefreshCw, Zap, Cpu, Terminal, 
  FileText, ChevronRight, ChevronDown, ShieldAlert, ShieldCheck, ListTodo, Loader2, Layers
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkMath from 'remark-math';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import rehypeKatex from 'rehype-katex';
import { defaultUrlTransform } from 'react-markdown';

const katexSanitizeSchema: typeof defaultSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    '*': [...(defaultSchema.attributes?.['*'] || []), 'className', 'style'],
    a: [...(defaultSchema.attributes?.a || []), 'href', 'target', 'rel']
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ['http', 'https', 'mailto', 'tel', 'quick']
  },
  tagNames: [
    ...(defaultSchema.tagNames || []),
    'math', 'semantics', 'mrow', 'mi', 'mn', 'mo', 'ms', 'mtext',
    'msup', 'msub', 'mfrac', 'mroot', 'msqrt', 'mover', 'munder',
    'mtable', 'mtr', 'mtd', 'annotation'
  ]
};
import { Mermaid, CodeBlock, ECharts, isEchartsCodeFenceLanguage } from '../ChatComponents';

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
  onSend: (content: string) => void;
  onRegenerate: () => void;
  copyToClipboard: (text: string) => void;
  isTyping: boolean;
  isLast: boolean;
  isStalled?: boolean;
  tpsData?: number[];
  /** 主气泡是否已开始吐出正文（用于自动折叠底部 meta 折叠区） */
  mainHasTranscript?: boolean;
  /** 主气泡底部要嵌入的「本次推理与工具调用」内容（来自同 runId 的 _uiMetaOnly 气泡） */
  metaContent?: string;
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

const CollapsibleMeta = ({ title, icon: Icon, children, defaultExpanded = false }: any) => {
  const [isExpanded, setIsExpanded] = React.useState(defaultExpanded);

  React.useEffect(() => {
    setIsExpanded(defaultExpanded);
  }, [defaultExpanded]);

  return (
    <div className={`v3-meta-collapsible ${isExpanded ? 'expanded' : 'collapsed'}`}>
      <div 
        className="v3-meta-header" 
        onClick={() => setIsExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        <div style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <ChevronRight size={14} strokeWidth={2} />
        </div>
        <Icon size={14} strokeWidth={2} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, lineHeight: 1.4 }}>{title}</span>
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
  copyToClipboard, isTyping, isLast, isStalled, tpsData, mainHasTranscript, metaContent, t
}) => {
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  // 防止审批按钮重复点击：记录每个 approvalId 是否已点击过“通过”
  const [approvalClicked, setApprovalClicked] = useState<Record<string, boolean>>({});

  const processedContent = useMemo(() => {
    let content = (msg.content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 0. 清掉 agent 流写入的 itemId HTML 注释（仅用于内部 upsert 定位，不应展示）
    content = content.replace(/(?:^|\n)\s*>\s*<!--agentItem:[^>]*-->\s*/g, '\n');

    // 1. :::toolResult 物理隐藏
    content = content.replace(/> :::toolResult[\s\S]*?:::\n*/g, '');

    // 审批卡片：保留 :::approval 标记（blockquote 渲染器依赖），但剔除元信息行
    content = content.replace(
      /(> :::approval\n)([\s\S]*?)(> :::\n*)/g,
      (_match: string, head: string, body: string, tail: string) => {
        const cleanBody = body
          .split('\n')
          .filter((line: string) => {
            const trimmed = line.replace(/^>\s?/, '').trim();
            if (!trimmed) return false;
            if (trimmed === ':::approval' || trimmed === ':::') return false;
            if (/^approvalId:\s*/i.test(trimmed)) return false;
            // slug 行（纯 hex 或加粗 hex）由卡片标题展示，不在 body 里重复
            if (/^\*\*[a-f0-9]{8,}\*\*$/.test(trimmed) || /^[a-f0-9]{8,}$/.test(trimmed)) return false;
            // "— ✅/❌/⏱️" 状态行保留（已由 resolved handler 写入）
            return true;
          })
          .join('\n');
        return head + cleanBody + '\n' + tail;
      }
    );

    if (!showThinking) {
      // 与 useV3Messages.handleSessionTool / isAssistantToolishForThinkingMerge 对齐：可有可选的 > 符号，工具名至少 1 字符
      const toolStatusLineRe =
        /(?:^|\n)\s*(?:>\s*)?[🔧✅❌]\s*`[^`]+`\s*(?:执行中(?:…|\.\.\.)|完成|失败)(?:\s*<!--[\s\S]*?-->)?/g;
      content = content
        .replace(/(?:>\s*)?:::thinking[\s\S]*?(?::::|$)\n*/g, '')
        .replace(/(?:>\s*)?:::toolCall[\s\S]*?(?::::|$)\n*/g, '')
        .replace(/(?:>\s*)?:::plan[\s\S]*?(?::::|$)\n*/g, '')
        .replace(/(?:>\s*)?:::commandOutput[\s\S]*?(?::::|$)\n*/g, '')
        .replace(toolStatusLineRe, '')
        // 仅去掉 session.tool 注入的 marker，避免残留 HTML 注释单独成条
        .replace(/<!--\s*tool:[^>]*-->/g, '')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      if (
        !content &&
        (msg.content.includes(':::thinking') ||
          msg.content.includes(':::toolCall') ||
          msg.content.includes(':::plan') ||
          msg.content.includes(':::commandOutput') ||
          msg.content.includes('🔧') ||
          msg.content.includes('✅') ||
          msg.content.includes('❌') ||
          /<!--\s*tool:/.test(msg.content))
      ) {
        return null;
      }
    }

    return content.trim();
  }, [msg.content, showThinking]);

  const isUser = msg.role === 'user';
  const isMetaOnly = !!(msg as any)._uiMetaOnly;
  const hasApproval = msg.content.includes(':::approval');

  // metaContent 只做轻量预处理：清掉内部 upsert 用的 itemId 注释即可，
  // 保留所有 :::thinking / :::plan / :::toolCall / :::commandOutput 块供 blockquote 渲染器展开为 CollapsibleMeta
  const processedMetaContent = useMemo(() => {
    if (!metaContent) return '';
    return metaContent.replace(/(?:^|\n)\s*>\s*<!--agentItem:[^>]*-->\s*/g, '\n').trim();
  }, [metaContent]);

  const hasEmbeddedMeta = !isMetaOnly && !isUser && !!processedMetaContent;

  // 思考信息折叠区的折叠策略（独立 meta 气泡 & 嵌入主气泡底部 meta 区）：
  // - 默认折叠，避免流式阶段工具/Command Output 展开导致整屏高度跳动
  // - 用户点击标题栏可展开查看；手动展开/折叠后不再自动改（metaUserToggledRef）
  const metaSectionActive = isMetaOnly || hasEmbeddedMeta;
  /**
   * 折叠条「生成中」动效与 live 样式：整条助手回复在生成时（isTyping）即展示，不能绑在 !mainHasTranscript 上，
   * 否则主气泡一旦吐字「仅无正文」条件恒为 false，转圈/思考中前缀永远不会出现。
   */
  const metaFoldGenerationUi =
    metaSectionActive && msg.role === 'assistant' && !!(isTyping && isLast);
  /** 与 session.tool / meta 块里的「🔧 … 执行中」对齐，用于折叠条副文案 */
  const rawMetaForFoldHint = useMemo(() => {
    if (isMetaOnly) return String(msg.content || '').replace(/\r\n/g, '\n');
    return String(metaContent || '').replace(/\r\n/g, '\n');
  }, [isMetaOnly, msg.content, metaContent]);
  const metaFoldIsToolCallGenerating = useMemo(() => {
    if (!metaFoldGenerationUi || !rawMetaForFoldHint) return false;
    const s = rawMetaForFoldHint;
    return /执行中/.test(s) && (/🔧/.test(s) || /:::toolCall/i.test(s));
  }, [metaFoldGenerationUi, rawMetaForFoldHint]);
  const [metaExpanded, setMetaExpanded] = useState(false);
  const metaUserToggledRef = useRef<boolean>(false);

  /** 主气泡开始吐字后自动收起 meta，避免正文与附录同时抢高度（用户已手动展开/折叠则尊重） */
  useEffect(() => {
    if (!metaSectionActive || metaUserToggledRef.current) return;
    if (mainHasTranscript) setMetaExpanded(false);
  }, [metaSectionActive, mainHasTranscript]);

  const toggleMetaExpanded = () => {
    metaUserToggledRef.current = true;
    setMetaExpanded((v) => !v);
  };

  // 从原始消息提取完整 approvalId（UUID），供 /approve 用户消息与网关一致
  const approvalMeta = useMemo(() => {
    if (!hasApproval) return { slug: '', approvalId: '' };
    const raw = msg.content;
    const idMatch = /approvalId:\s*([A-Za-z0-9-]+)/.exec(raw) || /approvalId\s*=\s*([A-Za-z0-9-]+)/.exec(raw);
    const slugMatch = /\*\*([a-f0-9]{8,})\*\*/.exec(raw) || /([a-f0-9]{8,})/.exec(raw);
    const slug = slugMatch ? (slugMatch[1] || slugMatch[0]) : '';
    const approvalId = idMatch ? idMatch[1] : slug;
    return { slug, approvalId };
  }, [hasApproval, msg.content]);
  const rawIsDeepThinking = msg.content === t('chat.deepThinking', { defaultValue: '深度思考中...' });
  const isDeepThinking = rawIsDeepThinking && showThinking;
  const isThinkingState = msg.content === t('chat.thinking') || rawIsDeepThinking || (!processedContent && isTyping && isLast && !isUser);

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

  if (!processedContent && !(isTyping && isLast && !isUser) && !hasApproval && !hasEmbeddedMeta) return null;

  // ReactMarkdown 的 components 配置，抽出来是为了在主气泡和嵌入式 meta 折叠区里复用同一套渲染器。
  const markdownComponents = {
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

      // 定义标识符过滤逻辑：移除仅仅包含标识符的段落/文本
      const filterMarkers = (nodes: any): any => {
        return React.Children.map(nodes, (child) => {
          const text = extractText(child).trim();
          // 如果该节点纯粹是标识符或标记行，则过滤掉
          if (
            text === ':::thinking' || 
            text === ':::plan' || 
            text === ':::toolCall' || 
            text === ':::commandOutput' || 
            text === ':::approval' || 
            text === ':::warning' || 
            text === ':::' ||
            /^:::warning\s+/.test(text)
          ) {
            return null;
          }
          return child;
        });
      };

      const cleanChildren = filterMarkers(children);

      if (fullText.includes(':::thinking')) {
        return <CollapsibleMeta title={t('chat.thinkingProcess', { defaultValue: '思考过程' })} icon={Cpu} defaultExpanded={false}>{cleanChildren}</CollapsibleMeta>;
      }
      if (fullText.includes(':::plan')) {
        return <CollapsibleMeta title={t('chat.executionPlan', { defaultValue: '执行计划' })} icon={ListTodo} defaultExpanded={false}>{cleanChildren}</CollapsibleMeta>;
      }
      if (fullText.includes(':::toolCall')) {
        return <CollapsibleMeta title={t('chat.systemTool', { defaultValue: '系统工具' })} icon={Terminal} defaultExpanded={false}>{cleanChildren}</CollapsibleMeta>;
      }
      if (fullText.includes(':::commandOutput')) {
        const titleMatch = fullText.match(/^\s*:::commandOutput\s*\n+\s*\*\*([^*\n]+)\*\*/);
        const subtitle = titleMatch ? titleMatch[1].trim() : '';
        const headerTitle = subtitle ? `Command Output · ${subtitle}` : 'Command Output';
        return (
          <CollapsibleMeta title={headerTitle} icon={Terminal} defaultExpanded={false}>
            <div
              className="v3-command-output-shell"
              style={{
                margin: '4px 0', borderRadius: 8, overflow: 'hidden',
                border: '1px solid #1e293b', background: '#030712', color: '#e2e8f0',
                padding: '10px 12px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12, lineHeight: 1.5,
                maxHeight: 360, overflowY: 'auto', whiteSpace: 'pre-wrap'
              }}
            >
              {cleanChildren}
            </div>
          </CollapsibleMeta>
        );
      }
      if (fullText.includes(':::approval')) {
        const approvalId = approvalMeta.approvalId;
        const slug = approvalMeta.slug;
        const rawContent = msg.content;
        const alreadyResolved = rawContent.includes('— ✅') || rawContent.includes('— ❌') || rawContent.includes('— ⏱️') || rawContent.includes('已超时') || rawContent.includes('已批准(永久)');
        const approvalClickKey = approvalId || slug;
        const isClicked = approvalClickKey ? !!approvalClicked[approvalClickKey] : false;
        const isDisabled = alreadyResolved || isClicked;

        return (
          <div style={{ margin: '12px 0', padding: '16px', background: '#fef2f2', border: '1px solid #fee2e2', borderRadius: 12, boxShadow: '0 2px 8px rgba(239, 68, 68, 0.05)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: '#ef4444' }}>
              <ShieldAlert size={18} />
              <span style={{ fontWeight: 600, fontSize: 14 }}>{t('chat.approvalRequired')}</span>
            </div>
            <div style={{ marginBottom: 12, opacity: 0.9 }}>{cleanChildren}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <Button type="primary" danger block icon={<ShieldCheck size={16} />} disabled={isDisabled} onClick={() => { if (!approvalId || isDisabled) return; setApprovalClicked(prev => ({ ...prev, [approvalClickKey]: true })); onSend(`/approve ${approvalId} allow-once`); message.success(t('chat.approvalSent', { defaultValue: '已提交审批指令' })); }} style={{ borderRadius: 8, fontWeight: 600, height: 36 }}>{t('chat.approveNow')}</Button>
              <Button block icon={<ShieldCheck size={16} />} disabled={isDisabled} onClick={() => { if (!approvalId || isDisabled) return; setApprovalClicked(prev => ({ ...prev, [approvalClickKey]: true })); onSend(`/approve ${approvalId} allow-always`); message.success(t('chat.approvalSentAlways', { defaultValue: '已提交永久审批' })); }} style={{ borderRadius: 8, fontWeight: 600, height: 36 }}>{t('chat.approveAllowAlways')}</Button>
            </div>
          </div>
        );
      }
      if (fullText.includes(':::warning')) {
        const titleLine = fullText.split('\n').find(l => l.includes(':::warning')) || '';
        const title = titleLine.replace(/^>\s?:::warning\s?/, '').trim() || 'Warning';
        return (
          <div style={{ margin: '12px 0', padding: '12px', background: '#fffbeb', border: '1px solid #fef3c7', borderRadius: 8, fontSize: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: '#d97706' }}>
              <ShieldAlert size={14} />
              <span style={{ fontWeight: 600 }}>{title}</span>
            </div>
            {cleanChildren}
          </div>
        );
      }
      return (
        <blockquote className="v3-quote" style={{ borderLeft: `4px solid ${isUser ? 'var(--v3-user-border, rgba(255,255,255,0.7))' : 'var(--v3-border, #e2e8f0)'}`, padding: '8px 10px', paddingLeft: 12, color: isUser ? 'var(--v3-user-text, rgba(255,255,255,0.92))' : 'var(--v3-text-muted, #64748b)', background: isUser ? 'var(--v3-user-surface, rgba(255,255,255,0.12))' : 'rgba(241, 245, 249, 0.6)', borderRadius: 10, margin: '8px 0', fontStyle: 'normal' }}>
          {children}
        </blockquote>
      );
    },
    code: ({ inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';
      if (!inline && language === 'mermaid') return <Mermaid chart={String(children).replace(/\n$/, '')} />;
      if (!inline && isEchartsCodeFenceLanguage(language)) return <ECharts optionStr={String(children).replace(/\n$/, '')} isTyping={isLast && isTyping} />;
      if (!inline && language) return <CodeBlock language={language} value={String(children).replace(/\n$/, '')} isMobile={isMobile} {...props} />;
      return <code {...props} style={{ padding: '0.2em 0.4em', backgroundColor: isUser ? 'rgba(255,255,255,0.1)' : 'rgba(175, 184, 193, 0.2)', borderRadius: '6px', fontSize: '85%' }}>{children}</code>;
    },
    a: ({ node, href, children, ...props }: any) => {
        const isQuick = href?.startsWith('quick:') || href?.includes('quick:');
        const query = isQuick ? decodeURIComponent(href.replace(/^.*quick:/, '')) : '';
        
        if (isQuick) {
          return (
            <span 
              className="v3-quick-link"
              style={{ 
                textDecoration: 'none', 
                display: 'inline-flex',
                cursor: 'pointer'
              }}
              onClick={(e) => {
                e.preventDefault();
                onSend(query);
              }}
            >
              {children}
            </span>
          );
        }
      return <a href={href} target="_blank" rel="noopener noreferrer" {...props}>{children}</a>;
    }
  };

  return (
    <div 
      className={`message-in ${isUser ? 'v3-message-user' : 'v3-message-assistant'}`} 
      style={{ 
        display: 'flex', gap: 14, flexDirection: isUser ? 'row-reverse' : 'row',
        animation: 'v3-message-enter 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) forwards' 
      }}
    >
      {isUser ? (
        <Avatar icon={<User size={18} />} style={{ background: '#1e293b', flexShrink: 0, marginTop: 4, visibility: 'visible' }} />
      ) : isMetaOnly ? (
        // 思考信息附录气泡：不占头像位，保留尺寸以与主气泡对齐
        <div style={{ flexShrink: 0, marginTop: 4, width: isMobile ? 32 : 36, height: isMobile ? 32 : 36 }} />
      ) : (
        <div style={{ flexShrink: 0, marginTop: 4, visibility: 'visible' }}>
          <div style={{ width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: '50%', background: '#eef2ff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #c7d2fe' }}>
            <Bot size={isMobile ? 22 : 25} color="var(--v3-primary, #6366f1)" />
          </div>
        </div>
      )}
      
      <div style={{ 
        maxWidth: isMobile ? '92%' : '85%',
        padding: isMetaOnly ? (isMobile ? '8px 12px' : '10px 14px') : (isMobile ? '10px 14px' : '12px 18px'),
        borderRadius: isUser ? '18px 18px 4px 18px' : (isMetaOnly ? 12 : '4px 18px 18px 18px'),
        background: isUser
          ? 'var(--v3-user-bubble, #4b5bdc)'
          : (isMetaOnly ? '#f8fafc' : 'var(--v3-surface, #fff)'),
        color: isUser ? 'var(--v3-user-text, #fff)' : 'var(--v3-text, #1e293b)',
        boxShadow: isUser ? '0 4px 15px var(--v3-user-bubble-shadow, rgba(79, 70, 229, 0.15))' : (isMetaOnly ? 'none' : '0 4px 12px rgba(0,0,0,0.03)'),
        border: !isUser ? `1px ${isMetaOnly ? 'dashed #cbd5e1' : 'solid var(--v3-border, #e8eff6)'}` : 'none',
        position: 'relative', wordBreak: 'break-word', overflowWrap: 'anywhere', minWidth: 0,
      }}>
        {isMetaOnly && (() => {
          const thinkingShort = t('chat.metaFoldThinkingShort', { defaultValue: '思考中…' });
          const suffixLabel = metaExpanded
            ? t('chat.metaFoldCollapse', { defaultValue: '点击折叠本次思考或工具调用' })
            : metaFoldGenerationUi
              ? (metaFoldIsToolCallGenerating
                ? t('chat.metaFoldExpandLiveTool', { defaultValue: '工具调用生成中' })
                : t('chat.metaFoldExpandLive', { defaultValue: '点击展开查看思考或工具调用' }))
              : t('chat.metaFoldExpand', { defaultValue: '点击展开本次思考或工具调用' });
          const metaLabel =
            !metaExpanded && metaFoldGenerationUi ? `${thinkingShort} · ${suffixLabel}` : suffixLabel;
          return (
            <div
              role="button"
              tabIndex={0}
              aria-label={metaLabel}
              aria-expanded={metaExpanded}
              onClick={toggleMetaExpanded}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleMetaExpanded();
                }
              }}
              title={metaLabel}
              className={`v3-meta-fold-chip${metaFoldGenerationUi ? ' v3-meta-fold-chip--live' : ''}${metaExpanded ? ' v3-meta-fold-chip--expanded' : ''}`}
            >
              {!metaExpanded && metaFoldGenerationUi && (
                <>
                  <Loader2 size={14} strokeWidth={2} className="v3-thinking-spinner v3-meta-fold-chip-spinner" aria-hidden />
                  <span className="v3-meta-fold-chip-thinking">{thinkingShort}</span>
                  <span className="v3-meta-fold-chip-sep" aria-hidden>·</span>
                </>
              )}
              {metaExpanded ? <ChevronDown size={14} strokeWidth={2} style={{ flexShrink: 0 }} /> : <ChevronRight size={14} strokeWidth={2} style={{ flexShrink: 0 }} />}
              <Layers size={15} strokeWidth={2} aria-hidden style={{ flexShrink: 0, opacity: 0.92 }} />
              <span style={{ flex: 1, minWidth: 0 }}>{suffixLabel}</span>
            </div>
          );
        })()}
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
          // 主气泡尚无嵌入 meta、且仍处于思考占位时：显示思考文案 + 转圈；已有嵌入 meta 时走正文与底部折叠区（默认折叠）。
          isThinkingState && !hasEmbeddedMeta ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: isDeepThinking ? '#7c3aed' : '#64748b', fontWeight: isDeepThinking ? 600 : 400 }}>
                {isDeepThinking ? t('chat.deepThinking', { defaultValue: '深度思考中...' }) : t('chat.thinking')}
                {thinkingSeconds > 0 ? ` (${thinkingSeconds}s)` : ''}
              </span>
              <Loader2
                size={17}
                className="v3-thinking-spinner"
                aria-hidden
                style={{ color: isDeepThinking ? '#7c3aed' : '#2563eb', flexShrink: 0 }}
              />
            </div>
          ) : (
            <>
              <div
                className="markdown-body-v3"
                id={`msg-content-v3-${index}`}
                style={isMetaOnly && !metaExpanded ? { display: 'none' } : undefined}
              >
                <ReactMarkdown 
                  remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]} 
                  rehypePlugins={[rehypeKatex, [rehypeSanitize, katexSanitizeSchema]]}
                  components={markdownComponents as any}
                  urlTransform={(url) => {
                    if (url.startsWith('quick:')) return url;
                    return defaultUrlTransform(url);
                  }}
                >
                  {processedContent}
                </ReactMarkdown>
              </div>

              {hasEmbeddedMeta && (() => {
                // 嵌入式折叠区：挂在主气泡正文最底部
                const thinkingShort = t('chat.metaFoldThinkingShort', { defaultValue: '思考中…' });
                const suffixLabel = metaExpanded
                  ? t('chat.metaFoldCollapse', { defaultValue: '点击折叠本次思考或工具调用' })
                  : metaFoldGenerationUi
                    ? (metaFoldIsToolCallGenerating
                      ? t('chat.metaFoldExpandLiveTool', { defaultValue: '工具调用生成中' })
                      : t('chat.metaFoldExpandLive', { defaultValue: '点击展开查看思考或工具调用' }))
                    : t('chat.metaFoldExpand', { defaultValue: '点击展开本次思考或工具调用' });
                const embedLabel =
                  !metaExpanded && metaFoldGenerationUi ? `${thinkingShort} · ${suffixLabel}` : suffixLabel;
                return (
                  <div style={{ marginTop: 10 }}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-label={embedLabel}
                      aria-expanded={metaExpanded}
                      onClick={toggleMetaExpanded}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleMetaExpanded();
                        }
                      }}
                      title={embedLabel}
                      className={`v3-meta-fold-chip${metaFoldGenerationUi ? ' v3-meta-fold-chip--live' : ''}${metaExpanded ? ' v3-meta-fold-chip--expanded' : ''}`}
                    >
                      {!metaExpanded && metaFoldGenerationUi && (
                        <>
                          <Loader2 size={14} strokeWidth={2} className="v3-thinking-spinner v3-meta-fold-chip-spinner" aria-hidden />
                          <span className="v3-meta-fold-chip-thinking">{thinkingShort}</span>
                          <span className="v3-meta-fold-chip-sep" aria-hidden>·</span>
                        </>
                      )}
                      {metaExpanded ? <ChevronDown size={14} strokeWidth={2} style={{ flexShrink: 0 }} /> : <ChevronRight size={14} strokeWidth={2} style={{ flexShrink: 0 }} />}
                      <Layers size={15} strokeWidth={2} aria-hidden style={{ flexShrink: 0, opacity: 0.92 }} />
                      <span style={{ flex: 1, minWidth: 0 }}>{suffixLabel}</span>
                    </div>
                    {metaExpanded && (
                      <div
                        className="markdown-body-v3 v3-meta-embedded"
                        style={{
                          background: '#f8fafc',
                          border: '1px dashed #cbd5e1',
                          borderRadius: 10,
                          padding: '8px 12px',
                        }}
                      >
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm, remarkBreaks, remarkMath]}
                          rehypePlugins={[rehypeKatex, [rehypeSanitize, katexSanitizeSchema]]}
                          components={markdownComponents as any}
                          urlTransform={(url) => {
                            if (url.startsWith('quick:')) return url;
                            return defaultUrlTransform(url);
                          }}
                        >
                          {processedMetaContent}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                );
              })()}

              {!isMetaOnly && isStalled && isTyping && isLast && msg.role === 'assistant' && (
                <div
                  className="v3-stream-stall-hint"
                  role="status"
                  aria-live="polite"
                  aria-relevant="additions text"
                >
                  <Loader2 size={16} className="v3-thinking-spinner" aria-hidden />
                  <span className="v3-stream-stall-hint-text">
                    {t('chat.streamStalledHint', { defaultValue: 'AI 还在思考中，请稍等一下...' })}
                  </span>
                </div>
              )}

              {!isMetaOnly && (
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
              )}
            </>
          )
        )}
      </div>
    </div>
  );
};

export default React.memo(V3MessageItem, (prev, next) => {
  const prevTpsLast = prev.tpsData && prev.tpsData.length > 0 ? prev.tpsData[prev.tpsData.length - 1] : undefined;
  const nextTpsLast = next.tpsData && next.tpsData.length > 0 ? next.tpsData[next.tpsData.length - 1] : undefined;
  const prevMetrics = prev.msg.metrics || {};
  const nextMetrics = next.msg.metrics || {};

  return prev.isMobile === next.isMobile &&
         prev.index === next.index &&
         prev.editContent === next.editContent && 
         prev.editingMsgIndex === next.editingMsgIndex &&
         prev.msg.content === next.msg.content &&
         (prev.metaContent || '') === (next.metaContent || '') &&
         prev.mainHasTranscript === next.mainHasTranscript &&
         !!(prev.msg as any)._uiMetaOnly === !!(next.msg as any)._uiMetaOnly &&
         prev.msg.runId === next.msg.runId &&
         prev.msg.timestamp === next.msg.timestamp &&
         prevMetrics.ttft === nextMetrics.ttft &&
         prevMetrics.tps === nextMetrics.tps &&
         prevMetrics.duration === nextMetrics.duration &&
         prev.showThinking === next.showThinking &&
         prev.isTyping === next.isTyping &&
         prev.isLast === next.isLast &&
         prev.isStalled === next.isStalled &&
         (prev.tpsData?.length === next.tpsData?.length) &&
         prevTpsLast === nextTpsLast;
});
