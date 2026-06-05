import React, { useMemo, useState, useEffect, useRef } from 'react';
import { Avatar, Button, Input, message } from 'antd';
import { 
  User, Bot, Copy, Quote, Pencil, RefreshCw, Zap, Cpu, Terminal, 
  FileText, ChevronRight, ChevronDown, Shield, ShieldAlert, ShieldCheck, ListTodo, Loader2, Layers, Search, GitBranch,
  Save, LayoutTemplate, Check, Download, ExternalLink
} from 'lucide-react';
import { useArtifact } from '../../views/chatV3/V3ArtifactContext';
import Tooltip from '../common/AppTooltip';
import api from '../../api';
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
import { CodeBlock, ECharts, isEchartsCodeFenceLanguage } from '../ChatComponents';

interface V3MessageItemProps {
  msg: any;
  index: number;
  isMobile: boolean;
  isDarkMode?: boolean;
  showThinking: boolean;
  selectedBot: string;
  currentWorkspacePath?: string;
  editingMsgIndex: number | null;
  editContent: string;
  setEditContent: (val: string) => void;
  onEdit: (index: number, content: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: (index: number) => void;
  onQuote: (content: string) => void;
  onSend: (content: string) => void;
  onSaveToWorkspace?: (content: string) => void;
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

const CollapsibleMeta = ({
  title,
  icon: Icon,
  children,
  defaultExpanded = false,
  expandedState,
  onExpandedChange,
  copyText,
  onCopy,
  copyLabel,
  isThinking = false,
  elapsedSeconds = 0,
  iconStyle,
}: any) => {
  const isControlled = typeof expandedState === 'boolean';
  const [localExpanded, setLocalExpanded] = React.useState(defaultExpanded);
  const isExpanded = isControlled ? expandedState : localExpanded;

  React.useEffect(() => {
    if (!isControlled) setLocalExpanded(defaultExpanded);
  }, [defaultExpanded, isControlled]);

  const setExpanded = (next: boolean) => {
    if (!isControlled) setLocalExpanded(next);
    onExpandedChange?.(next);
  };

  return (
    <div className={`v3-meta-collapsible ${isExpanded ? 'expanded' : 'collapsed'} ${isThinking ? 'v3-thinking-card-active' : ''}`} style={{ transition: 'all 0.3s cubic-bezier(0.25, 1, 0.5, 1)' }}>
      <div 
        className="v3-meta-header" 
        onClick={() => setExpanded(!isExpanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpanded(!isExpanded);
          }
        }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
      >
        <div className="v3-meta-header-left" style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
          <div style={{ transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <ChevronRight size={14} strokeWidth={2} />
          </div>
          <Icon size={14} strokeWidth={2} className={isThinking ? 'v3-thinking-live-icon' : ''} style={{ flexShrink: 0, transition: 'all 0.25s', ...iconStyle }} />
          <span className="v3-meta-header-title" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          {isThinking ? (
            <span style={{ color: '#7c3aed', background: 'rgba(124, 58, 237, 0.08)', padding: '2px 8px', borderRadius: 6, display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700 }}>
              <span className="v3-warning-pulse" style={{ width: 6, height: 6, borderRadius: '50%', background: '#7c3aed' }} />
              正在思考 {elapsedSeconds}s
            </span>
          ) : elapsedSeconds > 0 ? (
            <span style={{ color: '#94a3b8', background: 'rgba(148, 163, 184, 0.08)', padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700 }}>
              耗时 {elapsedSeconds}s
            </span>
          ) : null}

          {!!copyText && (
            <div
              className="v3-meta-header-actions"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onKeyDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <Tooltip title={copyLabel}>
                <Button
                  type="text"
                  size="small"
                  className="v3-meta-copy-btn"
                  icon={<Copy size={14} strokeWidth={2} />}
                  onClick={() => onCopy?.(copyText)}
                />
              </Tooltip>
            </div>
          )}
        </div>
      </div>
      
      <div className={`v3-collapsible-wrapper ${isExpanded ? 'expanded' : ''}`}>
        <div className="v3-collapsible-content">
          <div className="v3-meta-content" style={{ padding: '10px 14px' }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
};

interface TerminalBodyProps {
  children: React.ReactNode;
  toolColor: string;
  subtitle: string;
  scrollState: TerminalScrollState;
}

interface TerminalScrollState {
  isAtBottom: boolean;
  userScrolling: boolean;
  lastScrollTop: number;
}

const TerminalBody: React.FC<TerminalBodyProps> = ({ children, toolColor, subtitle, scrollState }) => {
  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    
    const scrollTop = el.scrollTop;
    const isAtBottom = el.scrollHeight - scrollTop - el.clientHeight < 15;
    const isScrollingUp = scrollTop < scrollState.lastScrollTop - 1;

    if (isAtBottom) {
      scrollState.isAtBottom = true;
      scrollState.userScrolling = false;
    } else if (scrollState.userScrolling || isScrollingUp) {
      scrollState.isAtBottom = false;
    }

    scrollState.lastScrollTop = scrollTop;
  };

  const handleUserInteraction = () => {
    scrollState.userScrolling = true;
    scrollState.isAtBottom = false;
  };

  React.useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    if (scrollState.isAtBottom) {
      el.scrollTop = el.scrollHeight;
      scrollState.lastScrollTop = el.scrollTop;
      return;
    }

    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.min(scrollState.lastScrollTop, maxScrollTop);
    scrollState.lastScrollTop = el.scrollTop;
  }, [children]);

  return (
    <div 
      ref={containerRef}
      onScroll={handleScroll}
      onWheel={handleUserInteraction}
      onTouchMove={handleUserInteraction}
      className="v3-terminal-body" 
      style={{ maxHeight: 360, overflowY: 'auto', overscrollBehavior: 'contain' }}
    >
      <div className="v3-terminal-line" style={{ marginBottom: 6 }}>
        <span className="v3-terminal-prompt" style={{ color: toolColor }}>$</span>
        <span className="v3-terminal-output" style={{ color: '#f8fafc', fontWeight: 'bold' }}>{subtitle || 'bash'}</span>
      </div>
      <div className="v3-terminal-output" style={{ whiteSpace: 'pre-wrap', color: '#10b981' }}>
        {children}
      </div>
    </div>
  );
};

const getToolIconAndColor = (name: string) => {
  const n = String(name || '').toLowerCase();
  if (n.includes('command') || n.includes('cmd') || n.includes('shell') || n.includes('terminal')) {
    return { icon: Terminal, color: '#ec4899' }; // 终端命令 (Pink)
  }
  if (n.includes('file') || n.includes('read') || n.includes('write') || n.includes('save') || n.includes('view') || n.includes('explorer')) {
    return { icon: FileText, color: '#0ea5e9' }; // 文件操作 (Light Blue)
  }
  if (n.includes('permission') || n.includes('security') || n.includes('ask')) {
    return { icon: ShieldAlert, color: '#f97316' }; // 安全审批 (Orange)
  }
  if (n.includes('mcp') || n.includes('plugin') || n.includes('lifecycle')) {
    return { icon: Layers, color: '#a855f7' }; // MCP 插件 (Purple)
  }
  return { icon: Zap, color: '#eab308' }; // 其他 (Yellow)
};

const extractCodeFence = (text: string, lang: string) => {
  const re = new RegExp("```" + lang + "\\n([\\s\\S]*?)\\n```", "i");
  const m = re.exec(text);
  return m ? (m[1] || '').trim() : '';
};

const prettyJsonMaybe = (raw: string) => {
  const trimmed = (raw || '').trim();
  if (!trimmed) return '';
  try {
    const obj = JSON.parse(trimmed);
    return JSON.stringify(obj, null, 2);
  } catch {
    return raw;
  }
};

const extractToolResultName = (fullText: string) => {
  // 只取 :::toolResult 紧随其后的第一段 **name**，避免误抓正文里的 **xxx**
  const re = /(?:^|\n)\s*(?:>\s*)?:::toolResult\s*\n+\s*(?:>\s*)?\*\*([^*\n]+)\*\*/i;
  const m = re.exec(fullText || '');
  return m ? (m[1] || '').trim() : '';
};

const extractToolCallName = (fullText: string) => {
  // 只取 :::toolCall 紧随其后的第一段 **name**，避免误抓正文里的 **xxx**
  const re = /(?:^|\n)\s*(?:>\s*)?:::toolCall\s*\n+\s*(?:>\s*)?\*\*([^*\n]+)\*\*/i;
  const m = re.exec(fullText || '');
  return m ? (m[1] || '').trim() : '';
};

const stripToolResultWrapper = (fullText: string) => {
  // 去掉 :::toolResult / ::: 包裹与工具名行，留下正文
  const lines = String(fullText || '').split('\n');
  const out: string[] = [];
  let started = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const plain = l.replace(/^\s*>\s?/, '').trimEnd();
    if (!started) {
      if (/^:::toolResult\b/i.test(plain.trim())) {
        started = true;
      }
      continue;
    }
    if (/^:::\s*$/.test(plain.trim())) break;
    // 跳过工具名行：**xxx**
    if (/^\*\*[^*\n]+\*\*\s*$/.test(plain.trim())) continue;
    out.push(plain);
  }
  return out.join('\n').trim();
};

const stripContainerWrapper = (fullText: string, kind: string) => {
  const lines = String(fullText || '').split('\n');
  const out: string[] = [];
  let started = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const plain = l.replace(/^\s*>\s?/, '').trimEnd();
    if (!started) {
      if (new RegExp(`^:::\\s*${kind}\\b`, 'i').test(plain.trim())) {
        started = true;
      }
      continue;
    }
    if (/^:::\s*$/.test(plain.trim())) break;
    out.push(plain);
  }
  return out.join('\n').trim();
};

/**
 * 提取并清洗用于引用的内容，移除思考过程、工具调用等元数据。
 */
const getCleanQuoteContent = (content: string, role: string) => {
  if (!content) return '';
  let res = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // 1. 如果是用户消息，执行清洗逻辑
  if (role === 'user') {
    const timestampRegex = /\[(?:[A-Z][a-z]{2} )?\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? GMT[+-]\d+\]/g;
    let lastMatch;
    let match;
    while ((match = timestampRegex.exec(res)) !== null) {
      lastMatch = match;
    }
    if (lastMatch) {
      res = res.substring(lastMatch.index + lastMatch[0].length);
    }
    res = res.replace(/<(anti-hallucination-guardrails|system_instruction|thought|think)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    const bootstrapWarningIdx = res.indexOf('[Bootstrap truncation warning]');
    if (bootstrapWarningIdx !== -1) {
      res = res.substring(0, bootstrapWarningIdx);
    }
    return res.trim();
  }

  // 2. 如果是助手消息，强力清洗所有元数据块
  res = res
    // 移除 HTML 注释
    .replace(/(?:^|\n)\s*>\s*<!--agentItem:[^>]*-->\s*/g, '\n')
    .replace(/<!--\s*tool:[^>]*-->/g, '')
    // 移除 XML 标签块 (如 <think>...</think>)
    .replace(/<(anti-hallucination-guardrails|ephemeral_message|available_skills|relevant[-_]memories|thought|think|thought_process|reasoning|system_instruction)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    // 移除 ::: 容器块 (:::thinking, :::toolCall 等)
    .replace(/(?:^|\n)\s*(?:>\s*)?:::(?:thinking|plan|toolCall|toolResult|commandOutput|analysis|approval|warning)[\s\S]*?((?:^|\n)\s*(?:>\s*)?:::|$)/gi, '\n')
    // 移除系统标识与警告
    .replace(/\[(search|coding)-mode|Bootstrap truncation warning|Queued user message that arrived while the previous turn was still active\][\s\S]*?(?=\n\n|\n\s*\[|\n\s*<|$)/gi, '')
    // 移除系统日志行
    .replace(/^(?:System \(untrusted\):|System:).*?(?:\n|$)/gm, '')
    // 移除时间戳
    .replace(/(?:^|\n)\s*\[(?:[A-Z][a-z]{2} )?\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? GMT[+-]\d+\]\s*/g, '\n')
    // 移除工具状态行
    .replace(/(?:^|\n)\s*(?:>\s*)?[🔧✅❌⚠️]\s*`[^`]+`\s*(?:执行中(?:…|\.{3})|完成|失败|错误)(?:\s*<!--[\s\S]*?-->)?/g, '\n')
    // 移除多余的转圈/思考占位
    .replace(/^[.\s…]+$/g, '')
    // 压缩连续换行
    .replace(/\n{3,}/g, '\n\n');

  return res.trim();
};

const writeTextToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-9999px';
  textArea.style.top = '0';
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  try {
    const successful = document.execCommand('copy');
    if (!successful) throw new Error('execCommand copy returned false');
  } finally {
    document.body.removeChild(textArea);
  }
};

const artifactButtonBaseStyle: React.CSSProperties = {
  height: 32,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  borderRadius: 8,
  padding: '0 12px',
  fontSize: 13,
  fontWeight: 600,
  lineHeight: 1,
  cursor: 'pointer',
  userSelect: 'none',
  position: 'relative',
  zIndex: 2,
};

const artifactSecondaryButtonStyle: React.CSSProperties = {
  ...artifactButtonBaseStyle,
  color: '#334155',
  background: '#fff',
  border: '1px solid #d1d5db',
  boxShadow: '0 1px 2px rgba(15, 23, 42, 0.08)',
};

const ArtifactCard: React.FC<{
  type: 'html' | 'mermaid' | 'svg' | 'markdown' | 'image';
  code: string;
  messageId: string;
  isDarkMode: boolean;
  isMobile: boolean;
  t: any;
  isStreaming?: boolean;
}> = ({ type, code, messageId, isDarkMode, isStreaming = false }) => {
  const { registerArtifact } = useArtifact();
  const [copied, setCopied] = useState(false);

  // 提取文件名
  const filename = useMemo(() => {
    let ext = 'svg';
    if (type === 'html') ext = 'html';
    else if (type === 'mermaid') ext = 'mermaid';
    else if (type === 'markdown') ext = 'md';
    else if (type === 'image') {
      const match = code.match(/^data:image\/(\w+);base64,/);
      ext = match ? match[1] : 'png';
    }
    let defaultName = `app_${messageId.slice(0, 5)}.${ext}`;
    const commentMatch = code.match(/(?:<!--|\/\*)\s*filename:\s*([a-zA-Z0-9_\-\.]+)\s*(?:-->|\*\/)/);
    if (commentMatch && commentMatch[1]) {
      return commentMatch[1];
    }
    return defaultName;
  }, [code, messageId, type]);

  // 大模型吐字时，如果是流式输出，我们将实时注册/更新右侧 Canvas
  useEffect(() => {
    if (code && code.trim().length > 10) {
      registerArtifact({
        id: `${messageId}-${filename}`,
        title: filename,
        type,
        code,
        messageId
      }, isStreaming);
    }
  }, [code, messageId, filename, type, registerArtifact, isStreaming]);

  const handlePreview = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('[ArtifactDebug] Preview button onClick fired! Filename:', filename, 'messageId:', messageId);
    registerArtifact({ id: `${messageId}-${filename}`, title: filename, type, code, messageId }, true);
  };

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await writeTextToClipboard(code);
      setCopied(true);
      message.success('已复制到剪贴板');
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Artifact copy failed:', err);
      message.error('复制失败，请手动复制');
    }
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const blob = new Blob([code], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div style={{
      margin: '12px 0',
      borderRadius: 12,
      background: isDarkMode ? '#1e293b' : '#f8fafc',
      border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
      overflow: 'hidden',
      boxShadow: '0 4px 12px rgba(0,0,0,0.03)'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 14px',
        background: isDarkMode ? '#0f172a' : '#f1f5f9',
        borderBottom: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 600 }}>
          <LayoutTemplate size={14} color="#6366f1" />
          <span style={{ color: isDarkMode ? '#f1f5f9' : '#1e293b' }}>{filename}</span>
          <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 400 }}>({(code.length / 1024).toFixed(1)} KB)</span>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12, padding: '12px 14px', background: isDarkMode ? '#1e293b' : '#fff', position: 'relative', zIndex: 1 }}>
        <button
          type="button"
          style={{
            ...artifactButtonBaseStyle,
            color: '#fff',
            background: '#6366f1',
            border: '1px solid #6366f1',
            boxShadow: '0 1px 2px rgba(79, 70, 229, 0.18)',
          }}
          onMouseDown={handlePreview}
        >
          👁️ 预览此应用
        </button>
        <button
          type="button"
          style={artifactSecondaryButtonStyle}
          onMouseDown={handleCopy}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
          {copied ? '已复制' : '复制代码'}
        </button>
        <button
          type="button"
          style={artifactSecondaryButtonStyle}
          onMouseDown={handleDownload}
        >
          <Download size={15} />
          下载文件
        </button>
      </div>
    </div>
  );
};

const ActionableCommandCard: React.FC<{
  command: string;
  isDarkMode: boolean;
  t: any;
}> = ({ command, isDarkMode, t }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await writeTextToClipboard(command);
      setCopied(true);
      message.success(t('chat.copySuccess', { defaultValue: '复制成功' }));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      message.error(t('chat.copyFailed', { defaultValue: '复制失败' }));
    }
  };

  const handleRunInTerminal = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const cmd = command.trim();
      console.log('[ActionableCommandCard] handleRunInTerminal invoked for:', cmd);
      
      const runner = (window as any).__ClawTerminalRun__;
      console.log('[ActionableCommandCard] window.__ClawTerminalRun__ status:', !!runner);
      
      if (typeof runner === 'function') {
        runner(cmd);
      } else {
        console.warn('[ActionableCommandCard] window.__ClawTerminalRun__ is not a function, fallback to Event dispatch.');
        // 优雅向下兼容的事件降级方案
        const event = new CustomEvent('claw-terminal-run', {
          detail: { command: cmd }
        });
        window.dispatchEvent(event);
      }

      if (typeof t === 'function') {
        message.success(t('chat.commandSentToTerminal', { defaultValue: '已发送至终端执行' }));
      } else {
        message.success('已发送至终端执行');
      }
    } catch (err: any) {
      console.error('[ActionableCommandCard] Fatal click error:', err);
      message.error(`指令发送出错: ${err?.message || err}`);
    }
  };

  return (
    <div style={{
      margin: '12px 0',
      borderRadius: 10,
      background: isDarkMode ? '#0f172a' : '#f8fafc',
      border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
      overflow: 'hidden',
      boxShadow: '0 4px 12px rgba(0,0,0,0.02)'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        background: isDarkMode ? '#1e293b' : '#f1f5f9',
        borderBottom: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: isDarkMode ? '#94a3b8' : '#475569' }}>
          <Terminal size={14} className={isDarkMode ? 'text-indigo-400' : 'text-indigo-600'} />
          <span>Shell 运维指令</span>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 11, color: isDarkMode ? '#94a3b8' : '#64748b', padding: '2px 6px', borderRadius: 4,
            transition: 'background 0.2s'
          }}
          onMouseEnter={e => e.currentTarget.style.background = isDarkMode ? '#334155' : '#e2e8f0'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <div style={{
        padding: 12,
        background: '#030712',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 12.5,
        lineHeight: 1.5,
        color: '#e2e8f0',
        overflowX: 'auto',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all'
      }}>
        <code>{command}</code>
      </div>
      <div style={{
        padding: '8px 12px',
        background: isDarkMode ? '#1e293b' : '#fff',
        borderTop: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
        display: 'flex',
        justifyContent: 'flex-start',
        gap: 8
      }}>
        <Button
          type="primary"
          size="small"
          icon={<Terminal size={12} />}
          onClick={handleRunInTerminal}
          style={{
            borderRadius: 6,
            fontSize: 12,
            fontWeight: 600,
            background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
            border: 'none',
            boxShadow: '0 2px 4px rgba(79, 70, 229, 0.15)'
          }}
        >
          在终端执行
        </Button>
      </div>
    </div>
  );
};

const getOpenableFilePath = (raw: string) => {
  const path = String(raw || '')
    .trim()
    .replace(/^['"`]+|['"`.,;:，。；：)）\]}】]+$/g, '');
  if (!path || !/^(\/|~\/)/.test(path)) return null;
  if (!/\.(html?|md|markdown|png|jpe?g|gif|webp|bmp|svg|pdf|txt|log|json|ya?ml|ini|conf|sh|py|go|js|tsx?)$/i.test(path)) return null;
  return path;
};

const getArtifactTypeFromPath = (path: string): 'html' | 'markdown' | 'image' | 'pdf' | 'text' | 'svg' => {
  if (/\.html?$/i.test(path)) return 'html';
  if (/\.svg$/i.test(path)) return 'svg';
  if (/\.(png|jpe?g|gif|webp|bmp)$/i.test(path)) return 'image';
  if (/\.pdf$/i.test(path)) return 'pdf';
  if (/\.(txt|log|json|ya?ml|ini|conf|sh|py|go|js|tsx?)$/i.test(path)) return 'text';
  return 'markdown';
};

const getFilenameFromPath = (path: string) => (
  path.split(/[\\/]/).filter(Boolean).pop() || path
);

const joinWorkspacePath = (base: string, relativePath: string) => {
  const cleanedBase = String(base || '').trim().replace(/\/+$/g, '');
  const cleanedRel = String(relativePath || '').trim().replace(/^\/+/g, '');
  if (!cleanedBase || !cleanedRel) return '';
  return `${cleanedBase}/${cleanedRel}`;
};

const getOpenPathCandidates = (path: string, currentWorkspacePath?: string) => {
  const candidates = [path];
  const workspaceMatch = /^\/workspace\/(.+)$/.exec(path);
  if (workspaceMatch) {
    const relPath = workspaceMatch[1];
    const mappedCurrent = joinWorkspacePath(currentWorkspacePath || '', relPath);
    const mappedDefault = joinWorkspacePath('~/.openclaw/workspace', relPath);
    if (mappedCurrent) candidates.push(mappedCurrent);
    candidates.push(mappedDefault);
  }
  return Array.from(new Set(candidates.filter(Boolean)));
};

const InlineFileOpenButton: React.FC<{
  path: string;
  messageId: string;
  isDarkMode: boolean;
  isMobile: boolean;
  currentWorkspacePath?: string;
}> = ({ path, messageId, isDarkMode, isMobile, currentWorkspacePath }) => {
  const { registerArtifact } = useArtifact();
  const [loading, setLoading] = useState(false);

  const readFileForCanvas = async (candidatePath: string) => {
    const type = getArtifactTypeFromPath(candidatePath);
    if (type === 'image' || type === 'pdf') {
      // 请求二进制下载接口以安全获取图片/PDF二进制数据
      const res = await api.get(`/v1/openclaw/files/download?path=${encodeURIComponent(candidatePath)}`, {
        responseType: 'blob'
      });
      const blob = res.data;
      const code = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error(`${type === 'pdf' ? 'PDF' : '图片'}转换Base64失败`));
        reader.readAsDataURL(blob);
      });
      return { type, code };
    }

    const res = await api.get(`/v1/openclaw/files/get?path=${encodeURIComponent(candidatePath)}`);
    return { type, code: res.data?.content || '' };
  };

  const handleOpen = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isMobile) {
      message.warning('移动端下空间有限，暂不支持打开画布');
      return;
    }
    if (loading) return;

