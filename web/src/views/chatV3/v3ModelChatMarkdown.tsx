import { useMemo, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import rehypeSanitize from 'rehype-sanitize';
import { CodeBlock } from '../../components/ChatComponents';

export type V3ModelChatMarkdownProps = {
  content: string;
  isDarkMode?: boolean;
  /** 用户气泡（深色底）与助手气泡样式不同 */
  isUser?: boolean;
};

/**
 * 模型试聊抽屉专用 Markdown：GFM + 代码高亮，样式对齐主会话 markdown-body-v3。
 */
export function V3ModelChatMarkdown({ content, isDarkMode = false, isUser = false }: V3ModelChatMarkdownProps) {
  const components = useMemo(() => {
    const preBg = isUser
      ? 'rgba(255,255,255,0.12)'
      : isDarkMode
        ? '#0f172a'
        : '#f8fafc';
    const preColor = isUser ? '#f8fafc' : isDarkMode ? '#e2e8f0' : '#1e293b';
    const preBorder = isUser
      ? '1px solid rgba(255,255,255,0.22)'
      : isDarkMode
        ? '1px solid #334155'
        : '1px solid #e2e8f0';

    return {
      p: ({ children }: { children?: ReactNode }) => (
        <p style={{ margin: '0 0 8px', wordBreak: 'break-word', overflowWrap: 'anywhere' }}>{children}</p>
      ),
      pre: ({ children }: { children?: ReactNode }) => (
        <pre
          style={{
            overflowX: 'auto',
            maxWidth: '100%',
            margin: '8px 0',
            padding: '10px',
            borderRadius: 8,
            background: preBg,
            color: preColor,
            border: preBorder,
          }}
        >
          {children}
        </pre>
      ),
      code: ({ inline, className, children, ...props }: { inline?: boolean; className?: string; children?: ReactNode }) => {
        const match = /language-(\w+)/.exec(className || '');
        const language = match?.[1] || '';
        if (!inline && language) {
          return (
            <CodeBlock language={language} value={String(children).replace(/\n$/, '')} isMobile={false} {...props} />
          );
        }
        if (inline) {
          return (
            <code
              {...props}
              style={{
                padding: '2px 6px',
                borderRadius: 4,
                fontSize: '0.9em',
                background: isUser ? 'rgba(255,255,255,0.18)' : isDarkMode ? '#334155' : '#f1f5f9',
                color: 'inherit',
              }}
            >
              {children}
            </code>
          );
        }
        return (
          <code
            {...props}
            style={{
              padding: '2px 6px',
              borderRadius: 4,
              fontSize: '0.9em',
              background: isUser ? 'rgba(255,255,255,0.18)' : isDarkMode ? '#334155' : '#f1f5f9',
              color: 'inherit',
            }}
          >
            {children}
          </code>
        );
      },
      a: ({ href, children }: { href?: string; children?: ReactNode }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: isUser ? '#c7d2fe' : 'var(--v3-link, #4f46e5)' }}>
          {children}
        </a>
      ),
      table: ({ children }: { children?: ReactNode }) => (
        <div style={{ overflowX: 'auto', margin: '8px 0' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>{children}</table>
        </div>
      ),
      th: ({ children }: { children?: ReactNode }) => (
        <th
          style={{
            border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`,
            padding: '6px 10px',
            background: isDarkMode ? '#1e293b' : '#f8fafc',
            fontWeight: 700,
            textAlign: 'left',
          }}
        >
          {children}
        </th>
      ),
      td: ({ children }: { children?: ReactNode }) => (
        <td style={{ border: `1px solid ${isDarkMode ? '#334155' : '#e2e8f0'}`, padding: '6px 10px' }}>{children}</td>
      ),
      blockquote: ({ children }: { children?: ReactNode }) => (
        <blockquote
          style={{
            borderLeft: `4px solid ${isUser ? 'rgba(255,255,255,0.4)' : isDarkMode ? '#475569' : '#cbd5e1'}`,
            paddingLeft: 12,
            margin: '8px 0',
            opacity: 0.92,
            fontStyle: 'italic',
          }}
        >
          {children}
        </blockquote>
      ),
      ul: ({ children }: { children?: ReactNode }) => (
        <ul style={{ paddingLeft: 20, margin: '6px 0' }}>{children}</ul>
      ),
      ol: ({ children }: { children?: ReactNode }) => (
        <ol style={{ paddingLeft: 20, margin: '6px 0' }}>{children}</ol>
      ),
    };
  }, [isDarkMode, isUser]);

  const className = [
    'markdown-body-v3',
    'v3-model-chat-md',
    isUser ? 'v3-model-chat-md--user' : '',
    isDarkMode ? 'v3-model-chat-md--dark' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} style={{ fontSize: 13, lineHeight: 1.6, color: 'inherit' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} rehypePlugins={[rehypeSanitize]} components={components as any}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
