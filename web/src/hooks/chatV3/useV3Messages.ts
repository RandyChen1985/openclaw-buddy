import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { message as antdMessage } from 'antd';
import type { FileInfo, Message } from '../useChatV3WebSocket';

const MAX_SESSION_CACHE_ENTRIES = 30;

type SessionStreamCache = {
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
};

const MAX_METADATA_ENTRIES_PER_SESSION = 20;
const MAX_METADATA_BYTES_PER_ENTRY = 64 * 1024; // 单条 64KB 上限，防止极长 thinking 占爆内存

/**
 * 网关 transcript 可能把「工具/审批」与「:::thinking」拆成两条相邻 assistant。
 * 后一条若仅有思考块，合并进上一条开头，避免 UI 上思考跑到工具下面。
 */
function isAssistantThinkingOnlyContent(content: string): boolean {
  const t = (content || '').trim();
  if (!t) return false;
  // 支持多种元数据块：思考、计划、命令输出、工具调用标记
  const hasMetadata = t.includes(':::thinking') || t.includes(':::plan') || t.includes(':::commandOutput') || t.includes(':::toolCall') || t.includes('🔧') || t.includes('✅') || t.includes('❌');
  if (!hasMetadata) return false;
  
  const rest = t
    .replace(/> :::thinking[\s\S]*?:::\s*/g, '')
    .replace(/> :::plan[\s\S]*?:::\s*/g, '')
    .replace(/> :::commandOutput[\s\S]*?:::\n*/g, '')
    .replace(/> :::toolCall[\s\S]*?:::\n*/g, '')
    .replace(/>\s*[🔧✅❌]\s*`[^`]+`\s*(?:执行中(?:…|\.{3})|完成|失败)(?:\s*<!--[\s\S]*?-->)?/g, '')
    .replace(/<!--\s*tool:[^>]*-->/g, '')
    .trim();
  return rest.length === 0;
}

function isAssistantMergableTarget(content: string): boolean {
  if (!content) return false;
  // 任何 assistant 消息都是合法的合并目标（包括正式回复）
  return true;
}

function canMergeAssistantRunId(a?: string, b?: string): boolean {
  if (a && b) return a === b;
  return true;
}

const AGENT_ITEM_MARKER_PREFIX = '<!--agentItem:';

/**
 * 把一行文本转成 blockquote 行：前置 `> `，多行原样保留并逐行前置。
 */
function toBlockquoteLines(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => `> ${line}`)
    .join('\n');
}

/**
 * 在 metadata 中按 `itemId` 查找对应的 fenced 块并整块替换；若不存在则追加到末尾。
 * 用于 agent 事件流（thinking/plan/commandOutput/toolCall），保证同一个 itemId 的多次 delta
 * 只对应一个折叠块，而不是每个 delta 开一张新卡片。
 */
function upsertAgentBlock(
  metadata: string,
  segmentName: string,
  itemId: string,
  title: string,
  body: string,
): string {
  const marker = itemId ? `${AGENT_ITEM_MARKER_PREFIX}${segmentName}:${itemId}-->` : '';
  const lines: string[] = [`> :::${segmentName}`];
  if (marker) lines.push(`> ${marker}`);
  if (title) lines.push(`> **${title}**`);
  if (body) lines.push(toBlockquoteLines(body));
  lines.push(`> :::`);
  const newBlock = lines.join('\n');

  if (marker && metadata.includes(marker)) {
    // 用按行扫描定位 marker 所属的 fenced 块并整块替换
    const arr = metadata.split('\n');
    const markerLineIdx = arr.findIndex(l => l.includes(marker));
    if (markerLineIdx !== -1) {
      let startIdx = -1;
      for (let i = markerLineIdx; i >= 0; i--) {
        if (/^\s*>\s*:::\w+/.test(arr[i])) { startIdx = i; break; }
      }
      let endIdx = -1;
      for (let i = markerLineIdx + 1; i < arr.length; i++) {
        if (/^\s*>\s*:::\s*$/.test(arr[i])) { endIdx = i; break; }
      }
      if (startIdx !== -1 && endIdx !== -1) {
        const before = arr.slice(0, startIdx).join('\n').replace(/\s+$/, '');
        const after = arr.slice(endIdx + 1).join('\n').replace(/^\s+/, '');
        const sepBefore = before ? '\n\n' : '';
        const sepAfter = after ? '\n\n' : '';
        return `${before}${sepBefore}${newBlock}${sepAfter}${after}`;
      }
    }
  }

  if (!metadata) return newBlock;
  const sep = metadata.endsWith('\n\n') ? '' : (metadata.endsWith('\n') ? '\n' : '\n\n');
  return metadata + sep + newBlock;
}

/**
 * 将 assistant 消息内容拆分为「元数据区」(metadata) 和「正文区」(transcript)。
 * 元数据区包括 :::thinking / :::plan / :::commandOutput / :::toolCall / :::toolResult / :::warning
 * 以及工具状态行（> 🔧/✅/❌/⚠️ …）、<!-- tool:xxx --> 标记、/approve 指令等。
 *
 * 实现采用按行状态机解析，避免正则 `[\s\S]*?(?::::|$)` 在流式未闭合块时
 * 把后续正文全部吞进 metadata 的越界问题。
 */
function partitionAssistantContent(content: string): { metadata: string, transcript: string } {
  if (!content) return { metadata: '', transcript: '' };

  const fencedOpenRe = /^\s*(?:>\s*)?:::(?:thinking|toolCall|plan|commandOutput|toolResult|warning)\b/;
  const fencedCloseRe = /^\s*(?:>\s*)?:::\s*$/;
  const toolStatusRe = /^\s*(?:>\s*)?[🔧✅❌⚠️]\s*`[^`]+`\s*(?:执行中(?:…|\.{3})|完成|失败|错误)(?:\s*<!--[\s\S]*?-->)?\s*$/;
  const toolMarkerRe = /^\s*<!--\s*tool:[^>]*-->\s*$/;
  const approveCmdRe = /^\s*(?:>\s*)?\/approve\s+[a-f0-9]{8,}\s+allow-once\s*$/i;
  const approveConfirmRe = /^\s*(?:>\s*)?Approval\s+\S+\s+submitted\s+for\s+[a-f0-9]{8,}/i;
  const blockquoteLineRe = /^\s*>/;

  const lines = content.split('\n');
  const metadataLines: string[] = [];
  const transcriptLines: string[] = [];

  let inFenced = false;
  // 标记紧跟在一个 metadata 块后面：用来吸收块与块之间的一个空行，
  // 避免重新拼接时多个 fenced 块塌成一个 blockquote（否则 markdown 会把连续 `>` 行合并成单块，
  // 导致 V3MessageItem 的 blockquote 渲染器只按第一个命中的 `:::xxx` 类型来渲染整坨，后面的块被吞掉）。
  let justClosedBlock = false;

  const closeBlock = () => {
    // 在每个 metadata 块之间插入一个空行，让 markdown 渲染时能把它们视为不同的 blockquote
    metadataLines.push('');
    justClosedBlock = false;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (inFenced) {
      if (fencedCloseRe.test(line)) {
        metadataLines.push(line);
        inFenced = false;
        justClosedBlock = true;
        continue;
      }
      // 块内预期应为 `> ...`（blockquote）或空行；若出现非 blockquote 非空行，
      // 认为前一个块实际已经没闭合（流式异常/未闭合），提前退出，避免把正文吞进元数据。
      if (line.trim() !== '' && !blockquoteLineRe.test(line)) {
        inFenced = false;
        transcriptLines.push(line);
        continue;
      }
      metadataLines.push(line);
      continue;
    }

    // 块外的空行：若刚关闭一个块，则吸收一个空行用作块间分隔；否则进入 transcript
    if (line.trim() === '') {
      if (justClosedBlock) {
        closeBlock();
        continue;
      }
      transcriptLines.push(line);
      continue;
    }

    if (fencedOpenRe.test(line)) {
      if (justClosedBlock) closeBlock();
      metadataLines.push(line);
      if (!fencedCloseRe.test(line)) inFenced = true;
      continue;
    }

    if (
      toolStatusRe.test(line) ||
      toolMarkerRe.test(line) ||
      approveCmdRe.test(line) ||
      approveConfirmRe.test(line)
    ) {
      if (justClosedBlock) closeBlock();
      metadataLines.push(line);
      continue;
    }

    justClosedBlock = false;
    transcriptLines.push(line);
  }

  const metadata = metadataLines.join('\n').replace(/\n{4,}/g, '\n\n\n').replace(/^\s+|\s+$/g, '');
  const transcript = transcriptLines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
  return { metadata, transcript };
}

function mergeTrailingThinkingIntoPreviousAssistant(prev: Message[], incoming: Message): Message[] | null {
  if (incoming.role !== 'assistant' || !isAssistantThinkingOnlyContent(incoming.content)) return null;
  const last = prev[prev.length - 1];
  if (!last || last.role !== 'assistant') return null;
  if (!isAssistantMergableTarget(last.content)) return null;
  if (!canMergeAssistantRunId(last.runId, incoming.runId)) return null;
  
  const head = (incoming.content || '').trim();
  const lastContentRaw = (last.content || '').trim();
  
  // 避免过度合并相同内容
  if (lastContentRaw.includes(head)) return null;
  
  // 始终将“思考/工具元数据”追加在“正式回复”之前（如果是同一个 Run ID）
  // 如果 last 已经是正式回复，则 head 放在最上面
  return [...prev.slice(0, -1), { ...last, content: `${head}\n\n${last.content}` }];
}

function compactAssistantThinkingAfterToolInPlace(rows: Message[]): void {
  for (let i = 1; i < rows.length; i++) {
    const cur = rows[i];
    const prev = rows[i - 1];
    if (!cur || !prev || cur.role !== 'assistant' || prev.role !== 'assistant') continue;
    if (!isAssistantThinkingOnlyContent(cur.content || '')) continue;
    if (!isAssistantMergableTarget(prev.content || '')) continue;
    if (!canMergeAssistantRunId(prev.runId, cur.runId)) continue;
    
    const head = (cur.content || '').trim();
    if ((prev.content || '').trim().includes(head)) {
      rows.splice(i, 1);
      i--;
      continue;
    }
    prev.content = `${head}\n\n${prev.content || ''}`;
    rows.splice(i, 1);
    i--;
  }
}

/** UI 占位「正在思考」被误写入 transcript 时，会紧跟在已有回复后多一条 assistant —— 直接丢弃 */
function isAssistantUiThinkingPlaceholder(content: string, thinkingLabel: string, deepLabel: string): boolean {
  const x = (content || '').trim();
  if (x === thinkingLabel.trim() || x === deepLabel.trim() || x === '思考中...') return true;
  // 英文/轻微变体：短句 + Lobster + thinking
  if (/^Lobster\s+/i.test(x) && x.length < 140 && /thinking|思考/i.test(x)) return true;
  return false;
}

function assistantMessageLooksSubstantial(content: string, thinkingLabel: string, deepLabel: string): boolean {
  const x = (content || '').trim();
  if (x.length < 32) return false;
  return !isAssistantUiThinkingPlaceholder(x, thinkingLabel, deepLabel);
}

function stripTrailingUiThinkingPlaceholderAfterAssistantReply(rows: Message[], thinkingLabel: string, deepLabel: string): void {
  for (let i = rows.length - 1; i >= 1; i--) {
    const cur = rows[i];
    const prev = rows[i - 1];
    if (!cur || !prev || cur.role !== 'assistant' || prev.role !== 'assistant') continue;
    if (!isAssistantUiThinkingPlaceholder(cur.content || '', thinkingLabel, deepLabel)) continue;
    if (!assistantMessageLooksSubstantial(prev.content || '', thinkingLabel, deepLabel)) continue;
    rows.splice(i, 1);
    i--;
  }
}

export interface UseV3MessagesParams {
  t: any;
  status: 'disconnected' | 'connecting' | 'challenging' | 'authorizing' | 'authenticated' | 'error';
  sessionKey: string | null;
  setSessionKey: (key: string | null) => void;
  selectedBot: string;
  thinkingLevel: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  sessionModel: string;
  sendRPC: (method: string, params: any) => Promise<any>;
  fetchSessions: (isSilent?: boolean) => Promise<void> | void;
  inputAreaRef: React.RefObject<any>;
  virtuosoRef: React.RefObject<any>;
  scrollRef: React.RefObject<HTMLDivElement>;
  showScrollBtnRef: React.MutableRefObject<boolean>;
  showThinkingRef: React.MutableRefObject<boolean>;
}

/**
 * v3 消息层：负责消息列表状态、流式 delta/final/error 合并、历史加载、以及发送/停止/重试/编辑重发等动作。
 */
export function useV3Messages({
  t,
  status,
  sessionKey,
  setSessionKey,
  selectedBot,
  thinkingLevel,
  sessionModel,
  sendRPC,
  fetchSessions,
  inputAreaRef,
  virtuosoRef,
  scrollRef,
  showScrollBtnRef,
  showThinkingRef
}: UseV3MessagesParams) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isStalled, setIsStalled] = useState(false);
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [tpsData, setTpsData] = useState<number[]>([]);
  const [hasNewMessages, setHasNewMessages] = useState(false);
  const [typingSessionKeys, setTypingSessionKeys] = useState<string[]>([]);

  const typingSessionsRef = useRef<Set<string>>(new Set());

  /**
   * 标记某个 session 是否处于“正在生成/流式推送中”。
   * 用于会话列表显示“正在编辑”的动画提示。
   */
  const markSessionTyping = useCallback((key: string, typing: boolean) => {
    if (!key) return;
    const set = typingSessionsRef.current;
    const had = set.has(key);
    if (typing) {
      if (had) return;
      set.add(key);
    } else {
      if (!had) return;
      set.delete(key);
    }
    setTypingSessionKeys(Array.from(set));
  }, []);

  const sessionKeyRef = useRef<string | null>(null);
  useEffect(() => { sessionKeyRef.current = sessionKey; }, [sessionKey]);

  const messagesRef = useRef<Message[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);

  const messagesCountRef = useRef(messages.length);
  useEffect(() => { messagesCountRef.current = messages.length; }, [messages.length]);

  const stallTimerRef = useRef<any>(null);
  const lastUpdateRef = useRef(0);
  // 最近一次“流式相关事件”(chat.delta/thought/final/error/aborted/agent lifecycle)的时间戳
  // 用于：当 typing 状态异常卡住时，允许 session.message 兜底把内容推到 UI
  const lastStreamEventAtRef = useRef(0);
  const streamingAssistantIndexRef = useRef<number | null>(null);
  const historyRequestSeqRef = useRef(0);
  const latestHistoryRequestRef = useRef(0);
  const chatEventSeenSinceSendRef = useRef(false);
  const hadTypingSinceSendRef = useRef(false);

  const sessionCacheRef = useRef<Map<string, SessionStreamCache>>(new Map());
  // 流结束后的冷却窗口：防止 session.message 事件在流刚结束时追加重复消息
  const streamEndGraceRef = useRef<{ key: string; until: number } | null>(null);
  // 已请求停止：从点击"停止"到收到 aborted/final 之间，屏蔽后续 delta 写入
  const abortRequestedRef = useRef<{ key: string; ts: number } | null>(null);

  const injectDiagnosticIfNoChatEvent = useCallback((reason: string) => {
    if (!hadTypingSinceSendRef.current) return;
    if (chatEventSeenSinceSendRef.current) return;

    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (!last || last.role !== 'assistant') return prev;

      const diag = `> **⚠️ 未收到流式事件**\n> 可能原因：网关未推送 chat.event、会话任务卡死、或请求未真正进入生成。\n> 建议：点击重试 / 新建会话 / 重新连接网关。\n> (${reason})`;

      const content = (last.content === '思考中...' || last.content === t('chat.thinking') || !last.content)
        ? diag
        : `${last.content}\n\n${diag}`;

      return [...prev.slice(0, -1), { ...last, content }];
    });
  }, [t]);

  const touchAndPruneSessionCache = useCallback((key: string, cache: SessionStreamCache) => {
    cache.lastTouched = Date.now();
    sessionCacheRef.current.set(key, cache);
    if (sessionCacheRef.current.size <= MAX_SESSION_CACHE_ENTRIES) return;

    const victims = [...sessionCacheRef.current.entries()]
      .sort((a, b) => a[1].lastTouched - b[1].lastTouched)
      .slice(0, sessionCacheRef.current.size - MAX_SESSION_CACHE_ENTRIES);

    victims.forEach(([victimKey]) => {
      sessionCacheRef.current.delete(victimKey);
    });
  }, []);

  const getOrCreateSessionCache = useCallback((key: string): SessionStreamCache => {
    const existing = sessionCacheRef.current.get(key);
    if (existing) {
      touchAndPruneSessionCache(key, existing);
      return existing;
    }
    const created: SessionStreamCache = {
      fullText: '',
      isTyping: true,
      startTime: Date.now(),
      firstTokenTime: 0,
      ttftRecorded: false,
      tokenCount: 0,
      tpsData: [],
      lastTouched: Date.now(),
      metadataByRunId: new Map<string, string>()
    };
    touchAndPruneSessionCache(key, created);
    return created;
  }, [touchAndPruneSessionCache]);

  /**
   * 按 runId 记录某条 assistant 消息的「metadata 折叠块」，供会话切换/历史加载时恢复使用。
   * 包含简单的条数 + 单条字节上限，避免 thinking 超长占爆内存。
   */
  const rememberMetadataForRun = useCallback((sessionKeyStr: string, runId: string | undefined, metadata: string) => {
    if (!sessionKeyStr || !runId || !metadata) return;
    const cache = sessionCacheRef.current.get(sessionKeyStr);
    if (!cache) return;
    if (!cache.metadataByRunId) cache.metadataByRunId = new Map();
    const clipped = metadata.length > MAX_METADATA_BYTES_PER_ENTRY
      ? metadata.slice(0, MAX_METADATA_BYTES_PER_ENTRY) + '\n\n> _[metadata 已截断]_\n'
      : metadata;
    cache.metadataByRunId.set(runId, clipped);
    if (cache.metadataByRunId.size > MAX_METADATA_ENTRIES_PER_SESSION) {
      // LRU：删除最早插入的若干条
      const keys = Array.from(cache.metadataByRunId.keys());
      const victims = keys.slice(0, cache.metadataByRunId.size - MAX_METADATA_ENTRIES_PER_SESSION);
      victims.forEach(k => cache.metadataByRunId.delete(k));
    }
    touchAndPruneSessionCache(sessionKeyStr, cache);
  }, [touchAndPruneSessionCache]);

  /**
   * 清除 stall 计时器，并同步 `isStalled` 标记。
   */
  const clearStallTimer = useCallback(() => {
    if (stallTimerRef.current) {
      clearTimeout(stallTimerRef.current);
      stallTimerRef.current = null;
    }
    setIsStalled(false);
  }, []);

  /**
   * 重置 stall 计时器：若在指定时间内未收到流式更新，则将 UI 标记为 stalled。
   */
  const resetStallTimer = useCallback(() => {
    clearStallTimer();
    stallTimerRef.current = setTimeout(() => {
      setIsStalled(true);
    }, 3500);
  }, [clearStallTimer]);

  /**
   * 将多种 content 结构统一格式化为 Markdown 文本，供渲染层消费。
   */
  const formatMessageContent = useCallback((msg: any, _depth = 0): string => {
    if (!msg) return '';
    if (_depth > 5) return typeof msg === 'string' ? msg : JSON.stringify(msg);

    const content = (msg.content !== undefined && msg.content !== null) ? msg.content : msg;
    const topThought = msg.thought || msg.thinking || msg.reasoning || '';

    let prefix = '';
    if (topThought) {
      prefix = `> :::thinking\n> ${String(topThought).replace(/\n/g, '\n> ')}\n> :::\n\n`;
    }

    let body = '';
    if (typeof content === 'string') {
      const trimmed = content.trim();
      if (trimmed === '[]' || trimmed === '{}') body = '';
      else if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          body = formatMessageContent(parsed, _depth + 1);
        } catch {
          body = content;
        }
      } else {
        body = content;
      }
    } else if (Array.isArray(content)) {
      body = content.map((c: any) => {
        let matched = false;

        let thinkingPart = '';
        if (c.thinking || c.thought || c.reasoning || c.type === 'thinking') {
          const thought = c.thinking || c.thought || c.reasoning || c.content || '';
          thinkingPart = `> :::thinking\n> ${String(thought).replace(/\n/g, '\n> ')}\n> :::\n\n`;
          matched = true;
        }

        let planPart = '';
        if (c.type === 'plan' || c.plan) {
          const plan = c.plan || c.content || '';
          planPart = `> :::plan\n> ${String(plan).replace(/\n/g, '\n> ')}\n> :::\n\n`;
          matched = true;
        }

        let commandOutputPart = '';
        if (c.type === 'command_output' || c.command_output || c.commandOutput) {
          const output = c.command_output || c.commandOutput || c.content || '';
          commandOutputPart = `> :::commandOutput\n> ${String(output).replace(/\n/g, '\n> ')}\n> :::\n\n`;
          matched = true;
        }

        let toolCallPart = '';
        if (c.type === 'toolCall' || c.toolCall || c.tool_call) {
          const tc = c.toolCall || c.tool_call || c;
          const name = tc.name || tc.function?.name || 'unknown_tool';
          const args = typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {});
          toolCallPart = `> :::toolCall\n> **${name}**\n> \`\`\`json\n> ${args}\n> \`\`\`\n> :::\n\n`;
          matched = true;
        }

        let toolResultPart = '';
        if (c.type === 'toolResult' || c.toolResult || c.tool_result) {
          const tr = c.toolResult || c.tool_result || c;
          const toolName = tr.toolName || tr.tool_name || tr.name || '';
          const result = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content || tr.result || {});
          toolResultPart = `> :::toolResult\n> ${toolName ? `**${toolName}**\n> ` : ''}\`\`\`json\n> ${result}\n> \`\`\`\n> :::\n\n`;
          matched = true;
        }

        const textPart = c.text || (typeof c.content === 'string' ? c.content : '');
        if (textPart) matched = true;

        let fallbackPart = '';
        if (!matched && typeof c === 'object' && c !== null && Object.keys(c).length > 0) {
          fallbackPart = `\n> :::warning 未知消息块 (${c.type || 'unknown'})\n> \`\`\`json\n> ${JSON.stringify(c, null, 2).split('\n').join('\n> ')}\n> \`\`\`\n> :::\n\n`;
        }

        return thinkingPart + planPart + commandOutputPart + toolCallPart + toolResultPart + fallbackPart + textPart;
      }).join('');
    } else if (typeof content === 'object' && content !== null) {
      body = formatMessageContent([content], _depth + 1);
    } else {
      body = String(content);
    }

    return prefix + body;
  }, []);

  /**
   * 降噪：Agent 在触发审批卡片（exec.approval.requested）时，往往还会在文本流里重复输出
   * “需要批准…请运行 /approve <slug> allow-once” 的提示语。UI 已有审批卡片时，这段文字应隐藏。
   */
  const extractApprovalSlugFromHint = useCallback((text: string): string => {
    if (!text) return '';
    const m = /\/approve\s+([a-f0-9]{8,})\s+allow-once/i.exec(text);
    return m ? m[1] : '';
  }, []);

  const isApprovalHintText = useCallback((text: string): boolean => {
    if (!text) return false;
    const t = text.toLowerCase();
    return (
      (text.includes('需要批准') || text.includes('审批') || t.includes('approve')) &&
      t.includes('/approve') &&
      t.includes('allow-once')
    );
  }, []);

  const hasApprovalCardForSlug = useCallback((slug: string): boolean => {
    if (!slug) return false;
    const current = messagesRef.current || [];
    return current.some(m => m.role === 'assistant' && typeof m.content === 'string' && m.content.includes(':::approval') && m.content.includes(slug));
  }, []);

  /**
   * 处理 chat 流式事件：delta/final/error 合并到 messages，并维护性能优化索引。
   */
  const handleChatDelta = useCallback((payload: any) => {
    const pSessionKey = payload.sessionKey || sessionKeyRef.current;
    if (!pSessionKey) return;
    const cache = getOrCreateSessionCache(pSessionKey);
    chatEventSeenSinceSendRef.current = true;
    lastStreamEventAtRef.current = Date.now();

    if (payload.state === 'thought' || payload.state === 'thinking') {
      const abortReq = abortRequestedRef.current;
      if (abortReq && abortReq.key === pSessionKey) return;
      markSessionTyping(pSessionKey, true);
      if (pSessionKey === sessionKeyRef.current) {
        resetStallTimer();
        setIsTyping(true);
        const thinkLabel = t('chat.deepThinking', { defaultValue: '深度思考中...' });
        setMessages(prev => {
          const idx = streamingAssistantIndexRef.current;
          const targetIdx = (idx !== null && idx >= 0 && idx < prev.length) ? idx : prev.findLastIndex(m => m.role === 'assistant');
          if (targetIdx === -1) return prev;
          const msg = prev[targetIdx];
          if (msg.content && msg.content !== t('chat.thinking') && msg.content !== thinkLabel) return prev;
          const next = [...prev];
          next[targetIdx] = { ...msg, content: thinkLabel };
          return next;
        });
      }
      return;
    }

    if (payload.state === 'delta') {
      // 用户已请求停止，丢弃 abort 生效前仍在途的 delta
      const abortReq = abortRequestedRef.current;
      if (abortReq && abortReq.key === pSessionKey) return;

      markSessionTyping(pSessionKey, true);
      if (pSessionKey === sessionKeyRef.current) {
        resetStallTimer();
        if (showScrollBtnRef.current) setHasNewMessages(true);
      }

      const now = Date.now();
      lastStreamEventAtRef.current = now;
      if (!cache.ttftRecorded) {
        cache.ttftRecorded = true;
        cache.firstTokenTime = now;
      }

      const messageObj = payload.message;
      if (!messageObj) return;

      const fullText = formatMessageContent(messageObj);
      // 如果是审批提示语，且审批卡片已存在，则丢弃（避免重复提示污染消息流）
      if (isApprovalHintText(fullText)) {
        const slug = extractApprovalSlugFromHint(fullText);
        if (slug && hasApprovalCardForSlug(slug)) return;
      }
      if (fullText === cache.fullText) return;
      if (!fullText.trim() && cache.fullText.trim()) return;

      // 防回退保护：新文本不应大幅缩短（可能是乱序 delta），但允许适度收缩（如 thinking block 结束后）
      const oldLen = cache.fullText.length;
      if (oldLen > 100 && fullText.length < oldLen * 0.5) return;

      cache.fullText = fullText;
      cache.tokenCount = fullText.length;
      cache.isTyping = true;
      cache.runId = payload.runId;
      touchAndPruneSessionCache(pSessionKey, cache);

      if (pSessionKey === sessionKeyRef.current) {
        setIsTyping(true);
        if (now - lastUpdateRef.current > 64) {
          lastUpdateRef.current = now;
          const elapsedFromFirst = (now - cache.firstTokenTime) / 1000;
          const currentTPS = elapsedFromFirst > 0 ? (cache.tokenCount / elapsedFromFirst) : 0;
          const ttft = cache.firstTokenTime - cache.startTime;

          if (cache.tokenCount % 5 === 0) {
            setTpsData(prev => [...prev.slice(-19), currentTPS]);
          }

          setMessages(prev => {
            const idx = streamingAssistantIndexRef.current;
            if (idx === null || idx < 0 || idx >= prev.length) {
              const runIdIndex = prev.findLastIndex(m => m.runId === payload.runId);
              const fallbackIndex = runIdIndex !== -1 ? runIdIndex : prev.findLastIndex(m => m.role === 'assistant' && !m.runId);
              if (fallbackIndex === -1) return prev;
              const next = [...prev];
              const current = next[fallbackIndex];
              
              const { metadata } = partitionAssistantContent(current.content || '');
              const combinedContent = metadata ? `${metadata}\n\n${fullText}` : fullText;
              
              next[fallbackIndex] = {
                ...current,
                runId: payload.runId,
                content: combinedContent,
                metrics: { ...current.metrics, ttft, tps: currentTPS },
                _sortTs: current._sortTs
              };
              streamingAssistantIndexRef.current = fallbackIndex;
              return next;
            }

            const next = [...prev];
            const current = next[idx];
            
            const { metadata } = partitionAssistantContent(current.content || '');
            const combinedContent = metadata ? `${metadata}\n\n${fullText}` : fullText;
            
            next[idx] = {
              ...current,
              runId: payload.runId,
              content: combinedContent,
              metrics: { ...current.metrics, ttft, tps: currentTPS },
              _sortTs: current._sortTs
            };
            return next;
          });

          if (virtuosoRef.current) {
            const isNearBottom = scrollRef.current
              ? (scrollRef.current.scrollHeight - scrollRef.current.scrollTop - scrollRef.current.clientHeight < 40)
              : true;

            if (!showScrollBtnRef.current || isNearBottom) {
              virtuosoRef.current.scrollToIndex({
                index: messagesCountRef.current - 1,
                align: 'end',
                behavior: 'auto'
              });
            }
          }
        }
      }
    } else if (payload.state === 'final' || payload.state === 'finished' || payload.state === 'done') {
      lastStreamEventAtRef.current = Date.now();
      const wasUserAbort = abortRequestedRef.current?.key === pSessionKey;
      abortRequestedRef.current = null;
      cache.isTyping = false;
      touchAndPruneSessionCache(pSessionKey, cache);
      markSessionTyping(pSessionKey, false);
      streamEndGraceRef.current = { key: pSessionKey, until: Date.now() + 3000 };
      if (pSessionKey === sessionKeyRef.current) clearStallTimer();

      // 用户已主动停止且 UI 已标记"已手动停止"，不再用服务端 final 覆盖
      if (wasUserAbort) {
        if (pSessionKey === sessionKeyRef.current) {
          setIsTyping(false);
          streamingAssistantIndexRef.current = null;
          fetchSessions(true);
        } else {
          fetchSessions(true);
        }
      } else {
        const now = Date.now();
        const duration = (now - cache.startTime) / 1000;
        const ttft = cache.ttftRecorded ? (cache.firstTokenTime - cache.startTime) : 0;
        const generationDuration = duration - (ttft / 1000);
        const finalTPS = generationDuration > 0.05 ? (cache.tokenCount / generationDuration) : 0;

        // final 阶段网关可能返回完整 message 对象（含 thinking/tool 块），必须走统一格式化避免丢内容
        const incomingContent = payload.message ? formatMessageContent(payload.message) : cache.fullText;
        if (isApprovalHintText(incomingContent)) {
          const slug = extractApprovalSlugFromHint(incomingContent);
          if (slug && hasApprovalCardForSlug(slug)) {
            // final 若只是重复提示语，则不覆盖现有 assistant 内容
            setIsTyping(false);
            streamingAssistantIndexRef.current = null;
            fetchSessions(true);
            return;
          }
        }
        cache.fullText = incomingContent;

        if (pSessionKey === sessionKeyRef.current) {
          setMessages(prev => {
            const idx = streamingAssistantIndexRef.current;
            const runIdIndex = prev.findLastIndex(m => m.runId === payload.runId);
            const targetIndex = (idx !== null && idx >= 0 && idx < prev.length) ? idx : (runIdIndex !== -1 ? runIdIndex : prev.findLastIndex(m => m.role === 'assistant' && !m.runId));
            if (targetIndex === -1) return prev;

            const last = prev[targetIndex];
            if (!incomingContent && last.content && last.content !== t('chat.thinking')) return prev;

            // 关键修复：final 阶段不能用网关 payload 直接覆盖 content，
            // 否则会丢失流式阶段累积的 thinking/plan/commandOutput/tool 等元数据块。
            // 做法：保留既有 metadata（由 agent/session.tool 流累积），只替换 transcript 正文部分。
            const { metadata: existingMeta } = partitionAssistantContent(last.content || '');
            const { metadata: incomingMeta, transcript: incomingTranscript } = partitionAssistantContent(incomingContent || '');
            // 既有 metadata 通常比 incoming 更丰富（含实时 thinking/tool 细节）；若为空则回退到 incoming 的 metadata
            const finalMeta = existingMeta || incomingMeta;
            const transcriptBody = incomingTranscript || (incomingMeta ? '' : incomingContent);
            const combinedContent = finalMeta
              ? (transcriptBody ? `${finalMeta}\n\n${transcriptBody}` : finalMeta)
              : transcriptBody;

            // 记录 metadata 供切换会话/重新加载历史时恢复
            const runIdForCache = payload.runId || (last as any).runId;
            if (finalMeta && runIdForCache) {
              rememberMetadataForRun(pSessionKey, runIdForCache, finalMeta);
            }

            const next = [...prev];
            next[targetIndex] = {
              ...last,
              runId: payload.runId,
              content: combinedContent,
              metrics: { ...last.metrics, ttft, duration, tps: finalTPS },
              _sortTs: last._sortTs
            };
            return next;
          });

          setIsTyping(false);
          streamingAssistantIndexRef.current = null;
          fetchSessions(true);
          setTimeout(() => inputAreaRef.current?.focus(), 100);
        } else {
          fetchSessions(true);
        }
      }
    } else if (payload.state === 'aborted') {
      lastStreamEventAtRef.current = Date.now();
      // 判断是否由 handleStopGeneration 发起的 abort（已在 UI 侧处理过消息标记）
      const wasUserAbort = abortRequestedRef.current?.key === pSessionKey;
      abortRequestedRef.current = null;
      cache.isTyping = false;
      touchAndPruneSessionCache(pSessionKey, cache);
      markSessionTyping(pSessionKey, false);
      streamEndGraceRef.current = { key: pSessionKey, until: Date.now() + 3000 };
      if (pSessionKey === sessionKeyRef.current) {
        clearStallTimer();
        if (!wasUserAbort) {
          const partialContent = payload.message ? formatMessageContent(payload.message) : cache.fullText;
          setMessages(prev => {
            const idx = streamingAssistantIndexRef.current;
            const targetIndex = (idx !== null && idx >= 0 && idx < prev.length) ? idx : prev.findLastIndex(m => m.role === 'assistant');
            if (targetIndex === -1) return prev;
            const last = prev[targetIndex];
            const label = t('chat.manuallyStopped', { defaultValue: '已手动停止' });

            // 保留流式阶段累积的 thinking/plan/tool 等元数据，只替换 transcript 正文
            const { metadata: existingMeta } = partitionAssistantContent(last.content || '');
            const { metadata: incomingMeta, transcript: incomingTranscript } = partitionAssistantContent(partialContent || '');
            const finalMeta = existingMeta || incomingMeta;
            const bodyText = incomingTranscript || (incomingMeta ? '' : partialContent);
            const hasBody = bodyText && bodyText !== t('chat.thinking') && bodyText !== t('chat.deepThinking', { defaultValue: '深度思考中...' });
            const transcriptWithLabel = hasBody ? `${bodyText} (${label})` : label;
            const content = finalMeta ? `${finalMeta}\n\n${transcriptWithLabel}` : transcriptWithLabel;

            const runIdForCache = payload.runId || (last as any).runId;
            if (finalMeta && runIdForCache) {
              rememberMetadataForRun(pSessionKey, runIdForCache, finalMeta);
            }

            const next = [...prev];
            next[targetIndex] = { ...last, content };
            return next;
          });
        }
        setIsTyping(false);
        streamingAssistantIndexRef.current = null;
        fetchSessions(true);
        setTimeout(() => inputAreaRef.current?.focus(), 100);
      }
    } else if (payload.state === 'error' || payload.state === 'failed') {
      lastStreamEventAtRef.current = Date.now();
      const wasUserAbort = abortRequestedRef.current?.key === pSessionKey;
      abortRequestedRef.current = null;
      cache.isTyping = false;
      touchAndPruneSessionCache(pSessionKey, cache);
      markSessionTyping(pSessionKey, false);
      streamEndGraceRef.current = { key: pSessionKey, until: Date.now() + 3000 };
      if (pSessionKey === sessionKeyRef.current) {
        clearStallTimer();
        // 用户已主动停止，不追加错误信息（避免覆盖"已手动停止"）
        if (!wasUserAbort) {
          const errorMsg = payload.message?.content || payload.errorMessage || payload.error?.message || payload.error || t('chat.streamFailedDefault');
          const errorKind = payload.errorKind as string | undefined;

          const errorKindLabels: Record<string, string> = {
            'context_length': t('chat.errorContextLength', { defaultValue: '上下文长度超限，建议压缩会话或新建对话' }),
            'rate_limit': t('chat.errorRateLimit', { defaultValue: '请求频率过高，请稍后重试' }),
            'refusal': t('chat.errorRefusal', { defaultValue: '内容被模型拒绝生成' }),
            'timeout': t('chat.errorTimeout', { defaultValue: '推理超时，请重试或简化问题' }),
          };
          const kindHint = errorKind && errorKindLabels[errorKind] ? `\n> 💡 ${errorKindLabels[errorKind]}` : '';

          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant') return prev;

            const errMsgFormatted = typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg);
            const content = last.content === '思考中...' || last.content === t('chat.thinking') || !last.content
              ? `> **⚠️ 异常或错误**\n> ${errMsgFormatted}${kindHint}`
              : last.content + `\n\n> **⚠️ 生成被中断**\n> ${errMsgFormatted}${kindHint}`;

            return [...prev.slice(0, -1), { ...last, content }];
          });
        }
        setIsTyping(false);
        streamingAssistantIndexRef.current = null;
        setTimeout(() => inputAreaRef.current?.focus(), 100);
      }
    }
  }, [clearStallTimer, fetchSessions, formatMessageContent, getOrCreateSessionCache, inputAreaRef, markSessionTyping, rememberMetadataForRun, resetStallTimer, scrollRef, showScrollBtnRef, t, touchAndPruneSessionCache, virtuosoRef]);

  /**
   * 处理审批请求事件：将审批卡片以 Markdown block 注入到消息流中，确保 UI 一定可见。
   *
   * 规则：
   * - 若最后一条是 assistant，则追加 block 到该消息（去重：slug 已存在则忽略）
   * - 否则追加一条新的 assistant 消息承载审批卡片
   */
  const handleApprovalRequested = useCallback((payload: any) => {
    if (!payload) return;
    const evtKey = payload.sessionKey;
    if (evtKey && evtKey !== sessionKeyRef.current) return;
    const { id, request } = payload;
    const approvalId = (id || '').toString();
    const slug = approvalId ? approvalId.substring(0, 8) : '';
    const command = request?.command || '';
    if (!approvalId || !slug || !command) return;

    // 重要：按钮点击时需要用“完整 approvalId”做 exec.approval.resolve，
    // 不能只用截断 slug（否则可能 resolve 成功回执但 agent 未真正放行）。
    const approvalBlock = `\n\n> :::approval\n> **${slug}**\n> approvalId: ${approvalId}\n> \`\`\`bash\n> ${command}\n> \`\`\`\n> :::\n`;

    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === 'assistant') {
        if (last.content.includes(slug)) return prev;
        const newContent = (last.content === t('chat.thinking') || !last.content)
          ? approvalBlock
          : `${last.content}${approvalBlock}`;
        return [...prev.slice(0, -1), { ...last, content: newContent }];
      }
      const now = Date.now();
      const newMsg: Message = {
        id: `msg-approval-${now}`,
        role: 'assistant',
        content: approvalBlock,
        timestamp: new Date(now).toLocaleTimeString(),
        _sortTs: now
      };
      return [...prev, newMsg];
    });

    // 审批出现时应解除 typing，并清理 stall 标记，避免 UI 卡在“生成中”
    setIsTyping(false);
    streamingAssistantIndexRef.current = null;
    clearStallTimer();
  }, [clearStallTimer, t]);

  /**
   * 处理审批结果事件：更新消息中对应审批卡片的状态（approved/denied）。
   */
  const handleApprovalResolved = useCallback((payload: any) => {
    if (!payload) return;
    const { id, decision } = payload;
    const slug = (id || '').toString().substring(0, 8);
    if (!slug) return;

    const decisionLabels: Record<string, string> = {
      'approved': '✅ 已批准',
      'allow-once': '✅ 已批准(单次)',
      'denied': '❌ 已拒绝',
      'rejected': '❌ 已拒绝',
      'timeout': '⏱️ 已超时',
    };
    const label = decisionLabels[decision] || (decision === 'approved' ? '✅ 已批准' : `⚠️ ${decision || '未知'}`);

    setMessages(prev => {
      const idx = prev.findIndex(m => m.role === 'assistant' && m.content.includes(slug));
      if (idx === -1) return prev;
      const msg = prev[idx];
      if (msg.content.includes(label)) return prev;
      const next = [...prev];
      next[idx] = {
        ...msg,
        content: msg.content.replace(
          new RegExp(`(> :::approval\\n> \\*\\*${slug}\\*\\*)`),
          `$1 — ${label}`
        )
      };
      return next;
    });
  }, []);

  /**
   * 处理 session.message 事件：网关 transcript 更新推送。
   * 仅在当前会话且非流式生成期间追加新消息（避免与 chat delta 流冲突）。
   */
  const handleSessionMessage = useCallback((payload: any) => {
    if (!payload) return;
    const { sessionKey: evtKey, message: msg } = payload;
    if (!evtKey || evtKey !== sessionKeyRef.current) return;
    if (!msg || !msg.role) return;
    if (typingSessionsRef.current.has(evtKey)) {
      // 兜底：若 typing 卡住且一段时间没有任何流式事件，则允许 session.message 落 UI
      const lastStreamAt = lastStreamEventAtRef.current;
      const staleMs = 4500;
      if (!lastStreamAt || Date.now() - lastStreamAt < staleMs) return;

      // typing 可能因事件丢失而卡住：此处主动解除，避免用户只能靠刷新看见内容
      typingSessionsRef.current.delete(evtKey);
      setTypingSessionKeys(Array.from(typingSessionsRef.current));
      if (evtKey === sessionKeyRef.current) {
        setIsTyping(false);
        clearStallTimer();
        streamingAssistantIndexRef.current = null;
      }
    }

    // 流刚结束的冷却窗口内忽略 session.message，避免 transcript 推送追加重复消息
    const grace = streamEndGraceRef.current;
    if (grace && grace.key === evtKey && Date.now() < grace.until) return;

    let content = formatMessageContent(msg.content);
    if (!content || !content.trim()) return;

    const thinkingLabel = t('chat.thinking');
    const deepThinkingLabel = t('chat.deepThinking', { defaultValue: '深度思考中...' });
    // 网关偶发把「正在思考」占位文案当作一条 assistant transcript 追加在正式回复之后
    if (msg.role === 'assistant' && isAssistantUiThinkingPlaceholder(content, thinkingLabel, deepThinkingLabel)) {
      const tail = messagesRef.current[messagesRef.current.length - 1];
      if (tail?.role === 'assistant' && assistantMessageLooksSubstantial(tail.content || '', thinkingLabel, deepThinkingLabel)) {
        return;
      }
    }

    // 如果是审批提示语且审批卡片已存在，则忽略（避免重复提示）
    if (isApprovalHintText(content)) {
      const slug = extractApprovalSlugFromHint(content);
      if (slug && hasApprovalCardForSlug(slug)) return;
    }

    // 降噪：部分网关/Agent 会把工具回执/元信息写入 transcript，且错误地标记为 role=user，
    // 导致 UI 看起来像“用户发了一条系统提示”。这里识别常见模板并改写为 toolResult（UI 默认隐藏）。
    const isExecCompletionTemplate =
      typeof content === 'string' &&
      content.includes('An async command the user already approved has completed.') &&
      content.includes('Exact completion details:') &&
      content.includes('Exec finished');

    const isSenderMetadataTemplate =
      typeof content === 'string' &&
      (content.includes('Sender (untrusted metadata):') || content.includes('Sender(untrusted metadata):'));

    if (isExecCompletionTemplate || isSenderMetadataTemplate) {
      const safeText = content.trim().split('\n').join('\n> ');
      const toolName = isSenderMetadataTemplate ? 'sender_metadata' : 'exec';
      content = `> :::toolResult\n> **${toolName}**\n> ${safeText}\n> :::\n`;
    }

    // 降噪："Approval allow-once submitted for <slug>." 是网关对 /approve 的确认回执
    const isApprovalConfirm = /^Approval\s+\S+\s+submitted\s+for\s+[a-f0-9]{8,}/i.test(content.trim());
    if (isApprovalConfirm) {
      content = `> :::toolResult\n> **approval**\n> ${content.trim()}\n> :::\n`;
    }

    // 降噪：用户通过审批按钮发出的 "/approve <slug> allow-once" 命令行消息
    const isApproveCommand = /^\/approve\s+[a-f0-9]{8,}\s+allow-once$/i.test(content.trim());
    if (isApproveCommand) {
      content = `> :::toolResult\n> **approval**\n> ${content.trim()}\n> :::\n`;
    }

    const msgId = msg.id || payload.messageId || `msg-sm-${Date.now()}`;

    setMessages(prev => {
      if (prev.some(m => m.id === msgId)) return prev;

      // 针对 assistant 消息：如果 UI 已有同 runId 的消息，大概率这是延迟到达的 transcript 推送，
      // 且 UI 那条内容更丰富（含 thinking/tool 等 metadata），此时直接跳过，避免 session.message
      // 追加一条"裸正文"导致重复/覆盖 metadata。
      if (msg.role === 'assistant' && msg.runId) {
        const existingByRunId = prev.find(m => m.role === 'assistant' && m.runId === msg.runId);
        if (existingByRunId) {
          const { transcript: uiTranscript } = partitionAssistantContent(existingByRunId.content || '');
          const incomingTrim = content.trim();
          // UI 的 transcript 已经覆盖了这次推送的内容，则直接忽略
          if (uiTranscript && (uiTranscript === incomingTrim || uiTranscript.includes(incomingTrim))) {
            return prev;
          }
        }
      }

      // 内容级去重（metadata 感知）：比较 transcript 部分而非全内容，避免"UI 是 metadata+正文，推送只有正文"被误认为不同
      const tail = prev.slice(-3);
      const incomingTrim = content.trim();
      if (tail.some(m => {
        if (m.content === content) return true;
        const { transcript: mTranscript } = partitionAssistantContent(m.content || '');
        return mTranscript && mTranscript === incomingTrim;
      })) return prev;

      const rawTs = new Date(msg.createdAt || msg.timestamp || Date.now()).getTime();
      const newMsg = {
        id: msgId,
        runId: msg.runId,
        role: (msg.role === 'toolResult' || isExecCompletionTemplate || isSenderMetadataTemplate || isApprovalConfirm || isApproveCommand) ? 'assistant' : msg.role,
        content,
        timestamp: new Date(rawTs).toLocaleTimeString(),
        _sortTs: rawTs
      } as Message;
      const merged = mergeTrailingThinkingIntoPreviousAssistant(prev, newMsg);
      if (merged) return merged;
      return [...prev, newMsg];
    });
  }, [clearStallTimer, extractApprovalSlugFromHint, formatMessageContent, hasApprovalCardForSlug, isApprovalHintText, t]);

  /**
   * 处理 session.tool 事件：展示工具调用进度。
   * phase=start 时追加工具调用标记，phase=end/error 时更新状态。
   */
  const handleSessionTool = useCallback((payload: any) => {
    if (!payload) return;
    const { sessionKey: evtKey, data: toolData } = payload;
    if (!evtKey || evtKey !== sessionKeyRef.current) return;
    if (!toolData) return;

    const phase = toolData.phase as string;
    const toolName = toolData.toolName || toolData.name || 'tool';
    const toolId = toolData.toolCallId || toolData.id || '';
    const marker = toolId ? `tool:${toolId}` : `tool:${toolName}`;

    if (phase === 'start') {
      if (!showThinkingRef.current) return;
      const block = `> 🔧 \`${toolName}\` 执行中…`;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (!last || last.role !== 'assistant') return prev;
        if (last.content.includes(marker)) return prev;
        
        const { metadata: oldMetadata, transcript } = partitionAssistantContent(last.content || '');
        const metadata = oldMetadata ? `${oldMetadata}\n\n${block}` : block;
        const content = transcript ? `${metadata}\n\n${transcript}` : metadata;
        
        return [...prev.slice(0, -1), { ...last, content: `${content}<!-- ${marker} -->` }];
      });
    } else if (phase === 'end' || phase === 'error') {
      const statusIcon = phase === 'end' ? '✅' : '❌';
      setMessages(prev => {
        const idx = prev.findLastIndex(m => m.role === 'assistant' && m.content.includes(marker));
        if (idx === -1) return prev;
        const msg = prev[idx];
        const executingRe = new RegExp(
          `> 🔧 \`${toolName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\` 执行中(?:…|\\.\\.\\.)`,
          'g',
        );
        const updated = msg.content
          .replace(executingRe, `> ${statusIcon} \`${toolName}\` ${phase === 'end' ? '完成' : '失败'}`)
          .replace(`<!-- ${marker} -->`, '');
        const next = [...prev];
        next[idx] = { ...msg, content: updated };
        return next;
      });
    }
  }, [showThinkingRef, t]);

  /**
   * 统一处理网关 event（除 health/connect.challenge/sessions.changed 外）。
   *
   * - tick/presence: 噪声事件，忽略
   * - chat: 转发到流式处理
   * - exec.approval.requested: 注入审批卡片
   * - agent(blocked): 解除 typing/stall，避免 UI 卡住
   */
  const handleGatewayEvent = useCallback((data: any) => {
    if (!data || data.type !== 'event') return;
    const evt = data.event;
    if (!evt) return;

    if (evt === 'tick' || evt === 'presence') return;
    if (evt === 'chat') {
      handleChatDelta(data.payload);
      return;
    }
    if (evt === 'session.message') {
      handleSessionMessage(data.payload);
      return;
    }
    if (evt === 'exec.approval.requested') {
      handleApprovalRequested(data.payload);
      return;
    }
    if (evt === 'exec.approval.resolved') {
      handleApprovalResolved(data.payload);
      return;
    }
    if (evt === 'session.tool') {
      handleSessionTool(data.payload);
      return;
    }
    if (evt === 'agent') {
      const { stream, data: agentData, sessionKey: agentSessionKey } = data.payload || {};
      const effectiveKey = agentSessionKey || sessionKeyRef.current;

      if (stream === 'item' && agentData?.status === 'blocked') {
        lastStreamEventAtRef.current = Date.now();
        setIsTyping(false);
        clearStallTimer();
        streamingAssistantIndexRef.current = null;
      }

      if (stream === 'lifecycle.start' || (stream === 'lifecycle' && agentData?.phase === 'start')) {
        lastStreamEventAtRef.current = Date.now();
        if (effectiveKey) markSessionTyping(effectiveKey, true);
        if (effectiveKey === sessionKeyRef.current) {
          setIsTyping(true);
          resetStallTimer();
        }
      }

      if (stream === 'lifecycle.end' || (stream === 'lifecycle' && agentData?.phase === 'end')) {
        lastStreamEventAtRef.current = Date.now();
        if (effectiveKey) markSessionTyping(effectiveKey, false);
        if (effectiveKey === sessionKeyRef.current) {
          setIsTyping(false);
          clearStallTimer();
          streamingAssistantIndexRef.current = null;
        }
      }

      if (stream === 'lifecycle.error' || (stream === 'lifecycle' && agentData?.phase === 'error')) {
        lastStreamEventAtRef.current = Date.now();
        if (effectiveKey) markSessionTyping(effectiveKey, false);
        if (effectiveKey === sessionKeyRef.current) {
          clearStallTimer();
          setIsTyping(false);
          streamingAssistantIndexRef.current = null;
          const errMsg = agentData?.error?.message || agentData?.message || 'Agent error';
          setMessages(prev => {
            const last = prev[prev.length - 1];
            if (!last || last.role !== 'assistant') return prev;
            const content = (!last.content || last.content === t('chat.thinking') || last.content === t('chat.deepThinking', { defaultValue: '深度思考中...' }))
              ? `> **⚠️ Agent 错误**\n> ${errMsg}`
              : `${last.content}\n\n> **⚠️ Agent 错误**\n> ${errMsg}`;
            return [...prev.slice(0, -1), { ...last, content }];
          });
        }
      }

      // 处理实时流：thinking / plan / command_output / tool
      // 事件数据结构通常为 { itemId, phase: start|delta|end, title, toolCallId, name, output|content|delta|text, status }
      // 同一个 itemId 在整个运行期间只对应一个折叠块（按 itemId 做 upsert）。
      if (
        stream === 'thinking' ||
        stream === 'plan' ||
        stream === 'command_output' ||
        stream === 'tool'
      ) {
        if (effectiveKey !== sessionKeyRef.current) return;

        let itemId = '';
        let title = '';
        let body: any = '';

        if (typeof agentData === 'string') {
          body = agentData;
        } else if (agentData && typeof agentData === 'object') {
          itemId = agentData.itemId || agentData.toolCallId || agentData.id || '';
          title = agentData.title || agentData.name || '';
          // command_output 典型字段是 output（全量累积）
          body = agentData.output
            ?? agentData.content
            ?? agentData.text
            ?? agentData.delta
            ?? agentData.reasoning
            ?? agentData.thinking
            ?? '';

          // tool 流通常带 arguments/result 结构
          if (stream === 'tool') {
            const args = agentData.arguments ?? agentData.args;
            const result = agentData.result ?? agentData.output;
            const parts: string[] = [];
            if (args) {
              const a = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
              parts.push(`**参数:**\n\`\`\`json\n${a}\n\`\`\``);
            }
            if (result) {
              const r = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
              parts.push(`**结果:**\n\`\`\`\n${r}\n\`\`\``);
            }
            if (parts.length > 0) body = parts.join('\n\n');
          }
        }

        if (typeof body !== 'string') body = JSON.stringify(body);
        if (!body && !title) {
          // 没内容可展示（例如仅生命周期 ping），只刷新 stall 计时器
          lastStreamEventAtRef.current = Date.now();
          resetStallTimer();
          return;
        }

        const segmentName =
          stream === 'command_output' ? 'commandOutput' :
          stream === 'tool' ? 'toolCall' :
          stream; // thinking | plan

        lastStreamEventAtRef.current = Date.now();
        resetStallTimer();
        setIsTyping(true);

        setMessages(prev => {
          const idx = streamingAssistantIndexRef.current;
          if (idx === null || idx < 0 || idx >= prev.length) return prev;
          const msg = prev[idx];
          const { metadata: oldMetadata, transcript } = partitionAssistantContent(msg.content || '');
          const newMetadata = upsertAgentBlock(oldMetadata || '', segmentName, itemId, title, body);
          const combinedContent = transcript ? `${newMetadata}\n\n${transcript}` : newMetadata;
          const next = [...prev];
          next[idx] = { ...msg, content: combinedContent };
          return next;
        });
      }

      return;
    }
    if (evt === 'shutdown') {
      const reason = data.payload?.reason || data.payload?.message || '';
      const delay = data.payload?.delay ?? data.payload?.gracePeriodMs;
      const delayStr = typeof delay === 'number' && delay > 0 ? `（${Math.ceil(delay / 1000)}s 后断开）` : '';
      antdMessage.warning({
        content: t('chat.shutdownNotice', { defaultValue: `网关即将关闭${delayStr}${reason ? '：' + reason : ''}，连接将自动重建` }),
        duration: 8,
        key: 'gateway-shutdown',
      });
      return;
    }
  }, [clearStallTimer, handleApprovalRequested, handleApprovalResolved, handleChatDelta, handleSessionMessage, handleSessionTool, markSessionTyping, resetStallTimer, t]);

  /**
   * 加载会话历史并写入 messages；同时用 sessionCacheRef 缝合 DB 未落盘的临时消息。
   */
  const loadSessionHistory = useCallback(async (key: string) => {
    const requestId = ++historyRequestSeqRef.current;
    latestHistoryRequestRef.current = requestId;
    setIsLoadingHistory(true);
    streamingAssistantIndexRef.current = null;

    const res = await sendRPC('chat.history', { sessionKey: key, limit: 500 });
    const isActiveRequest = () =>
      latestHistoryRequestRef.current === requestId && sessionKeyRef.current === key;

    if (!res.ok) {
      if (latestHistoryRequestRef.current === requestId) {
        setIsLoadingHistory(false);
      }
      return;
    }

    const items = (res.payload.messages || res.payload.items || [])
      .sort((a: any, b: any) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());
    const history = items.map((item: any) => {
      let content = formatMessageContent(item.content);
      if (item.role === 'toolResult' && !content.includes(':::toolResult')) {
        const toolName = item.toolName || 'unknown';
        const text = typeof item.content === 'string' ? item.content : JSON.stringify(item.content);
        content = `> :::toolResult\n> **${toolName}**\n> ${text.split('\n').join('\n> ')}\n> :::\n`;
      }

      // 降噪（与实时 handleSessionMessage 保持一致）：
      // 1) exec 完成回执被网关错误标记为 user —— 改写为隐藏的 toolResult
      let roleOverride: string | null = null;
      const isExec =
        typeof content === 'string' &&
        content.includes('An async command the user already approved has completed.') &&
        content.includes('Exact completion details:') &&
        content.includes('Exec finished');
      const isSender =
        typeof content === 'string' &&
        (content.includes('Sender (untrusted metadata):') || content.includes('Sender(untrusted metadata):'));
      if (isExec || isSender) {
        const safeText = content.trim().split('\n').join('\n> ');
        const toolName = isSender ? 'sender_metadata' : 'exec';
        content = `> :::toolResult\n> **${toolName}**\n> ${safeText}\n> :::\n`;
        roleOverride = 'assistant';
      }

      // 2) 审批提示语（与审批卡片重复）—— 直接丢弃
      if (isApprovalHintText(content)) {
        const slug = extractApprovalSlugFromHint(content);
        const hasCard = items.some((it: any) => {
          const c = formatMessageContent(it.content);
          return c && c.includes(':::approval') && slug && c.includes(slug);
        });
        if (slug && hasCard) {
          content = '';
        }
      }

      // 3) "Approval allow-once submitted for <slug>." —— 网关确认回执
      if (/^Approval\s+\S+\s+submitted\s+for\s+[a-f0-9]{8,}/i.test(content.trim())) {
        content = `> :::toolResult\n> **approval**\n> ${content.trim()}\n> :::\n`;
        roleOverride = 'assistant';
      }

      // 4) "/approve <slug> allow-once" —— 按钮触发的指令消息
      if (/^\/approve\s+[a-f0-9]{8,}\s+allow-once$/i.test(content.trim())) {
        content = `> :::toolResult\n> **approval**\n> ${content.trim()}\n> :::\n`;
        roleOverride = 'assistant';
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
        _sortTs: rawTs
      } as Message;
    }).filter((msg: any) => msg.content && msg.content.trim() !== '');
    compactAssistantThinkingAfterToolInPlace(history);

    let shouldKeepTyping = false;
    const cache = sessionCacheRef.current.get(key);

    // 还原缓存里保留的 thinking/plan/toolCall 等折叠块：
    // 这些 metadata 只在 WS 的 agent / session.tool 事件里出现，DB transcript 通常不持久化它们。
    // 这里用 runId 匹配贴回，保证切换会话再回来时折叠块仍然可见。
    // 注意：同一 runId 可能有多条 assistant 消息（思考/工具/正文被拆），metadata 只贴到最后一条，避免重复。
    if (cache?.metadataByRunId && cache.metadataByRunId.size > 0) {
      const lastIdxByRunId = new Map<string, number>();
      for (let i = 0; i < history.length; i++) {
        const row: any = history[i];
        if (row.role !== 'assistant' || !row.runId) continue;
        if (!cache.metadataByRunId.has(row.runId)) continue;
        lastIdxByRunId.set(row.runId, i);
      }
      lastIdxByRunId.forEach((idx, runId) => {
        const row: any = history[idx];
        const saved = cache.metadataByRunId.get(runId);
        if (!saved) return;
        const { metadata: already, transcript } = partitionAssistantContent(row.content || '');
        if (already) return;
        row.content = transcript ? `${saved}\n\n${transcript}` : saved;
      });
    }

    if (cache) {
      touchAndPruneSessionCache(key, cache);
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
              _sortTs: userMsgSortTs + 1
            } as Message);
          }
        }
        shouldKeepTyping = true;
      }
    }

    const roleOrder: Record<string, number> = { system: 0, user: 1, assistant: 2 };
    const finalMessages = [...history].sort((a: any, b: any) => {
      const diff = (a._sortTs || 0) - (b._sortTs || 0);
      if (diff !== 0) return diff;
      return (roleOrder[a.role] || 0) - (roleOrder[b.role] || 0);
    });
    stripTrailingUiThinkingPlaceholderAfterAssistantReply(
      finalMessages,
      t('chat.thinking'),
      t('chat.deepThinking', { defaultValue: '深度思考中...' }),
    );

    if (!isActiveRequest()) {
      if (latestHistoryRequestRef.current === requestId) setIsLoadingHistory(false);
      return;
    }

    if (shouldKeepTyping) {
      setIsTyping(true);
      resetStallTimer();
    } else {
      setIsTyping(false);
      clearStallTimer();
    }
    setMessages(finalMessages);

    if (history.length > 0) {
      setTimeout(() => {
        if (!isActiveRequest()) return;
        virtuosoRef.current?.scrollToIndex({ index: history.length - 1, align: 'end', behavior: 'auto' });
      }, 50);
    }
    setIsLoadingHistory(false);
  }, [clearStallTimer, extractApprovalSlugFromHint, formatMessageContent, isApprovalHintText, resetStallTimer, sendRPC, t, touchAndPruneSessionCache, virtuosoRef]);

  /**
   * 发送消息：必要时创建会话并写入初始占位消息，然后向网关发起 chat.send。
   */
  const handleSend = useCallback(async (content?: any, attachedFiles?: FileInfo[]) => {
    const text = (typeof content === 'string' ? content : '').trim();
    if (isTyping) return;
    if ((!text && (!attachedFiles || attachedFiles.length === 0)) || status !== 'authenticated') return;

    abortRequestedRef.current = null;
    setIsTyping(true);
    setTpsData([]);
    chatEventSeenSinceSendRef.current = false;
    hadTypingSinceSendRef.current = true;

    let currentKey = sessionKey;
    if (!currentKey) {
      const res = await sendRPC('sessions.create', { agentId: selectedBot.replace('openclaw:', '') });
      if (res.ok) {
        currentKey = res.payload.key;
        setSessionKey(currentKey);
        // 兼容：部分网关版本只认 key 字段
        sendRPC('sessions.messages.subscribe', { key: currentKey, sessionKey: currentKey }).catch(() => {});
        await sendRPC('sessions.patch', { key: currentKey, thinkingLevel, model: sessionModel });
        fetchSessions();
      } else {
        antdMessage.error(t('chat.failedToCreateSession') || 'Failed to create session: ' + (res.error?.message || 'Unknown'));
        setIsTyping(false);
        return;
      }
    }

    if (!currentKey) {
      setIsTyping(false);
      streamingAssistantIndexRef.current = null;
      antdMessage.error(t('chat.sessionKeyMissing'));
      return;
    }

    // 发送动作一开始就标记该会话“正在生成中”（即使尚未收到首个 delta）
    markSessionTyping(currentKey, true);

    let finalContent = text;
    if (attachedFiles && attachedFiles.length > 0) {
      const fileLinks = attachedFiles.map(f => {
        const isImage = f.ext.match(/\.(jpg|jpeg|png|gif|webp|svg)$/i);
        return isImage
          ? `\n![${f.filename}](${f.thumbUrl || f.url} \"${f.url}\")\n(File path: ${f.path})`
          : `\n[${f.filename}](${f.url}) (File path: ${f.path})`;
      }).join('');
      finalContent += fileLinks + `\n\n**System Note for Expert:** The user has uploaded files. Access them via absolute \"File path\" provided.`;
    }

    const now = Date.now();
    const newUserMsg: Message = {
      id: `msg-${now}`,
      role: 'user',
      content: finalContent,
      timestamp: new Date(now).toLocaleTimeString(),
      _sortTs: now
    };

    const aiSortTs = now + 1;
    const assistantInitialMsg = text === '/stop' ? t('chat.terminated') : t('chat.thinking');
    const aiPlaceholderMsg: Message = {
      id: `msg-ai-${now}`,
      role: 'assistant',
      content: assistantInitialMsg,
      timestamp: new Date(now).toLocaleTimeString(),
      _sortTs: aiSortTs
    };

    const prevCacheForSession = sessionCacheRef.current.get(currentKey);
    const nextCache: SessionStreamCache = {
      fullText: '',
      isTyping: true,
      startTime: Date.now(),
      firstTokenTime: 0,
      ttftRecorded: false,
      tokenCount: 0,
      tpsData: [],
      lastUserMsg: newUserMsg,
      lastTouched: Date.now(),
      metadataByRunId: prevCacheForSession?.metadataByRunId || new Map()
    };
    touchAndPruneSessionCache(currentKey, nextCache);

    setMessages(prev => {
      const next = [...prev, newUserMsg, aiPlaceholderMsg];
      streamingAssistantIndexRef.current = next.length - 1;
      return next;
    });
    resetStallTimer();

    setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: messagesCountRef.current + 1,
        align: 'end',
        behavior: 'smooth'
      });
    }, 100);

    const res = await sendRPC('chat.send', {
      sessionKey: currentKey,
      message: finalContent,
      idempotencyKey: `ik-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    });

    if (res.ok && res.payload?.runId) {
      const cache = sessionCacheRef.current.get(currentKey);
      if (cache) {
        cache.runId = res.payload.runId;
        touchAndPruneSessionCache(currentKey, cache);
      }
      setMessages(prev => {
        const lastIndex = prev.findLastIndex(m => m.role === 'assistant' && !m.runId);
        if (lastIndex !== -1) {
          const next = [...prev];
          next[lastIndex] = { ...next[lastIndex], runId: res.payload.runId };
          return next;
        }
        return prev;
      });
    }

    if (!res.ok) {
      antdMessage.error(t('chat.sendFailed', { reason: res.error?.message || 'Unknown' }));
      setIsTyping(false);
      streamingAssistantIndexRef.current = null;
      clearStallTimer();
      injectDiagnosticIfNoChatEvent(`chat.send 失败: ${res.error?.message || 'Unknown'}`);
      const cache = sessionCacheRef.current.get(currentKey);
      if (cache) {
        cache.isTyping = false;
        touchAndPruneSessionCache(currentKey, cache);
      }
      markSessionTyping(currentKey, false);
    } else if (text === '/stop') {
      setIsTyping(false);
      streamingAssistantIndexRef.current = null;
      clearStallTimer();
      const cache = sessionCacheRef.current.get(currentKey);
      if (cache) {
        cache.isTyping = false;
        touchAndPruneSessionCache(currentKey, cache);
      }
      markSessionTyping(currentKey, false);
    }
  }, [clearStallTimer, fetchSessions, inputAreaRef, isTyping, markSessionTyping, resetStallTimer, scrollRef, selectedBot, sendRPC, sessionKey, sessionModel, setSessionKey, status, t, thinkingLevel, touchAndPruneSessionCache, virtuosoRef]);

  /**
   * 重试/再生成：复用既有的 User 消息，不额外创建新的 User 消息。
   */
  const resendFromExistingUserMessage = useCallback(async (userMsg: Message) => {
    if (!sessionKey) return;
    if (status !== 'authenticated') return;
    if (isTyping) return;

    const finalContent = (userMsg.content || '').trim();
    if (!finalContent) return;

    setIsTyping(true);
    setTpsData([]);
    chatEventSeenSinceSendRef.current = false;
    hadTypingSinceSendRef.current = true;
    // 重试/再生成：立刻标记“正在生成中”，覆盖首 token 空窗期
    markSessionTyping(sessionKey, true);

    const baseSortTs = userMsg._sortTs || Date.now();
    const aiPlaceholderMsg: Message = {
      id: `msg-ai-${Date.now()}`,
      role: 'assistant',
      content: t('chat.thinking'),
      timestamp: new Date().toLocaleTimeString(),
      _sortTs: baseSortTs + 1
    };

    const prevCacheForSession = sessionCacheRef.current.get(sessionKey);
    const nextCache: SessionStreamCache = {
      fullText: '',
      isTyping: true,
      startTime: Date.now(),
      firstTokenTime: 0,
      ttftRecorded: false,
      tokenCount: 0,
      tpsData: [],
      lastUserMsg: userMsg,
      lastTouched: Date.now(),
      metadataByRunId: prevCacheForSession?.metadataByRunId || new Map()
    };
    touchAndPruneSessionCache(sessionKey, nextCache);

    setMessages(prev => {
      const next = [...prev, aiPlaceholderMsg];
      streamingAssistantIndexRef.current = next.length - 1;
      return next;
    });
    resetStallTimer();

    setTimeout(() => {
      virtuosoRef.current?.scrollToIndex({
        index: messagesCountRef.current,
        align: 'end',
        behavior: 'smooth'
      });
    }, 100);

    const res = await sendRPC('chat.send', {
      sessionKey,
      message: finalContent,
      idempotencyKey: `regen-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
    });

    if (res.ok && res.payload?.runId) {
      const cache = sessionCacheRef.current.get(sessionKey);
      if (cache) {
        cache.runId = res.payload.runId;
        touchAndPruneSessionCache(sessionKey, cache);
      }
      setMessages(prev => {
        const lastIndex = prev.findLastIndex(m => m.role === 'assistant' && !m.runId);
        if (lastIndex !== -1) {
          const next = [...prev];
          next[lastIndex] = { ...next[lastIndex], runId: res.payload.runId };
          return next;
        }
        return prev;
      });
    }

    if (!res.ok) {
      antdMessage.error(t('chat.sendFailed', { reason: res.error?.message || 'Unknown' }));
      setIsTyping(false);
      streamingAssistantIndexRef.current = null;
      clearStallTimer();
      injectDiagnosticIfNoChatEvent(`chat.send 失败: ${res.error?.message || 'Unknown'}`);
      const cache = sessionCacheRef.current.get(sessionKey);
      if (cache) {
        cache.isTyping = false;
        touchAndPruneSessionCache(sessionKey, cache);
      }
      markSessionTyping(sessionKey, false);
    }
  }, [clearStallTimer, isTyping, markSessionTyping, resetStallTimer, sendRPC, sessionKey, status, t, touchAndPruneSessionCache, virtuosoRef]);

  /**
   * 停止生成：更新 UI 并通过 chat.abort 中止 Agent 运行，不污染对话历史。
   */
  const handleStopGeneration = useCallback(async () => {
    if (!sessionKey) return;
    if (status !== 'authenticated') return;

    abortRequestedRef.current = { key: sessionKey, ts: Date.now() };
    setIsTyping(false);
    clearStallTimer();
    streamingAssistantIndexRef.current = null;
    markSessionTyping(sessionKey, false);
    streamEndGraceRef.current = { key: sessionKey, until: Date.now() + 3000 };

    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last?.role === 'assistant') {
        const label = t('chat.manuallyStopped', { defaultValue: '已手动停止' });
        const content = (last.content === t('chat.thinking') || !last.content) ? label : last.content + ` (${label})`;
        return [...prev.slice(0, -1), { ...last, content }];
      }
      return prev;
    });

    const res = await sendRPC('chat.abort', { sessionKey });
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn('⚠️ chat.abort 失败，回退到 /stop:', res.error);
      await sendRPC('chat.send', {
        sessionKey,
        message: '/stop',
        idempotencyKey: `stop-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      });
    }
  }, [clearStallTimer, markSessionTyping, sendRPC, sessionKey, status, t]);

  /**
   * 再生成：截断到最后一条 user 并复用该 user 消息重发。
   */
  const handleRegenerate = useCallback(() => {
    if (isTyping) {
      antdMessage.warning(t('chat.waitUntilFinishWarning'));
      return;
    }
    const currentMessages = messagesRef.current;
    const lastUserIndex = [...currentMessages].reverse().findIndex(m => m.role === 'user');
    if (lastUserIndex === -1) return;
    const actualIndex = currentMessages.length - 1 - lastUserIndex;
    const lastUserMsg = currentMessages[actualIndex];

    setMessages(prev => prev.slice(0, actualIndex + 1));
    streamingAssistantIndexRef.current = null;
    resendFromExistingUserMessage(lastUserMsg);
  }, [isTyping, resendFromExistingUserMessage, t]);

  /**
   * 编辑并重发：使用 sessions.steer 自动中断当前活跃的 run 并发送新内容。
   * 对 user 消息直接 steer（截断后续），非 user 消息兜底为新发送。
   */
  const handleSaveEdit = useCallback(async (editingMsgIndex: number, editContent: string) => {
    if (isTyping) {
      antdMessage.warning(t('chat.waitUntilFinishWarning'));
      return;
    }
    const newText = (editContent || '').trim();
    if (!newText) return;

    const currentKey = sessionKeyRef.current;
    if (!currentKey || status !== 'authenticated') {
      handleSend(newText);
      return;
    }

    const target = messagesRef.current[editingMsgIndex];
    if (target?.role === 'user') {
      const updatedUser: Message = { ...target, content: newText };
      setMessages(prev => [...prev.slice(0, editingMsgIndex), updatedUser]);
      streamingAssistantIndexRef.current = null;

      setIsTyping(true);
      setTpsData([]);
      chatEventSeenSinceSendRef.current = false;
      hadTypingSinceSendRef.current = true;
      markSessionTyping(currentKey, true);

      const baseSortTs = updatedUser._sortTs || Date.now();
      const aiPlaceholderMsg: Message = {
        id: `msg-ai-${Date.now()}`,
        role: 'assistant',
        content: t('chat.thinking'),
        timestamp: new Date().toLocaleTimeString(),
        _sortTs: baseSortTs + 1
      };
      const prevCacheForSession = sessionCacheRef.current.get(currentKey);
      const nextCache: SessionStreamCache = {
        fullText: '',
        isTyping: true,
        startTime: Date.now(),
        firstTokenTime: 0,
        ttftRecorded: false,
        tokenCount: 0,
        tpsData: [],
        lastUserMsg: updatedUser,
        lastTouched: Date.now(),
        metadataByRunId: prevCacheForSession?.metadataByRunId || new Map()
      };
      touchAndPruneSessionCache(currentKey, nextCache);
      setMessages(prev => {
        const next = [...prev, aiPlaceholderMsg];
        streamingAssistantIndexRef.current = next.length - 1;
        return next;
      });
      resetStallTimer();

      const res = await sendRPC('sessions.steer', {
        key: currentKey,
        message: newText,
        idempotencyKey: `steer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
      });
      if (res.ok && res.payload?.runId) {
        const cache = sessionCacheRef.current.get(currentKey);
        if (cache) cache.runId = res.payload.runId;
      }
      if (!res.ok) {
        setIsTyping(false);
        markSessionTyping(currentKey, false);
        clearStallTimer();
        streamingAssistantIndexRef.current = null;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && (last.content === t('chat.thinking') || !last.content)) {
            return prev.slice(0, -1);
          }
          return prev;
        });
        antdMessage.error(t('chat.steerFailed', { defaultValue: `重发失败: ${res.error?.message || res.error || '未知错误'}` }));
      }
      return;
    }

    setMessages(prev => prev.slice(0, editingMsgIndex));
    streamingAssistantIndexRef.current = null;
    handleSend(newText);
  }, [clearStallTimer, handleSend, isTyping, markSessionTyping, resetStallTimer, sendRPC, status, t, touchAndPruneSessionCache]);

  /**
   * 当连接断开/错误时统一清理消息侧状态。
   */
  useEffect(() => {
    if (status === 'disconnected' || status === 'error') {
      injectDiagnosticIfNoChatEvent(`连接状态变更: ${status}`);
      setIsTyping(false);
      setHasNewMessages(false);
      streamingAssistantIndexRef.current = null;
      clearStallTimer();
      typingSessionsRef.current.clear();
      setTypingSessionKeys([]);
    }
  }, [status, clearStallTimer]);

  const prevStatusRef = useRef(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (status !== 'authenticated' || prev === 'authenticated') return;
    // 重连后同步：检查当前会话是否有中断的流式生成
    const key = sessionKeyRef.current;
    if (!key) return;

    const cache = sessionCacheRef.current.get(key);
    if (cache && cache.isTyping) {
      // 断连前有流正在进行，标记 stalled 提示用户
      setIsStalled(true);
      setIsTyping(false);
      cache.isTyping = false;
      streamingAssistantIndexRef.current = null;
      markSessionTyping(key, false);
    }
    // 无论如何都重新加载历史，确保与服务端状态一致
    loadSessionHistory(key);
  }, [status, loadSessionHistory, markSessionTyping]);

  /**
   * 注入 assistant 消息到当前会话的 transcript（不触发 AI 回复）。
   * 用于操作者向会话注入提示、备注等。
   */
  const handleInjectMessage = useCallback(async (text: string, label?: string) => {
    const currentKey = sessionKeyRef.current;
    if (!currentKey || status !== 'authenticated') return;
    const trimmed = (text || '').trim();
    if (!trimmed) return;

    const res = await sendRPC('chat.inject', {
      sessionKey: currentKey,
      message: trimmed,
      ...(label ? { label } : {})
    });
    if (res.ok) {
      const rawTs = Date.now();
      const injectedMsg: Message = {
        id: res.payload?.messageId || `msg-inject-${rawTs}`,
        role: 'assistant',
        content: trimmed,
        timestamp: new Date(rawTs).toLocaleTimeString(),
        _sortTs: rawTs
      };
      setMessages(prev => [...prev, injectedMsg]);
    } else {
      antdMessage.error(t('chat.injectFailed', { defaultValue: `注入失败: ${res.error?.message || res.error || '未知错误'}` }));
    }
  }, [sendRPC, status, t]);

  return useMemo(() => {
    return {
      messages,
      setMessages,
      isTyping,
      isStalled,
      isLoadingHistory,
      tpsData,
      hasNewMessages,
      setHasNewMessages,
      typingSessionKeys,
      handleChatDelta,
      handleApprovalRequested,
      handleGatewayEvent,
      loadSessionHistory,
      handleSend,
      handleStopGeneration,
      handleRegenerate,
      handleSaveEdit,
      handleInjectMessage,
      showScrollBtnRef,
      messagesCountRef,
      getMessagesCount: () => messagesCountRef.current
    };
  }, [handleApprovalRequested, handleChatDelta, handleGatewayEvent, handleInjectMessage, handleRegenerate, handleSaveEdit, handleSend, handleStopGeneration, hasNewMessages, isLoadingHistory, isStalled, isTyping, messages, setMessages, tpsData, typingSessionKeys, showScrollBtnRef]);
}