    setLoading(true);
    let lastErr: any = null;
    try {
      const candidates = getOpenPathCandidates(path, currentWorkspacePath);
      for (const candidatePath of candidates) {
        try {
          const { type, code } = await readFileForCanvas(candidatePath);
          const title = getFilenameFromPath(candidatePath);
          registerArtifact({
            id: `${messageId}-${candidatePath}`,
            title,
            type,
            code,
            messageId
          }, true);
          message.success(candidatePath === path ? '已在实时画布打开' : '已映射到工作区并在实时画布打开');
          return;
        } catch (err) {
          lastErr = err;
        }
      }
    } catch (err: any) {
      lastErr = err;
    } finally {
      setLoading(false);
    }

    console.error('Open file in canvas failed:', lastErr);
    message.error(lastErr?.response?.data?.message || lastErr?.message || '打开文件失败');
  };

  return (
    <button
      type="button"
      onMouseDown={handleOpen}
      disabled={loading}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        height: 24,
        marginLeft: 8,
        padding: '0 8px',
        borderRadius: 7,
        border: isDarkMode ? '1px solid #475569' : '1px solid #c7d2fe',
        background: isDarkMode ? '#1e293b' : '#eef2ff',
        color: isDarkMode ? '#c7d2fe' : '#4f46e5',
        fontSize: 12,
        fontWeight: 700,
        cursor: loading ? 'wait' : 'pointer',
        verticalAlign: 'middle',
        userSelect: 'none'
      }}
      title="在实时画布打开"
    >
      {loading ? <Loader2 size={12} className="v3-thinking-spinner" /> : <ExternalLink size={12} />}
      打开
    </button>
  );
};

