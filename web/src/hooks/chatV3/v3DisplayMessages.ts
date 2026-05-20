import type { Message } from '../useChatV3WebSocket';

export type V3VisibleMessagesOptions = {
  showThinking: boolean;
  isTyping?: boolean;
};

/** 识别那些只有元数据（思考、工具、计划）而没有实际正文回复的消息 */
export function isAssistantSkeletonContent(content: string): boolean {
  const t = (content || '').trim();
  if (!t) return false;

  const hasMetadata =
    t.includes(':::thinking') ||
    t.includes(':::plan') ||
    t.includes(':::commandOutput') ||
    t.includes(':::toolCall') ||
    t.includes(':::toolResult') ||
    t.includes('🔧') ||
    t.includes('✅') ||
    t.includes('❌');
  if (!hasMetadata) return false;

  const rest = t
    .replace(/> :::thinking[\s\S]*?:::\s*/g, '')
    .replace(/> :::plan[\s\S]*?:::\s*/g, '')
    .replace(/> :::commandOutput[\s\S]*?:::\n*/g, '')
    .replace(/> :::toolCall[\s\S]*?:::\n*/g, '')
    .replace(/(?:^|\n)\s*(?:>\s*)?:::toolResult[\s\S]*?(?:^|\n)\s*(?:>\s*)?:::\s*/g, '\n')
    .replace(
      /<(anti-hallucination-guardrails|ephemeral_message|available_skills|relevant[-_]memories|thought|think|thought_process|reasoning|system_instruction)\b[^>]*>[\s\S]*?<\/\1>/gi,
      '',
    )
    .replace(
      /\[(search|coding)-mode|Bootstrap truncation warning|Queued user message that arrived while the previous turn was still active\][\s\S]*?(?=\n\n|\n\s*\[|\n\s*<|$)/gi,
      '',
    )
    .replace(/^(?:System \(untrusted\):|System:).*?(?:\n|$)/gm, '')
    .replace(/(?:^|\n)\s*\[(?:[A-Z][a-z]{2} )?\d{4}-\d{2}-\d{2} \d{2}:\d{2}(?::\d{2})? GMT[+-]\d+\]\s*/g, '\n')
    .replace(/>\s*[🔧✅❌⚠️]\s*`[^`]+`\s*(?:执行中(?:…|\.{3})|完成|失败|错误)(?:\s*<!--[\s\S]*?-->)?/g, '')
    .replace(/<!--\s*tool:[^>]*-->/g, '')
    .replace(/[.\s…]+$/g, '')
    .trim();

  return rest.length === 0;
}

/** 与 V3MessagePane.visibleMessages 相同的可见性过滤 */
export function filterVisibleV3Messages(messages: Message[], opts: V3VisibleMessagesOptions): Message[] {
  const { showThinking, isTyping = false } = opts;
  return messages.filter(m => {
    if ((m as any)._uiMetaOnly) return false;

    const content = (m.content || '').trim();

    if ((m as any).role === 'toolResult') {
      return !!showThinking;
    }

    if (m.role === 'user') {
      const sl = (m.senderLabel || '').toLowerCase();
      if (sl === 'system' || sl === 'heartbeat') return false;
      if (!sl) {
        if (/^System\s*(\(.*\))?:/.test(content)) return false;
        if (content.includes('Read HEARTBEAT.md if it exists')) return false;
      }
    }

    if (m.role === 'assistant') {
      if (content === 'HEARTBEAT_OK') return false;
      const isLastAndTyping = isTyping && m.id === messages[messages.length - 1]?.id;
      if (!showThinking && isAssistantSkeletonContent(content) && !isLastAndTyping) {
        return false;
      }
    }

    return true;
  });
}

/** 按 runId 聚合 _uiMetaOnly 气泡内容（showThinking 关闭时为空） */
export function buildMetaContentByRunId(messages: Message[], showThinking: boolean): Map<string, string> {
  const map = new Map<string, string>();
  if (!showThinking) return map;
  for (const m of messages) {
    if (!(m as any)._uiMetaOnly) continue;
    if (!m.runId || !m.content) continue;
    map.set(m.runId, m.content);
  }
  return map;
}

export function sanitizeMetaContentForExport(meta: string): string {
  return meta.replace(/(?:^|\n)\s*>\s*<!--agentItem:[^>]*-->\s*/g, '\n').trim();
}

/**
 * 导出用：先按界面规则过滤，再把同 runId 的思考/工具 meta 并入主助手气泡正文（与气泡底部展示一致）。
 */
export function prepareMessagesForV3Export(messages: Message[], opts: V3VisibleMessagesOptions): Message[] {
  const visible = filterVisibleV3Messages(messages, opts);
  const metaMap = buildMetaContentByRunId(messages, opts.showThinking);

  return visible.map(m => {
    if (m.role !== 'assistant' || !m.runId) return m;
    const meta = metaMap.get(m.runId);
    if (!meta) return m;
    const processed = sanitizeMetaContentForExport(meta);
    if (!processed) return m;
    const mainBody = (m.content || '').trim();
    return { ...m, content: mainBody ? `${mainBody}\n\n${processed}` : processed };
  });
}
