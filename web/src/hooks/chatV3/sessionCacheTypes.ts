import type { Message } from '../useChatV3WebSocket';

export const MAX_SESSION_CACHE_ENTRIES = 30;
export const MAX_METADATA_ENTRIES_PER_SESSION = 20;
export const MAX_METADATA_BYTES_PER_ENTRY = 64 * 1024; // 单条 64KB 上限，防止极长 thinking 占爆内存

export type SessionStreamCache = {
  fullText: string;
  runId?: string;
  isTyping: boolean;
  startTime: number;
  firstTokenTime: number;
  ttftRecorded: boolean;
  tokenCount: number;
  tpsData: number[];
  lastUserMsg?: Message;
  lastTouched: number;
  /**
   * 按 runId 记录流式阶段累积的「元数据块」(thinking/plan/commandOutput/toolCall/工具状态行等)。
   * 这些元数据只来自 WS 的 agent / session.tool 事件，网关 transcript 通常不持久化它们。
   * 存下来以便切回该会话重新加载历史时能把折叠卡片贴回对应的 assistant 消息。
   */
  metadataByRunId: Map<string, string>;
  /**
   * 当前会话活跃中的 RunId 集合。用于并行任务场景下，只有当所有 Run 都结束时才真正关闭 typing 锁。
   */
  activeRuns: Set<string>;
};