const V3MessageItem: React.FC<V3MessageItemProps> = ({ 
  msg, index, isMobile, isDarkMode = false, showThinking,
  currentWorkspacePath,
  editingMsgIndex, editContent, setEditContent,
  onEdit, onSaveEdit, onCancelEdit, onQuote, onSend, onSaveToWorkspace, onRegenerate,
  copyToClipboard, isTyping, isLast, isStalled, tpsData, mainHasTranscript, metaContent, t
}) => {
  const [thinkingSeconds, setThinkingSeconds] = useState(() => {
    if (msg._thinkStartedAt) {
      return Math.max(0, Math.floor((Date.now() - msg._thinkStartedAt) / 1000));
    }
    return 0;
  });
  // 防止审批按钮重复点击：记录每个 approvalId 是否已点击过“通过”
  const [approvalClicked, setApprovalClicked] = useState<Record<string, boolean>>({});
  const [metaBlockExpandedByKey, setMetaBlockExpandedByKey] = useState<Record<string, boolean>>({});
  const terminalScrollStateByKeyRef = useRef<Record<string, TerminalScrollState>>({});
  /** 同一条消息内多段同类型 meta 卡片（如 analysis）需按渲染顺序分配独立 key */
  const metaBlockInstanceIndexRef = useRef<Record<string, number>>({});

  /** 编辑框草稿：Virtuoso 下列项重渲染时若反复用父级 editContent 覆盖受控 value，会打断中文 IME */
  const [editDraft, setEditDraft] = useState('');
  const editSessionStartedRef = useRef(false);
  useEffect(() => {
    const editingHere = editingMsgIndex === index;
    if (!editingHere) {
      editSessionStartedRef.current = false;
      return;
    }
    if (!editSessionStartedRef.current) {
      setEditDraft(editContent);
      editSessionStartedRef.current = true;
    }
  }, [editingMsgIndex, index, editContent]);

  const processedContent = useMemo(() => {
    let content = (msg.content || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // 💡 针对 User 消息的特殊历史数据清洗逻辑
    if (msg.role === 'user') {
      // 1. 寻找最后一个时间戳标记 [Mon 2026-04-27 10:56 GMT+8]
      const timestampRegex = /\[(?:[A-Z][a-z]{2} )?\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? GMT[+-]\d+\]/g;
      let lastMatch;
      let match;
      while ((match = timestampRegex.exec(content)) !== null) {
        lastMatch = match;
      }

      if (lastMatch) {
        // 1. 截取最后一个时间戳之后的所有内容
        content = content.substring(lastMatch.index + lastMatch[0].length);
      }

      // 2. 即使没有时间戳，也强制清洗掉常见的系统指令标签块
      content = content.replace(/<(anti-hallucination-guardrails|system_instruction|thought|think)\b[^>]*>[\s\S]*?<\/\1>/gi, '');

      // 3. 寻找并删除 [Bootstrap truncation warning] 及其之后的所有内容
      const bootstrapWarningIdx = content.indexOf('[Bootstrap truncation warning]');
      if (bootstrapWarningIdx !== -1) {
        content = content.substring(0, bootstrapWarningIdx);
      }

      return content.trim();
    }

    // --- 以下是 Assistant 消息的重度过滤逻辑 ---
    // 0. 清掉 agent 流注入的 itemId HTML 注释（仅用于内部 upsert 定位，不应展示）
    content = content.replace(/(?:^|\n)\s*>\s*<!--agentItem:[^>]*-->\s*/g, '\n');

    // 0.1 过滤系统级标签块 (XML tags)
    content = content.replace(/<(anti-hallucination-guardrails|ephemeral_message|available_skills|relevant[-_]memories|thought|think|thought_process|reasoning|system_instruction)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    
    // 0.1.1 过滤模式标识与警告指令块 (Inline markers with multi-line descriptions)
    const systemBlockRe = /\[(search|coding)-mode|Bootstrap truncation warning|Queued user message that arrived while the previous turn was still active\][\s\S]*?(?=\n\n|\n\s*\[|\n\s*<|$)/gi;
    content = content.replace(systemBlockRe, '');
    
    // 0.1.2 过滤系统日志行 (e.g., System (untrusted): ...)
    content = content.replace(/^(?:System \(untrusted\):|System:).*?(?:\n|$)/gm, '');

    // 0.2 过滤自动注入的消息头时间戳 (e.g., [Mon 2026-04-27 10:01 GMT+8])
    content = content.replace(/(?:^|\n)\s*\[(?:[A-Z][a-z]{2} )?\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? GMT[+-]\d+\]\s*/g, '\n');

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
        .replace(/(?:^|\n)\s*(?:>\s*)?:::toolResult[\s\S]*?(?:^|\n)\s*(?:>\s*)?:::\s*/g, '\n')
        .replace(/(?:^|\n)\s*\[(?:[A-Z][a-z]{2} )?\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? GMT[+-]\d+\]\s*/g, '\n')
        .replace(/\[(search|coding)-mode|Bootstrap truncation warning|Queued user message that arrived while the previous turn was still active\][\s\S]*?(?=\n\n|\n\s*\[|\n\s*<|$)/gi, '')
        .replace(/^(?:System \(untrusted\):|System:).*?(?:\n|$)/gm, '')
        .replace(/>\s*[🔧✅❌⚠️]\s*`[^`]+`\s*(?:执行中(?:…|\.{3})|完成|失败|错误)(?:\s*<!--[\s\S]*?-->)?/g, '')
        .replace(toolStatusLineRe, '')
        .replace(/(?:>\s*)?:::toolCall[\s\S]*?(?::::|$)\n*/g, '')
        .replace(/(?:>\s*)?:::plan[\s\S]*?(?::::|$)\n*/g, '')
        .replace(/(?:>\s*)?:::commandOutput[\s\S]*?(?::::|$)\n*/g, '')
        // 仅去掉 session.tool 注入的 marker，避免残留 HTML 注释单独成条
        .replace(/<!--\s*tool:[^>]*-->/g, '')
        .replace(/^[.\s…]+$/g, '') // 如果关闭了思考显示，则把残留的纯点/空白也清掉
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

    if (msg.role === 'assistant') {
      // 💡 针对 Assistant 消息：无论是开启还是关闭显示思考，
      // 如果正文文本的最开头残留了流式推理或拼接初期的纯省略号/点和空白前缀（如 `...小龙哥`），
      // 均应将其彻底抹除，以保障首字和元数据块输出的极度清爽和美观。
      content = content.replace(/^[.\s…]+/g, '');
    }

    // 2. 自动为分析/思考等容器标签补齐 '>' 引用符号（如果缺失），确保进入 blockquote 渲染器
    content = content.replace(/(?:^|\n)(:::(?:analysis|thinking|plan|toolCall|commandOutput|approval|warning)[\s\S]*?:::)/g, (_match: string, p1: string) => {
      return '\n> ' + p1.replace(/\n/g, '\n> ');
    });

    return content.trim();
  }, [msg.content, msg.role, showThinking]);

  const processedContentWithoutMeta = useMemo(() => {
    if (msg.role !== 'assistant' || !processedContent) return '';
    return processedContent
      .replace(/(?:>\s*)?:::(?:thinking|plan|toolCall|commandOutput|approval|warning)[\s\S]*?(?::::|$)\n*/g, '')
      .trim();
  }, [processedContent, msg.role]);
  const hasEchartsBlock = useMemo(
    () => !isMobile && msg.role === 'assistant' && /```(?:echarts|chart)\b/i.test(processedContent),
    [isMobile, msg.role, processedContent],
  );

  const isUser = msg.role === 'user';
  const isMetaOnly = !!(msg as any)._uiMetaOnly;
  const hasApproval = msg.content.includes(':::approval');

  const senderLabel = msg.senderLabel || '';
  const isSubAgent = !isUser && senderLabel.includes(':subagent:');
  const subAgentId = isSubAgent ? (senderLabel.split(':').pop() || '').substring(0, 8) : null;

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

  const thinkingLabel = useMemo(() => {
    if (isDeepThinking) return t('chat.deepThinking', { defaultValue: '深度思考中...' });
    const content = msg.content || '';
    const hasTool = content.includes(':::toolCall') || content.includes('🔧');
    const hasThinking = content.includes(':::thinking') || content.includes(':::analysis');
    
    if (hasTool && hasThinking) return t('chat.processing', { defaultValue: '正在处理中...' });
    if (hasTool) return t('chat.toolCalling', { defaultValue: '工具调用中...' });
    if (hasThinking) return t('chat.thinkingProcessLabel', { defaultValue: '正在思考中...' });
    
    return t('chat.thinking');
  }, [isDeepThinking, msg.content, t]);

  useEffect(() => {
    let interval: any;
    if (isThinkingState) {
      // 💡 关键修复：如果存在服务器同步的开始时间，则以该时间为准计算，解决重连/刷新/状态切换导致的“重新计数”问题
      if (msg._thinkStartedAt) {
        setThinkingSeconds(Math.max(0, Math.floor((Date.now() - msg._thinkStartedAt) / 1000)));
      }

      interval = setInterval(() => {
        if (msg._thinkStartedAt) {
          setThinkingSeconds(Math.max(0, Math.floor((Date.now() - msg._thinkStartedAt) / 1000)));
        } else {
          setThinkingSeconds((s: number) => s + 1);
        }
      }, 1000);
    } else {
      setThinkingSeconds(0);
    }
    return () => clearInterval(interval);
  }, [isThinkingState, msg._thinkStartedAt]);

  // 💡 关键修复：确保用户消息永远显示，不被空内容判断拦截
  if (!processedContent && !isUser && !(isTyping && isLast && !isUser) && !hasApproval && !hasEmbeddedMeta) return null;

  // ReactMarkdown 的 components 配置，抽出来是为了在主气泡和嵌入式 meta 折叠区里复用同一套渲染器。
  const metaBlockBaseKey = String((msg as any).id || msg.runId || index);
  // 每次渲染重置，使同消息内多段同类型卡片（如 analysis）按出现顺序获得独立展开 key
  metaBlockInstanceIndexRef.current = {};
  const allocMetaBlockInstanceKey = (blockType: string) => {
    const next = metaBlockInstanceIndexRef.current[blockType] ?? 0;
    metaBlockInstanceIndexRef.current[blockType] = next + 1;
    return `${blockType}:${next}`;
  };
  const metaBlockExpansionProps = (blockKey: string, defaultExpanded: boolean) => {
    const key = `${metaBlockBaseKey}:${blockKey}`;
    return {
      expandedState: Object.prototype.hasOwnProperty.call(metaBlockExpandedByKey, key)
        ? metaBlockExpandedByKey[key]
        : defaultExpanded,
      onExpandedChange: (next: boolean) => {
        setMetaBlockExpandedByKey((prev) => (
          prev[key] === next ? prev : { ...prev, [key]: next }
        ));
      },
    };
  };
  const getTerminalScrollState = (blockKey: string) => {
    const key = `${metaBlockBaseKey}:${blockKey}`;
    if (!terminalScrollStateByKeyRef.current[key]) {
      terminalScrollStateByKeyRef.current[key] = {
        isAtBottom: true,
        userScrolling: false,
        lastScrollTop: 0,
      };
    }
    return terminalScrollStateByKeyRef.current[key];
  };

  const markdownComponents = {
    p: ({children}: any) => <p style={{margin: 0, wordBreak: 'break-word', overflowWrap: 'anywhere'}}>{children}</p>,
    img: ({ node, ...props }: any) => (
      <img
        {...props}
        style={{ maxWidth: '100%', borderRadius: 8, marginTop: 8, cursor: 'zoom-in', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}
        onClick={() => window.open(props.title || props.src, '_blank')}
      />
    ),
    pre: ({children}: any) => {
      const childList = React.Children.toArray(children);
      const onlyChild = childList.length === 1 ? childList[0] : null;
      if (React.isValidElement(onlyChild) && onlyChild.type === ArtifactCard) {
        return <>{onlyChild}</>;
      }

      return (
        <pre
          style={{
            overflowX: 'auto',
            maxWidth: '100%',
            margin: '8px 0',
            padding: '10px',
            borderRadius: 8,
            background: isUser
              ? 'var(--v3-user-surface, rgba(255,255,255,0.12))'
              : (isDarkMode ? '#0f172a' : '#f8fafc'),
            color: isUser
              ? 'var(--v3-user-text, #fff)'
              : (isDarkMode ? '#e2e8f0' : '#1e293b'),
            border: isUser
              ? '1px solid var(--v3-user-border, rgba(255,255,255,0.22))'
              : (isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0'),
          }}
        >
          {children}
        </pre>
      );
    },
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
            text === ':::toolResult' ||
            text === ':::commandOutput' || 
            text === ':::approval' || 
            text === ':::warning' || 
            text === ':::analysis' || 
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
        return (
          <CollapsibleMeta
            title={t('chat.thinkingProcess', { defaultValue: '思考过程' })}
            icon={Cpu}
            defaultExpanded={false}
            {...metaBlockExpansionProps('thinking', false)}
          >
            {cleanChildren}
          </CollapsibleMeta>
        );
      }
      if (fullText.includes(':::plan')) {
        return (
          <CollapsibleMeta
            title={t('chat.executionPlan', { defaultValue: '执行计划' })}
            icon={ListTodo}
            defaultExpanded={false}
            {...metaBlockExpansionProps('plan', false)}
          >
            {cleanChildren}
          </CollapsibleMeta>
        );
      }
      if (fullText.includes(':::toolCall')) {
        const toolName = extractToolCallName(fullText);
        const { icon: ToolIcon, color: toolColor } = getToolIconAndColor(toolName);
        const headerTitle = toolName
          ? `${t('chat.toolCallingTitle', { defaultValue: '工具调用' })} · ${toolName}`
          : t('chat.systemTool', { defaultValue: '系统工具' });

        return (
          <CollapsibleMeta
            title={headerTitle}
            icon={ToolIcon}
            iconStyle={{ color: toolColor }}
            defaultExpanded={false}
            {...metaBlockExpansionProps('toolCall', false)}
          >
            <div className="v3-terminal-body">
              <div className="v3-terminal-line">
                <span className="v3-terminal-prompt" style={{ color: toolColor }}>$</span>
                <span className="v3-terminal-output" style={{ color: '#f8fafc', fontWeight: 'bold' }}>call {toolName || 'tool'}</span>
              </div>
              <div style={{ marginTop: 8, color: '#94a3b8' }}>
                {cleanChildren}
              </div>
            </div>
          </CollapsibleMeta>
        );
      }
      if (fullText.includes(':::toolResult')) {
        const toolName = extractToolResultName(fullText);
        const fenced = extractCodeFence(fullText, 'json');
        const bodyRaw = fenced ? fenced : stripToolResultWrapper(fullText);
        const maybePretty = bodyRaw ? prettyJsonMaybe(bodyRaw) : '';
        const headerTitle = toolName
          ? `${t('chat.toolResult', { defaultValue: '工具结果' })} · ${toolName}`
          : t('chat.toolResult', { defaultValue: '工具结果' });
        const { icon: ToolIcon, color: toolColor } = getToolIconAndColor(toolName);

        return (
          <CollapsibleMeta
            title={headerTitle}
            icon={ToolIcon}
            iconStyle={{ color: toolColor }}
            defaultExpanded={false}
            {...metaBlockExpansionProps(`toolResult:${toolName || 'default'}`, false)}
          >
            <div className="v3-terminal-body">
              <div className="v3-terminal-line" style={{ marginBottom: 8, borderBottom: '1px solid #1e293b', paddingBottom: 6 }}>
                <span className="v3-terminal-prompt" style={{ color: toolColor }}>$</span>
                <span className="v3-terminal-output" style={{ color: '#94a3b8', fontWeight: 'bold' }}>cat result_{toolName || 'output'}.json</span>
              </div>
              {maybePretty ? (
                <pre style={{ margin: 0, color: '#10b981', background: 'transparent', border: 'none', padding: 0 }}>
                  {maybePretty}
                </pre>
              ) : (
                <div style={{ whiteSpace: 'pre-wrap', color: '#10b981' }}>
                  {cleanChildren}
                </div>
              )}
            </div>
          </CollapsibleMeta>
        );
      }
      if (fullText.includes(':::analysis')) {
        const analysisCopyText = stripContainerWrapper(fullText, 'analysis') || '';
        const analysisBlockKey = allocMetaBlockInstanceKey('analysis');
        return (
          <CollapsibleMeta
            title={t('chat.analysisProcess', { defaultValue: '分析过程' })}
            icon={Search}
            iconStyle={{ color: '#6366f1' }}
            defaultExpanded={false}
            {...metaBlockExpansionProps(analysisBlockKey, false)}
            copyText={analysisCopyText}
            onCopy={(txt: string) => copyToClipboard(txt)}
            copyLabel={t('chat.copy', { defaultValue: '复制' })}
          >
            {cleanChildren}
          </CollapsibleMeta>
        );
      }
      if (fullText.includes(':::commandOutput')) {
        const titleMatch = fullText.match(/^\s*:::commandOutput\s*\n+\s*\*\*([^*\n]+)\*\*/);
        const subtitle = titleMatch ? titleMatch[1].trim() : '';
        const headerTitle = subtitle ? `Command Output · ${subtitle}` : 'Command Output';
        const { icon: ToolIcon, color: toolColor } = getToolIconAndColor('command');
        const commandCopyText = stripContainerWrapper(fullText, 'commandOutput') || '';
        const commandBlockKey = `commandOutput:${subtitle || 'default'}`;

        return (
          <CollapsibleMeta
            title={headerTitle}
            icon={ToolIcon}
            iconStyle={{ color: toolColor }}
            defaultExpanded={false}
            {...metaBlockExpansionProps(commandBlockKey, false)}
            copyText={commandCopyText}
            onCopy={(txt: string) => copyToClipboard(txt)}
            copyLabel={t('chat.copy', { defaultValue: '复制' })}
          >
            <TerminalBody
              toolColor={toolColor}
              subtitle={subtitle}
              scrollState={getTerminalScrollState(commandBlockKey)}
            >
              {cleanChildren}
            </TerminalBody>
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

        const isApproved = rawContent.includes('✅') || rawContent.includes('已批准') || isClicked;
        const isRejected = rawContent.includes('❌') || rawContent.includes('已拒绝');
        const isTimeout = rawContent.includes('⏱️') || rawContent.includes('已超时');

        let statusClass = '';
        if (isApproved) statusClass = 'approved';
        else if (isRejected) statusClass = 'rejected';
        else if (isTimeout) statusClass = 'timeout';

        return (
          <div className={`v3-approval-shield-card ${statusClass}`} style={{ margin: '12px 0', padding: '16px', borderRadius: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, color: isApproved ? '#10b981' : (isRejected ? '#ef4444' : (isTimeout ? '#94a3b8' : '#f97316')) }}>
              {isApproved ? <ShieldCheck size={18} /> : (isRejected ? <ShieldAlert size={18} /> : <Shield size={18} />)}
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {isApproved 
                  ? t('chat.approvedAndExecuting', { defaultValue: '安全授权已核准' })
                  : isRejected 
                    ? t('chat.rejectedAction', { defaultValue: '授权请求已拒绝' })
                    : isTimeout 
                      ? t('chat.approvalTimeout', { defaultValue: '授权请求已超时' })
                      : t('chat.approvalRequired', { defaultValue: '需要安全授权审批' })}
              </span>
            </div>
            
            <div style={{ marginBottom: 12, padding: '10px 12px', background: '#030712', borderRadius: 8, border: '1px solid #1e293b' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, color: '#fca5a5', fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
                <ShieldAlert size={12} style={{ color: '#f97316' }} />
                <span>PROPOSED ACTION</span>
              </div>
              <div style={{ opacity: 0.95, color: '#f3f4f6', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
                {cleanChildren}
              </div>
            </div>

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
          <div style={{ margin: '12px 0', padding: '12px', background: isDarkMode ? 'rgba(120, 53, 15, 0.35)' : '#fffbeb', border: isDarkMode ? '1px solid #b45309' : '1px solid #fef3c7', borderRadius: 8, fontSize: 12, color: isDarkMode ? '#fde68a' : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, color: isDarkMode ? '#fbbf24' : '#d97706' }}>
              <ShieldAlert size={14} />
              <span style={{ fontWeight: 600 }}>{title}</span>
            </div>
            {cleanChildren}
          </div>
        );
      }
      return (
        <blockquote className="v3-quote" style={{ borderLeft: `4px solid ${isUser ? 'var(--v3-user-border, rgba(255,255,255,0.7))' : 'var(--v3-border, #e2e8f0)'}`, padding: '8px 10px', paddingLeft: 12, color: isUser ? 'var(--v3-user-text, rgba(255,255,255,0.92))' : (isDarkMode ? 'var(--v3-text-muted, #94a3b8)' : 'var(--v3-text-muted, #64748b)'), background: isUser ? 'var(--v3-user-surface, rgba(255,255,255,0.12))' : (isDarkMode ? 'rgba(51, 65, 85, 0.45)' : 'rgba(241, 245, 249, 0.6)'), borderRadius: 10, margin: '8px 0', fontStyle: 'normal' }}>
          {children}
        </blockquote>
      );
    },
    code: ({ inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';
      const codeVal = String(children).replace(/\n$/, '');
      const isInline = inline !== undefined ? inline : !className;

      if (!isInline && (language === 'bash' || language === 'sh' || language === 'shell')) {
        return (
          <ActionableCommandCard
            command={codeVal}
            isDarkMode={isDarkMode}
            t={t}
          />
        );
      }

      if (!isInline && language === 'html') {
        return (
          <ArtifactCard
            type="html"
            code={codeVal}
            messageId={String(msg.id || msg.runId || index)}
            isDarkMode={isDarkMode}
            isMobile={isMobile}
            t={t}
            isStreaming={isLast && isTyping}
          />
        );
      }
      if (!isInline && language === 'mermaid') {
        return (
          <ArtifactCard
            type="mermaid"
            code={codeVal}
            messageId={String(msg.id || msg.runId || index)}
            isDarkMode={isDarkMode}
            isMobile={isMobile}
            t={t}
            isStreaming={isLast && isTyping}
          />
        );
      }
      if (!isInline && (language === 'svg' || (language === 'xml' && codeVal.trim().startsWith('<svg')))) {
        return (
          <ArtifactCard
            type="svg"
            code={codeVal}
            messageId={String(msg.id || msg.runId || index)}
            isDarkMode={isDarkMode}
            isMobile={isMobile}
            t={t}
            isStreaming={isLast && isTyping}
          />
        );
      }

      if (!isInline && isEchartsCodeFenceLanguage(language)) return <ECharts optionStr={codeVal} isTyping={isLast && isTyping} />;
      if (!isInline && language) return <CodeBlock language={language} value={codeVal} isMobile={isMobile} {...props} />;
      const openablePath = isInline ? getOpenableFilePath(codeVal) : null;
      return (
        <>
          <code
            {...props}
            style={{
              padding: '0.2em 0.4em',
              backgroundColor: isUser
                ? 'var(--v3-user-surface, rgba(255,255,255,0.12))'
                : (isDarkMode ? 'rgba(148, 163, 184, 0.18)' : 'rgba(175, 184, 193, 0.2)'),
              color: isUser ? 'var(--v3-user-text, #fff)' : (isDarkMode ? '#e2e8f0' : '#1e293b'),
              borderRadius: '6px',
              fontSize: '85%',
            }}
          >
            {children}
          </code>
          {openablePath && !isUser && (
            <InlineFileOpenButton
              path={openablePath}
              messageId={String(msg.id || msg.runId || index)}
              isDarkMode={isDarkMode}
              isMobile={isMobile}
              currentWorkspacePath={currentWorkspacePath}
            />
          )}
        </>
      );
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
    <>
      <style>{`
        /* 芯片呼吸自转 */
        @keyframes v3-thinking-chip-spin {
          0% { transform: rotate(0deg) scale(1); filter: drop-shadow(0 0 2px rgba(124, 58, 237, 0.4)); }
          50% { transform: rotate(180deg) scale(1.1); filter: drop-shadow(0 0 8px rgba(124, 58, 237, 0.75)); }
          100% { transform: rotate(360deg) scale(1); filter: drop-shadow(0 0 2px rgba(124, 58, 237, 0.4)); }
        }
        .v3-thinking-live-icon {
          animation: v3-thinking-chip-spin 3s linear infinite !important;
          color: #7c3aed !important;
        }
        
        /* 芯片外环发光带 */
        @keyframes v3-thinking-card-glow {
          0%, 100% { border-color: rgba(124, 58, 237, 0.15); box-shadow: 0 4px 12px rgba(0,0,0,0.02); }
          50% { border-color: rgba(124, 58, 237, 0.35); box-shadow: 0 6px 20px rgba(124, 58, 237, 0.12); }
        }
        .v3-thinking-card-active {
          animation: v3-thinking-card-glow 3s infinite ease-in-out !important;
          border: 1px solid rgba(124, 58, 237, 0.25) !important;
        }

        /* 极客终端等宽样式与提示符 */
        .v3-terminal-body {
          background: #030712 !important;
          border: 1px solid ${isDarkMode ? '#334155' : '#e2e8f0'} !important;
          border-radius: 8px !important;
          padding: 12px 14px !important;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace !important;
          color: #10b981 !important;
          font-size: 12px !important;
          line-height: 1.6 !important;
          overflow-x: auto !important;
          box-shadow: inset 0 2px 8px rgba(0,0,0,0.6) !important;
        }
        .v3-terminal-line {
          display: flex;
          align-items: flex-start;
          gap: 6px;
        }
        .v3-terminal-prompt {
          color: #3b82f6 !important;
          font-weight: bold;
          user-select: none;
        }
         .v3-terminal-output {
          color: #10b981 !important;
        }
        /* 终极文字亮白保护：强制终端内所有文本标签以亮白显示，动态赋色元素及提示符自动保留 */
        .v3-terminal-body *:not([class*="prompt"]):not([style*="color"]) {
          color: #f8fafc !important;
        }

        /* 极客物理弹跳打字点动画 */
        @keyframes v3-dots-pulse {
          0%, 100% { opacity: 0.35; transform: translateY(0) scale(1); }
          50% { opacity: 1; transform: translateY(-4.5px) scale(1.2); }
        }
        .v3-typing-dots {
          display: inline-flex;
          align-items: center;
          gap: 2px;
          margin-left: 4px;
        }
        .v3-typing-dots span {
          animation: v3-dots-pulse 1.0s infinite cubic-bezier(0.18, 0.89, 0.32, 1.28);
          font-weight: 900;
          font-size: 15px;
          line-height: 1;
          color: inherit;
        }
        .v3-typing-dots span:nth-child(1) { animation-delay: 0s; }
        .v3-typing-dots span:nth-child(2) { animation-delay: 0.08s; }
        .v3-typing-dots span:nth-child(3) { animation-delay: 0.16s; }
        .v3-typing-dots span:nth-child(4) { animation-delay: 0.24s; }
        .v3-typing-dots span:nth-child(5) { animation-delay: 0.32s; }
        .v3-typing-dots span:nth-child(6) { animation-delay: 0.4s; }

        .v3-stream-stall-hint {
          padding: 6px 12px !important;
          margin-top: 6px !important;
          margin-bottom: 6px !important;
        }
        .v3-stream-stall-hint-text {
          display: inline-flex !important;
          align-items: center !important;
        }

        /* 折叠平滑阻尼卷轴过渡 */
        .v3-collapsible-wrapper {
          display: grid;
          grid-template-rows: 0fr;
          transition: grid-template-rows 0.35s cubic-bezier(0.25, 1, 0.5, 1);
          overflow: hidden;
        }
        .v3-collapsible-wrapper.expanded {
          grid-template-rows: 1fr;
        }
        .v3-collapsible-content {
          min-height: 0;
          transition: opacity 0.25s ease, transform 0.3s cubic-bezier(0.25, 1, 0.5, 1);
          opacity: 0;
          transform: translateY(6px);
        }
        .v3-collapsible-wrapper.expanded .v3-collapsible-content {
          opacity: 1;
          transform: translateY(0);
          transition-delay: 0.05s;
        }

        /* 零信任安全盾牌审批卡片 */
        @keyframes v3-shield-breathing {
          0%, 100% { box-shadow: 0 4px 16px rgba(0,0,0,0.03), 0 0 0 1px rgba(249, 115, 22, 0.15); }
          50% { box-shadow: 0 8px 24px rgba(249, 115, 22, 0.12), 0 0 0 3px rgba(249, 115, 22, 0.35); }
        }
        .v3-approval-shield-card {
          border: 1px solid rgba(249, 115, 22, 0.25) !important;
          background: ${isDarkMode ? 'rgba(30, 41, 59, 0.45)' : 'rgba(255, 251, 235, 0.35)'} !important;
          animation: v3-shield-breathing 3s infinite ease-in-out !important;
          backdrop-filter: blur(12px) !important;
          transition: all 0.4s cubic-bezier(0.25, 1, 0.5, 1) !important;
        }
        .v3-approval-shield-card.approved {
          border-color: rgba(16, 185, 129, 0.4) !important;
          background: ${isDarkMode ? 'rgba(6, 78, 59, 0.25)' : 'rgba(240, 253, 250, 0.45)'} !important;
          animation: none !important;
          box-shadow: 0 4px 16px rgba(16, 185, 129, 0.08) !important;
        }
      `}</style>
      <div 
        className={`message-in ${isUser ? 'v3-message-user' : 'v3-message-assistant'}`} 
        style={{ 
          display: 'flex', gap: 14, flexDirection: isUser ? 'row-reverse' : 'row',
          animation: 'v3-message-enter 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) forwards' 
        }}
      >
      {isUser ? (
        <div style={{ flexShrink: 0, marginTop: 4, visibility: 'visible', position: 'relative' }}>
          <Avatar icon={<User size={18} />} style={{ background: '#1e293b', flexShrink: 0 }} />
        </div>
      ) : isMetaOnly ? (
        // 思考信息附录气泡：不占头像位，保留尺寸以与主气泡对齐
        <div style={{ flexShrink: 0, marginTop: 4, width: isMobile ? 32 : 36, height: isMobile ? 32 : 36 }} />
      ) : (
        <div style={{ flexShrink: 0, marginTop: 4, visibility: 'visible', position: 'relative' }}>
          <div style={{ 
            width: isMobile ? 32 : 36, height: isMobile ? 32 : 36, borderRadius: '50%', 
            background: isSubAgent ? '#f0fdfa' : '#eef2ff', 
            display: 'flex', alignItems: 'center', justifyContent: 'center', 
            border: isSubAgent ? '1px solid #99f6e4' : '1px solid #c7d2fe' 
          }}>
            {isSubAgent ? (
              <GitBranch size={isMobile ? 18 : 20} color="#0d9488" />
            ) : (
              <Bot size={isMobile ? 22 : 25} color="var(--v3-primary, #6366f1)" />
            )}
          </div>
          {isSubAgent && subAgentId && (
            <div style={{ 
              position: 'absolute', bottom: -12, left: '50%', transform: 'translateX(-50%)',
              fontSize: 9, color: '#0d9488', background: '#f0fdfa', padding: '0 4px', 
              borderRadius: 4, border: '1px solid #99f6e4', whiteSpace: 'nowrap',
              fontWeight: 600
            }}>
              Sub:{subAgentId}
            </div>
          )}
        </div>
      )}
      
      <div style={{ 
        width: hasEchartsBlock ? 'min(860px, calc(100% - 56px))' : undefined,
        maxWidth: isMobile ? '92%' : (hasEchartsBlock ? '92%' : '85%'),
        padding: isMetaOnly ? (isMobile ? '8px 12px' : '10px 14px') : (isMobile ? '10px 14px' : '12px 18px'),
        borderRadius: isUser ? '18px 18px 4px 18px' : (isMetaOnly ? 12 : '4px 18px 18px 18px'),
        background: isUser
          ? 'var(--v3-user-bubble, #4b5bdc)'
          : (isMetaOnly ? (isDarkMode ? '#0f172a' : '#f8fafc') : 'var(--v3-surface, #fff)'),
        color: isUser ? 'var(--v3-user-text, #fff)' : 'var(--v3-text, #1e293b)',
        boxShadow: isUser ? '0 4px 15px var(--v3-user-bubble-shadow, rgba(79, 70, 229, 0.15))' : (isMetaOnly ? 'none' : (isDarkMode ? '0 4px 12px rgba(0,0,0,0.35)' : '0 4px 12px rgba(0,0,0,0.03)')),
        border: !isUser ? `1px ${isMetaOnly ? (isDarkMode ? 'dashed #475569' : 'dashed #cbd5e1') : 'solid var(--v3-border, #e8eff6)'}` : 'none',
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
              autoFocus
              autoSize={{ minRows: 2, maxRows: 15 }}
              value={editDraft}
              onChange={(e) => {
                const v = e.target.value;
                setEditDraft(v);
                setEditContent(v);
              }}
              style={{ borderRadius: 12, border: isUser ? '1px solid rgba(255,255,255,0.3)' : (isDarkMode ? '1px solid #334155' : '1px solid #e2e8f0'), background: isUser ? 'rgba(255,255,255,0.1)' : (isDarkMode ? '#0f172a' : 'rgba(255,255,255,0.95)'), color: isUser ? '#fff' : (isDarkMode ? '#e2e8f0' : '#1e293b'), fontSize: isMobile ? 13 : 14 }}
            />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <Button size="small" ghost={isUser} onClick={onCancelEdit}>{t('common.cancel')}</Button>
              <Button size="small" style={isUser ? { background: '#fff', color: '#2563eb', border: 'none', fontWeight: 600 } : (isDarkMode ? { background: '#334155', color: '#e0e7ff', border: '1px solid #475569', fontWeight: 600 } : { background: '#fff', color: '#2563eb', border: 'none', fontWeight: 600 })} onClick={onSaveEdit}>{t('chat.saveAndRegenerate', { defaultValue: '重新生成' })}</Button>
            </div>
          </div>
        ) : (
          // 主气泡尚无嵌入 meta、且仍处于思考占位时：显示思考文案 + 转圈；已有嵌入 meta 时走正文与底部折叠区（默认折叠）。
          isThinkingState && !hasEmbeddedMeta ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 13, color: isDeepThinking ? '#7c3aed' : (isDarkMode ? '#94a3b8' : '#64748b'), fontWeight: isDeepThinking ? 600 : 400 }}>
                {thinkingLabel}
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
                {!processedContentWithoutMeta && isTyping && isLast && msg.role === 'assistant' ? (
                  <div
                    className="v3-stream-stall-hint"
                    style={{ margin: 0, padding: 0, border: 'none', background: 'transparent' }}
                  >
                    <span className="v3-stream-stall-hint-text" style={{ color: isDarkMode ? '#94a3b8' : '#64748b', fontSize: '13px', fontWeight: 500 }}>
                      {t('chat.streamStalledHint', { defaultValue: 'Lobster 正在思考回复中' }).replace(/[\.\.。…\s]+$/, '')}
                      <span className="v3-typing-dots">
                        <span>.</span><span>.</span><span>.</span><span>.</span><span>.</span><span>.</span>
                      </span>
                    </span>
                  </div>
                ) : (
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
                )}
              </div>

              {hasEmbeddedMeta && (() => {
                // 嵌入式折叠区：挂在主气泡正文最底部
                const thinkingShort = t('chat.metaFoldThinkingShort', { defaultValue: '思考中…' });
                const toolCount = (processedMetaContent.match(/:::toolCall\b/g) || []).length;
                const toolCountSuffix = toolCount > 0 ? `，已调用 ${toolCount} 轮工具` : '';
                const toolCountSuffixCompleted = toolCount > 0 ? ` (共调用 ${toolCount} 轮工具)` : '';

                const suffixLabel = metaExpanded
                  ? `${t('chat.metaFoldCollapse', { defaultValue: '点击折叠本次思考或工具调用' })}${toolCountSuffixCompleted}`
                  : metaFoldGenerationUi
                    ? (metaFoldIsToolCallGenerating
                      ? `${t('chat.metaFoldExpandLiveTool', { defaultValue: '工具调用生成中' })}${toolCountSuffix}`
                      : `${t('chat.metaFoldExpandLive', { defaultValue: '点击展开查看思考或工具调用' })}${toolCountSuffix}`)
                    : `${t('chat.metaFoldExpand', { defaultValue: '点击展开本次思考或工具调用' })}${toolCountSuffixCompleted}`;
                const embedLabel =
                  !metaExpanded && metaFoldGenerationUi ? `${thinkingShort} · ${suffixLabel}` : suffixLabel;
                return (
                  <div style={{ marginTop: 10 }}>
                    {!showThinking ? (() => {
                      // 💡 当关闭「显示思考」时：渲染不可点击的静态信息。
                      // 运行中以带虚线渐变、旋转 Loader 的胶囊卡片来安抚用户；已完成则以翠绿色打勾的极简系统小注脚（Caption）展示，消除按钮错觉。
                      const toolCount = (processedMetaContent.match(/:::toolCall\b/g) || []).length;
                      const isLive = metaFoldGenerationUi || (isTyping && isLast);
                      const statusText = isLive
                        ? t('chat.metaFoldOfflineLive', { defaultValue: `思考或工具调用中，已调用 ${toolCount} 轮工具，请稍后...` })
                        : t('chat.metaFoldOfflineCompleted', { defaultValue: `思考与工具调用已完成，共调用 ${toolCount} 轮工具` });

                      if (!isLive) {
                        return (
                          <div
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '6px',
                              fontSize: '11px',
                              color: isDarkMode ? '#64748b' : '#94a3b8',
                              padding: '2px 4px',
                              userSelect: 'none',
                              marginTop: '2px',
                              lineHeight: '1.2'
                            }}
                          >
                            <Check size={12} strokeWidth={3} style={{ color: '#10b981', flexShrink: 0 }} aria-hidden />
                            <span style={{ fontWeight: 500 }}>{statusText}</span>
                          </div>
                        );
                      }

                      return (
                        <div
                          className="v3-meta-fold-chip"
                          style={{ 
                            cursor: 'default', 
                            userSelect: 'none',
                            borderStyle: 'dashed',
                            background: 'linear-gradient(135deg, rgba(248, 250, 252, 0.95) 0%, rgba(238, 242, 255, 0.95) 100%)',
                            color: '#4f46e5',
                            borderColor: '#c7d2fe',
                            boxShadow: 'none',
                            animation: 'none'
                          }}
                        >
                          <Loader2 size={14} strokeWidth={2} className="v3-thinking-spinner" style={{ color: '#4f46e5', flexShrink: 0 }} aria-hidden />
                          <span style={{ fontWeight: 600 }}>{statusText}</span>
                        </div>
                      );
                    })() : (
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
                    )}
                    {metaExpanded && (
                      <div
                        className="markdown-body-v3 v3-meta-embedded"
                        style={{
                          background: isDarkMode ? '#0f172a' : '#f8fafc',
                          border: isDarkMode ? '1px dashed #475569' : '1px dashed #cbd5e1',
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

              {!isMetaOnly && !hasEmbeddedMeta && isStalled && isTyping && isLast && msg.role === 'assistant' && (
                <div
                  className="v3-stream-stall-hint"
                  role="status"
                  aria-live="polite"
                  aria-relevant="additions text"
                >
                  <span className="v3-stream-stall-hint-text">
                    {t('chat.streamStalledHint', { defaultValue: 'AI 还在思考中，请稍等一下' }).replace(/[\.\.。…\s]+$/, '')}
                    <span className="v3-typing-dots">
                      <span>.</span><span>.</span><span>.</span><span>.</span><span>.</span><span>.</span>
                    </span>
                  </span>
                </div>
              )}

              {!isMetaOnly && (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: isUser ? 'flex-end' : 'flex-start', gap: 6, marginTop: 6, fontSize: 10, color: isUser ? 'rgba(255,255,255,0.7)' : '#94a3b8' }} className="msg-footer">
                {!(isTyping && isLast) && (
                  <div style={{ display: 'flex', gap: 2 }}>
                    <Tooltip title={t('chat.copy')}><Button type="text" size="small" icon={<Copy size={11} />} onClick={() => copyToClipboard(msg.content)} style={{ color: isUser ? 'rgba(255,255,255,0.85)' : (isDarkMode ? '#94a3b8' : '#64748b') }} /></Tooltip>
                    <Tooltip title={t('chat.reply')}><Button type="text" size="small" icon={<Quote size={11} />} onClick={() => onQuote(getCleanQuoteContent(msg.content, msg.role))} style={{ color: isUser ? 'rgba(255,255,255,0.85)' : (isDarkMode ? '#94a3b8' : '#64748b') }} /></Tooltip>
                    {!isUser && onSaveToWorkspace && (
                      <Tooltip title={t('chat.saveToWorkspace', { defaultValue: '保存到工作区' })}>
                        <Button type="text" size="small" icon={<Save size={11} />} onClick={() => onSaveToWorkspace(msg.content)} style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} />
                      </Tooltip>
                    )}
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
                          style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} 
                        />
                      </Tooltip>
                    )}
                    {isUser && <Tooltip title={t('common.edit')}><Button type="text" size="small" icon={<Pencil size={11} />} onClick={() => onEdit(index, msg.content)} style={{ color: 'rgba(255,255,255,0.85)' }} /></Tooltip>}
                    {!isUser && isLast && <Tooltip title={t('chat.retry')}><Button type="text" size="small" icon={<RefreshCw size={11} />} onClick={onRegenerate} style={{ color: isDarkMode ? '#94a3b8' : '#64748b' }} /></Tooltip>}
                  </div>
                )}
                <span>{msg.timestamp}</span>
                {!isMobile && !isUser && msg.metrics && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 4 }}>
                    <div style={{ width: 1, height: 8, background: isDarkMode ? '#334155' : '#e2e8f0' }}></div>
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
  </>
  );
};

export default React.memo(V3MessageItem, (prev, next) => {
  const prevTpsLast = prev.tpsData && prev.tpsData.length > 0 ? prev.tpsData[prev.tpsData.length - 1] : undefined;
  const nextTpsLast = next.tpsData && next.tpsData.length > 0 ? next.tpsData[next.tpsData.length - 1] : undefined;
  const prevMetrics = prev.msg.metrics || {};
  const nextMetrics = next.msg.metrics || {};

  return prev.isMobile === next.isMobile &&
         prev.isDarkMode === next.isDarkMode &&
         prev.index === next.index &&
         prev.t === next.t &&
         prev.selectedBot === next.selectedBot &&
         prev.currentWorkspacePath === next.currentWorkspacePath &&
         prev.setEditContent === next.setEditContent &&
         prev.onEdit === next.onEdit &&
         prev.onSaveEdit === next.onSaveEdit &&
         prev.onCancelEdit === next.onCancelEdit &&
         prev.onDelete === next.onDelete &&
         prev.onQuote === next.onQuote &&
         prev.onSend === next.onSend &&
         prev.onSaveToWorkspace === next.onSaveToWorkspace &&
         prev.onRegenerate === next.onRegenerate &&
         prev.copyToClipboard === next.copyToClipboard &&
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
