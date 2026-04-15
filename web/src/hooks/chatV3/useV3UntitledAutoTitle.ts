import { useEffect, useMemo, useRef } from 'react';
import type { Message } from '../useChatV3WebSocket';

export interface UseV3UntitledAutoTitleParams {
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';
  sessions: any[];
  sendRPC: (method: string, params: any) => Promise<any>;
  handleAutoSummarize: (messages: Message[], silent: boolean, targetKey: string, force: boolean) => Promise<void> | void;

  /**
   * 每次列表变化后的去抖时间（ms），默认 600ms。
   */
  debounceMs?: number;
  /**
   * 并发上限（同时处理的会话数），默认 1（最保守，避免网关压力）。
   */
  concurrency?: number;
  /**
   * 每个会话拉取历史的条数，默认 10。
   */
  historyLimit?: number;
}

function isUntitledLabel(label: any) {
  const s = (label ?? '').toString().trim();
  return !s || s === '未命名会话' || s === 'New Session';
}

/**
 * v3 未命名会话自动补全标题后台任务：\n
 * - 去抖：列表频繁刷新时只触发一次扫描\n
 * - 并发控制：限制同时请求 chat.history 的数量\n
 * - 取消机制：会话列表变化/卸载时中断旧任务\n
 */
export function useV3UntitledAutoTitle({
  status,
  sessions,
  sendRPC,
  handleAutoSummarize,
  debounceMs = 600,
  concurrency = 1,
  historyLimit = 10
}: UseV3UntitledAutoTitleParams) {
  const runTokenRef = useRef(0);
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (status !== 'authenticated') return;

    const untitled = sessions
      .filter((s: any) => s?.key && s.key !== 'agent:main:main' && isUntitledLabel(s.label))
      .slice(0, 15); // 保护：一次最多处理 15 个

    if (untitled.length === 0) return;

    const token = ++runTokenRef.current;
    const timer = setTimeout(async () => {
      let idx = 0;

      const worker = async () => {
        while (idx < untitled.length) {
          const current = untitled[idx++];
          const key = current.key;
          if (!key) continue;
          if (token !== runTokenRef.current) return;
          if (inFlightRef.current.has(key)) continue;
          inFlightRef.current.add(key);
          try {
            const hRes = await sendRPC('chat.history', { sessionKey: key, limit: historyLimit });
            if (token !== runTokenRef.current) return;
            if (!hRes.ok) continue;

            const raw = hRes.payload?.messages || hRes.payload?.items || [];
            if (!Array.isArray(raw) || raw.length === 0) continue;

            const msgs: Message[] = raw.map((m: any) => {
              const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '');
              return {
                id: m.id || `hist-${key}-${Math.random().toString(36).slice(2)}`,
                role: (m.role === 'toolResult' ? 'assistant' : m.role) as any,
                content: (content || '').toString(),
                timestamp: ''
              };
            }).filter(m => (m.content || '').trim().length > 0);

            if (msgs.length > 0) {
              await handleAutoSummarize(msgs, true, key, false);
            }
          } finally {
            inFlightRef.current.delete(key);
          }
        }
      };

      const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
      await Promise.all(workers);
    }, debounceMs);

    return () => {
      clearTimeout(timer);
      // 取消：只需推进 token 即可让 worker 自行停止
      runTokenRef.current++;
    };
  }, [concurrency, debounceMs, handleAutoSummarize, historyLimit, sendRPC, sessions, status]);

  return useMemo(() => ({}), []);
}

