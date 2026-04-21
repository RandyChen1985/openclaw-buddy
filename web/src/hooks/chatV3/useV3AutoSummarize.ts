import { useCallback, useMemo, useRef, useState } from 'react';
import { message as antdMessage } from 'antd';
import { summarizeSession } from '../../api';
import type { Message } from '../useChatV3WebSocket';
import { isUntitledSessionLabel } from './labelUtils';

export interface UseV3AutoSummarizeParams {
  t: any;
  sessionKey: string | null;
  sessionLabel: string | null;
  selectedBot: string;
  botsModels: any;
  sessions: any[];
  sendRPC: (method: string, params: any) => Promise<any>;
  onLocalLabelPatched?: (key: string, newLabel: string) => void;
}

/**
 * v3 标题汇总层：负责手动/自动生成会话标题，并做并发保护与“自动不覆盖、手动可覆盖”的语义。
 */
export function useV3AutoSummarize({
  t,
  sessionKey,
  sessionLabel,
  selectedBot,
  botsModels,
  sessions,
  sendRPC,
  onLocalLabelPatched
}: UseV3AutoSummarizeParams) {
  const [isSummarizing, setIsSummarizing] = useState(false);
  const summarizingSessionsRef = useRef<Set<string>>(new Set());
  const lastSummarizedAtRef = useRef<Map<string, number>>(new Map());

  const handleAutoSummarize = useCallback(async (
    messagesOverride?: Message[],
    silent = false,
    targetKey?: string,
    force = false
  ) => {
    const activeKey = targetKey || sessionKey;
    const targetMessages = messagesOverride || [];

    if (!activeKey || targetMessages.length === 0) return;
    if (activeKey === 'agent:main:main') return;

    const existing = sessions.find(s => s.key === activeKey);
    /**
     * 当前会话优先用 state 里的 sessionLabel；若仍为「未命名」但列表里已有标题
     * （例如仅恢复了 sessionKey、列表后到），应用列表值，避免误触发生成覆盖。
     */
    let currentLabel: string | null | undefined;
    if (activeKey === sessionKey) {
      const fromState = sessionLabel;
      const fromList = existing?.label;
      currentLabel = !isUntitledSessionLabel(fromState)
        ? fromState
        : !isUntitledSessionLabel(fromList)
          ? fromList
          : (fromState ?? fromList);
    } else {
      currentLabel = existing?.label;
    }
    if (!force && !isUntitledSessionLabel(currentLabel)) {
      return;
    }

    // 自动补全：对同一会话做短期去重，避免在 sessions 列表频繁刷新时重复 patch
    if (!force) {
      const last = lastSummarizedAtRef.current.get(activeKey) || 0;
      if (Date.now() - last < 2 * 60 * 1000) {
        return;
      }
    }

    if (summarizingSessionsRef.current.has(activeKey)) return;
    summarizingSessionsRef.current.add(activeKey);
    if (!targetKey) setIsSummarizing(true);

    if (!silent) {
      antdMessage.loading({
        content: t('chat.summarizingTitle', { defaultValue: '正在生成标题...' }),
        key: `summarizing-${activeKey}`
      });
    }

    try {
      const agentId = selectedBot.replace('openclaw:', '');
      const bot = botsModels?.data?.bots?.find((b: any) => b.id === agentId);
      const currentModelID = bot?.model || '';

      const validMessages = targetMessages.map(m => {
        let clean = m.content;
        clean = clean.replace(/> :::thinking[\s\S]*?:::\n*/g, '')
          .replace(/> :::toolCall[\s\S]*?:::\n*/g, '')
          .replace(/> :::toolResult[\s\S]*?:::\n*/g, '');
        return { role: m.role, content: clean.trim() };
      }).filter(m => m.content.length > 0);

      const newTitle = await summarizeSession(validMessages, currentModelID);
      if (newTitle) {
        const res = await sendRPC('sessions.patch', { key: activeKey, label: newTitle });
        if (res.ok) {
          lastSummarizedAtRef.current.set(activeKey, Date.now());
          onLocalLabelPatched?.(activeKey, newTitle);
          if (!silent) {
            antdMessage.success({ content: t('chat.titleSummarized'), key: `summarizing-${activeKey}` });
          }
        }
      }
    } catch (err) {
      if (!silent) {
        // eslint-disable-next-line no-console
        console.error('Summarize error:', err);
      }
    } finally {
      summarizingSessionsRef.current.delete(activeKey);
      if (!targetKey) setIsSummarizing(false);
    }
  }, [botsModels, onLocalLabelPatched, selectedBot, sendRPC, sessionKey, sessionLabel, sessions, t]);

  return useMemo(() => {
    return {
      isSummarizing,
      handleAutoSummarize
    };
  }, [handleAutoSummarize, isSummarizing]);
}

