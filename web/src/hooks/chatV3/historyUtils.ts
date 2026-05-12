import type { Message } from '../useChatV3WebSocket';
import { extractApprovalSlugFromHint, isApprovalHintText } from './approvalUtils';
import { formatMessageContent } from './messageFormat';
import { compactAssistantThinkingAfterToolInPlace, META_MESSAGE_ID_PREFIX } from './messageUtils';
import type { SessionStreamCache } from './sessionCacheTypes';
import { normalizeTranscriptNoise } from './transcriptNoise';

export function buildHistoryMessages(rawItems: any[]): Message[] {
  const items = [...rawItems].sort((a: any, b: any) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

  // 提前收集 items 中所有的审批卡片 slug，避免在 map 循环中 O(N^2) 重复格式化与扫描
  const approvalSlugs = new Set<string>();
  for (const it of items) {
    if (it.role === 'assistant' || it.role === 'bot') {
      const c = formatMessageContent(it.content);
      if (c && c.includes(':::approval')) {
        const slug = extractApprovalSlugFromHint(c);
        if (slug) approvalSlugs.add(slug);
      }
    }
  }

  const history = items.map((item: any) => {
    let content = formatMessageContent(item.content);
    if (item.role === 'toolResult' && !content.includes(':::toolResult')) {
      const toolName = item.toolName || 'unknown';
      const text = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
      content = `> :::toolResult\n> **${toolName}**\n> ${text.split('\n').join('\n> ')}\n> :::\n`;
    }

    let roleOverride: string | null = null;
    const normalizedNoise = normalizeTranscriptNoise(content);
    content = normalizedNoise.content;
    if (normalizedNoise.forceAssistantRole) roleOverride = 'assistant';

    if (isApprovalHintText(content)) {
      const slug = extractApprovalSlugFromHint(content);
      if (slug && approvalSlugs.has(slug)) {
        content = '';
      }
    }

    const rawTs = new Date(item.createdAt || item.timestamp || Date.now()).getTime();
    const finalRole = roleOverride || (item.role === 'toolResult' ? 'assistant' : item.role);
    return {
      id: item.id || `msg-${rawTs}-${Math.random().toString(36).substring(2, 7)}`,
      runId: item.runId,
      role: finalRole,
      content: content || '',
      timestamp: new Date(rawTs).toLocaleTimeString(),
      metrics: item.metrics,
      _sortTs: rawTs,
      senderLabel: item.senderLabel,
    } as Message;
  }).filter((msg: any) => msg.content && msg.content.trim() !== '');

  compactAssistantThinkingAfterToolInPlace(history);
  return history;
}

export function restoreCachedMetadataMessages(history: Message[], cache?: SessionStreamCache): void {
  if (!cache?.metadataByRunId || cache.metadataByRunId.size === 0) return;

  const lastIdxByRunId = new Map<string, number>();
  for (let i = 0; i < history.length; i++) {
    const row: any = history[i];
    if (row.role !== 'assistant' || !row.runId) continue;
    if (!cache.metadataByRunId.has(row.runId)) continue;
    lastIdxByRunId.set(row.runId, i);
  }

  // 倒序插入以免影响前面 index
  const ordered = Array.from(lastIdxByRunId.entries()).sort((a, b) => b[1] - a[1]);
  for (const [runId, idx] of ordered) {
    const row: any = history[idx];
    const saved = cache.metadataByRunId.get(runId);
    if (!saved) continue;
    const alreadyHasMeta = history.some((m: any) => m._uiMetaOnly && m.runId === runId);
    if (alreadyHasMeta) continue;

    const parentSortTs = (row as any)._sortTs || Date.now();
    const metaMsg: Message = {
      id: `${META_MESSAGE_ID_PREFIX}${runId}`,
      runId,
      role: 'assistant',
      content: saved,
      timestamp: new Date(parentSortTs + 1).toLocaleTimeString(),
      _sortTs: parentSortTs + 1,
      _uiMetaOnly: true,
    };
    history.splice(idx + 1, 0, metaMsg as any);
  }
}

export function mergeSessionCacheIntoHistory(history: Message[], cache?: SessionStreamCache): boolean {
  if (!cache) return false;

  let shouldKeepTyping = false;
  let userMsgSortTs = cache.lastUserMsg?._sortTs || Date.now();
  if (cache.lastUserMsg) {
    const dbUserMsg = history.find((m: any) => m.id === cache.lastUserMsg?.id || (m.role === 'user' && m.content === cache.lastUserMsg?.content));
    if (!dbUserMsg) {
      history.push(cache.lastUserMsg);
    } else {
      userMsgSortTs = (dbUserMsg as any)._sortTs || userMsgSortTs;
    }
  }

  if (cache.isTyping && cache.fullText) {
    const existingIndex = cache.runId ? history.findIndex((m: any) => m.runId === cache.runId) : -1;
    if (existingIndex !== -1) {
      (history[existingIndex] as any).content = cache.fullText;
    } else {
      const lastAsst = [...history].reverse().find((m: any) => m.role === 'assistant');
      const cacheText = (cache.fullText || '').trim();
      const lastText = ((lastAsst as any)?.content || '').trim();
      // 历史里已有较长助手回复且与缓存流内容高度重合时，不再追加一条 recovered，避免「上面已回复、下面又多一条」
      if (
        lastAsst &&
        lastText.length >= 40 &&
        cacheText.length > 0 &&
        (lastText === cacheText || lastText.includes(cacheText.slice(0, Math.min(120, cacheText.length))))
      ) {
        /* skip duplicate recovered row */
      } else {
        history.push({
          id: `msg-ai-recovered-${Date.now()}`,
          role: 'assistant' as const,
          content: cache.fullText,
          timestamp: new Date().toLocaleTimeString(),
          _sortTs: userMsgSortTs + 1,
        } as Message);
      }
    }
    shouldKeepTyping = true;
  }

  return shouldKeepTyping;
}

export function sortMessagesByTimeline(history: Message[]): Message[] {
  const roleOrder: Record<string, number> = { system: 0, user: 1, assistant: 2 };
  return [...history].sort((a: any, b: any) => {
    const diff = (a._sortTs || 0) - (b._sortTs || 0);
    if (diff !== 0) return diff;
    return (roleOrder[a.role] || 0) - (roleOrder[b.role] || 0);
  });
}
