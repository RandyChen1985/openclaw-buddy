import type { FileInfo, Message } from '../useChatV3WebSocket';
import type { SessionStreamCache } from './sessionCacheTypes';

export function buildSendMessageContent(text: string, attachedFiles?: FileInfo[]): string {
  let finalContent = text;
  if (!attachedFiles || attachedFiles.length === 0) return finalContent;

  const mentions = attachedFiles.filter(f => (f as any).type).map(f => {
    if ((f as any).type === 'workspace_file') return `\n[File: ${f.path}]`;
    if ((f as any).type === 'skill') return `\n[Skill: ${(f as any).entityId}]`;
    return '';
  }).join('');

  const fileLinks = attachedFiles.filter(f => !(f as any).type).map(f => {
    const isImage = f.ext.replace(/^\./, '').match(/^(jpg|jpeg|png|gif|webp|svg)$/i);
    return isImage
      ? `\n![${f.filename}](${f.thumbUrl || f.url})\n(File path: ${f.path})`
      : `\n[${f.filename}](${f.url}) (File path: ${f.path})`;
  }).join('');

  finalContent += mentions + fileLinks + `\n\n**System Note for Expert:** The user has provided context via files or skills. Please analyze the content and respond in Chinese.`;
  return finalContent;
}

export function createUserMessage(content: string, now: number): Message {
  return {
    id: `msg-${now}`,
    role: 'user',
    content,
    timestamp: new Date(now).toLocaleTimeString(),
    _sortTs: now,
  };
}

export function createAssistantPlaceholder(content: string, now: number, sortTs = now + 1): Message {
  return {
    id: `msg-ai-${now}`,
    role: 'assistant',
    content,
    timestamp: new Date(now).toLocaleTimeString(),
    _sortTs: sortTs,
    _thinkStartedAt: now,
  };
}

export function createTypingSessionCache(
  lastUserMsg: Message,
  previous?: SessionStreamCache,
): SessionStreamCache {
  return {
    fullText: '',
    isTyping: true,
    startTime: Date.now(),
    firstTokenTime: 0,
    ttftRecorded: false,
    tokenCount: 0,
    tpsData: [],
    lastUserMsg,
    lastTouched: Date.now(),
    metadataByRunId: previous?.metadataByRunId || new Map(),
    activeRuns: previous?.activeRuns || new Set<string>(),
  };
}

export function createInjectedAssistantMessage(id: string | undefined, content: string, rawTs: number): Message {
  return {
    id: id || `msg-inject-${rawTs}`,
    role: 'assistant',
    content,
    timestamp: new Date(rawTs).toLocaleTimeString(),
    _sortTs: rawTs,
  };
}
