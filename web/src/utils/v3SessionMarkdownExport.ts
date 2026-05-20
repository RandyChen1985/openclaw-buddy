import type { Message } from '../hooks/useChatV3WebSocket';
import { prepareMessagesForV3Export } from '../hooks/chatV3/v3DisplayMessages';

/** 与 useV3Messages 中 chat.history 面板拉取条数一致 */
export const V3_PANEL_HISTORY_LIMIT = 200;

export type SessionMarkdownExportOptions = {
  sessionKey: string;
  label: string;
  messages: Message[];
  exportedAt?: Date;
  roleLabels?: Partial<Record<Message['role'] | 'tool', string>>;
  /** 面板仅加载最近一批历史时的提示 */
  truncated?: boolean;
  truncatedNote?: string;
};

export type ExportVisibleSessionOptions = {
  sessionKey: string;
  label: string;
  /** 当前聊天面板 messages 状态（含本地删除、流式缓存缝合） */
  panelMessages: Message[];
  showThinking: boolean;
  isTyping?: boolean;
  roleLabels?: SessionMarkdownExportOptions['roleLabels'];
  /** 与 useV3Messages CHAT_HISTORY_PANEL_LIMIT 一致 */
  panelHistoryLimit?: number;
  truncatedNote?: string;
};

/** 导出与聊天区可见内容一致的消息列表 */
export function buildVisibleMessagesForExport(opts: ExportVisibleSessionOptions): Message[] {
  return prepareMessagesForV3Export(opts.panelMessages, {
    showThinking: opts.showThinking,
    isTyping: opts.isTyping,
  });
}

function roleHeading(role: string, roleLabels: SessionMarkdownExportOptions['roleLabels']): string {
  if (role === 'user') return roleLabels?.user || 'User';
  if (role === 'assistant') return roleLabels?.assistant || 'Assistant';
  if (role === 'system') return roleLabels?.system || 'System';
  return roleLabels?.tool || role;
}

/** 将会话消息序列化为 Markdown 文档 */
export function buildSessionMarkdownExport(opts: SessionMarkdownExportOptions): string {
  const { sessionKey, label, messages, exportedAt = new Date(), roleLabels, truncated, truncatedNote } = opts;
  const sorted = [...messages].sort((a, b) => (a._sortTs || 0) - (b._sortTs || 0));
  const lines: string[] = [
    `# ${label.trim() || 'Session'}`,
    '',
    `- **Session Key:** \`${sessionKey}\``,
    `- **Exported:** ${exportedAt.toLocaleString()}`,
    `- **Messages:** ${sorted.length}`,
    ...(truncated && truncatedNote
      ? ['', `> ${truncatedNote}`]
      : []),
    '',
    '---',
    '',
  ];

  for (const msg of sorted) {
    const time = msg.timestamp || '';
    const heading = roleHeading(msg.role, roleLabels);
    lines.push(`## ${heading}${time ? ` · ${time}` : ''}`, '');
    const body = (msg.content || '').trim();
    lines.push(body || '_（空消息）_', '', '---', '');
  }

  return lines.join('\n').trimEnd() + '\n';
}

/** 生成安全文件名 */
export function suggestSessionExportFilename(label: string, sessionKey: string): string {
  const base = (label || sessionKey || 'session')
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
  const suffix = sessionKey === 'agent:main:main' ? 'main' : sessionKey.split(':').slice(-1)[0]?.slice(0, 12) || 'export';
  const stamp = new Date().toISOString().slice(0, 10);
  return `${base || 'session'}_${suffix}_${stamp}.md`;
}

export function downloadTextFile(filename: string, content: string, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
