import type { Message } from '../useChatV3WebSocket';

/**
 * Agent 在触发审批卡片（exec.approval.requested）时，往往还会在文本流里重复输出
 * “需要批准…请运行 /approve … allow-once|allow-always” 的提示语。UI 已有审批卡片时，这段文字应隐藏。
 */
export function extractApprovalSlugFromHint(text: string): string {
  if (!text) return '';
  const m = /\/approve\s+([a-f0-9-]+)\s+(allow-once|allow-always)/i.exec(text);
  if (!m) return '';
  const id = m[1].replace(/-/g, '');
  return id.length >= 8 ? id.slice(0, 8) : id;
}

export function isApprovalHintText(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    (text.includes('需要批准') || text.includes('审批') || t.includes('approve')) &&
    t.includes('/approve') &&
    (t.includes('allow-once') || t.includes('allow-always'))
  );
}

export function hasApprovalCardForSlug(messages: Message[], slug: string): boolean {
  if (!slug) return false;
  // 对于长列表，从后往前搜往往能更快命中（审批卡片通常在最后几条）
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m.role === 'assistant' &&
      typeof m.content === 'string' &&
      m.content.includes(':::approval') &&
      m.content.includes(slug)
    ) {
      return true;
    }
  }
  return false;
}
