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
    const currentLabel = activeKey === sessionKey ? sessionLabel : existing?.label;
    if (!force && !isUntitledSessionLabel(currentLabel)) {
      return;
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

