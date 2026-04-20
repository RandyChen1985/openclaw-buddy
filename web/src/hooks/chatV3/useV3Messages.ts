import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { message as antdMessage } from 'antd';
import type { FileInfo, Message } from '../useChatV3WebSocket';
import { buildBuddyDirectSessionKey } from '../../utils/buddySessionKey';

/** 收到 chat final 后延迟再松 typing，避免多段 final / 尾包 delta 时误以为已可输入 */
const FINAL_UI_SETTLE_MS = 650;

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
 * 在已有 agent block 的末尾追加内容（非替换），常用于 command_output 的 delta/chunk 累积。
 * 若块不存在则回退到 upsertAgentBlock 新建。
 */
function appendToAgentBlock(
  metadata: string,
  segmentName: string,
  itemId: string,
  additionalBody: string,
  title: string = '',
): string {
  if (!additionalBody) return metadata;
  const marker = itemId ? `${AGENT_ITEM_MARKER_PREFIX}${segmentName}:${itemId}-->` : '';
  if (marker && metadata.includes(marker)) {
    const markerIdx = metadata.indexOf(marker);
    const afterMarker = metadata.slice(markerIdx);
    // 定位本 block 的关闭行 "> :::"
    const closeRelMatch = afterMarker.match(/\n>\s*:::\s*(?=\n|$)/);
    if (closeRelMatch && closeRelMatch.index !== undefined) {
      const absCloseIdx = markerIdx + closeRelMatch.index;
      const insertion = `\n${toBlockquoteLines(additionalBody)}`;
      return metadata.slice(0, absCloseIdx) + insertion + metadata.slice(absCloseIdx);
    }
  }
  // 块不存在：新建（把 additionalBody 当作初始 body）
  return upsertAgentBlock(metadata, segmentName, itemId, title, additionalBody);
}

const META_MESSAGE_ID_PREFIX = 'meta-';

/**
 * 在消息列表里找/新建某个 run 的 "思考信息附录气泡"（_uiMetaOnly = true），
 * 并用 updateFn 更新它的 content。meta 气泡独立于正文气泡存在，
 * - 跟在同 runId 的正文气泡后面显示；
 * - 不参与 session.message 的合并/去重（它是纯 UI、无持久化 id 的）；
 * - showThinking 关闭时整体在渲染层过滤掉。
 *
 * 若新建时 updateFn 返回空串，直接返回原列表（避免建出空气泡）。
 */
function updateMetaMessage(
  prev: Message[],
  runId: string | undefined,
  updateFn: (currentContent: string) => string,
): Message[] {
  const metaId = runId ? `${META_MESSAGE_ID_PREFIX}${runId}` : `${META_MESSAGE_ID_PREFIX}floating`;

  let mainIdx = -1;
  let metaIdx = -1;
  for (let i = 0; i < prev.length; i++) {
    const m = prev[i];
    if (m._uiMetaOnly && m.id === metaId) {
      metaIdx = i;
    } else if (!m._uiMetaOnly && m.role === 'assistant' && runId && m.runId === runId && mainIdx === -1) {
      mainIdx = i;
    }
  }

  if (metaIdx !== -1) {
    const meta = prev[metaIdx];
    const newContent = updateFn(meta.content || '');
    if (newContent === (meta.content || '')) return prev;
    const next = [...prev];
    next[metaIdx] = { ...meta, content: newContent };
    return next;
  }

  // 兜底定位：没匹配到同 runId 主气泡时，取列表里最后一条非 meta 的 assistant
  if (mainIdx === -1) {
    for (let i = prev.length - 1; i >= 0; i--) {
      const m = prev[i];
      if (!m._uiMetaOnly && m.role === 'assistant') { mainIdx = i; break; }
    }
  }

  const parentSortTs = mainIdx !== -1 ? (prev[mainIdx]._sortTs || Date.now()) : Date.now();
  const newContent = updateFn('');
  if (!newContent) return prev;

  const newMeta: Message = {
    id: metaId,
    runId: runId,
    role: 'assistant',
    content: newContent,
    timestamp: new Date(parentSortTs + 1).toLocaleTimeString(),
    _sortTs: parentSortTs + 1,
    _uiMetaOnly: true,
  };

  if (mainIdx !== -1) {
    const next = [...prev];
    next.splice(mainIdx + 1, 0, newMeta);
    return next;
  }
  return [...prev, newMeta];
}

/** 列表中最后一条「正文」助手消息下标（排除 _uiMetaOnly 附录气泡）。审批等必须落在主气泡，不能跟在最后一条 meta 上。 */
function findLastMainAssistantIndex(prev: Message[]): number {
  for (let i = prev.length - 1; i >= 0; i--) {
    const m = prev[i];
    if (m.role === 'assistant' && !m._uiMetaOnly) return i;
  }
  return -1;
}

/** 从内容中移除与 slug 对应的一条 :::approval 块（用于纠正误写入 meta 气泡的历史数据） */
function stripApprovalBlockWithSlug(content: string, slug: string): string {
  if (!content || !slug || !content.includes(':::approval')) return content;
  const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const blockRe = new RegExp(
    `(?:^|\\n)\\n?> :::approval\\n> \\*\\*${esc}\\*\\*\\n[\\s\\S]*?\\n> :::\\n*`,
    'g',
  );
  return content.replace(blockRe, '\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

/**
 * 网关 transcript 的 session.message 是否应对齐到「已有主气泡」的同一 runId。
 * 若为 true，在 typing / streamEndGrace 期间仍应处理：否则审批后正文只走 transcript、
 * 不走 chat.delta 时会被防冲突逻辑整段丢弃，用户只能重新拉历史才看见。
 */
function sessionMessageMergesExistingAssistantRun(rows: Message[], msg: { role?: string; runId?: string }): boolean {
  if (!msg || msg.role !== 'assistant' || !msg.runId) return false;
  const rid = String(msg.runId);
  for (let i = 0; i < rows.length; i++) {
    const m = rows[i];
    if (m._uiMetaOnly) continue;
    if (m.role !== 'assistant') continue;
    if (m.runId === rid) return true;
  }
  return false;
}

/** 列表中时间上最后一条 user 消息的纯文本（trim），用于识别刚发出的 /approve */
function lastUserMessageContent(rows: Message[]): string {
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i].role === 'user') return String(rows[i].content || '').trim();
  }
  return '';
}

/** 用户显式发送的 /approve（单次或永久），用于 session.message 守卫放行等 */
const APPROVE_USER_CMD_LINE_RE = /^\/approve\s+[a-f0-9-]+\s+(allow-once|allow-always)$/i;

/**
 * session.message 在 typing / streamEndGrace 窗口下是否仍应收下。
 * 除「同 runId 可合并进已有主气泡」外，用户刚发 /approve 后网关常仍标 typing、且 transcript 的 runId
 * 可能与 UI 气泡不一致或缺失——若仅依赖 runId 合并判断会间歇丢正文。
 */
function shouldBypassSessionMessageTypingGuard(rows: Message[], msg: { role?: string; runId?: string }): boolean {
  if (!msg || msg.role !== 'assistant') return false;
  if (sessionMessageMergesExistingAssistantRun(rows, msg)) return true;
  if (APPROVE_USER_CMD_LINE_RE.test(lastUserMessageContent(rows))) return true;
  return false;
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
  const approveCmdRe = /^\s*(?:>\s*)?\/approve\s+[a-f0-9-]+\s+(allow-once|allow-always)\s*$/i;
  const approveConfirmRe = /^\s*(?:>\s*)?[\s\u2705]*✅?\s*Approval\s+\S+\s+submitted\s+for\s+[a-f0-9-]+/i;
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
  /** 为 true 时禁止发送（例如正在 sessions.create 新会话，此时 sessionKey 状态仍是旧会话） */
  sessionComposeBlocked?: boolean;
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
  showThinkingRef,
  sessionComposeBlocked = false
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
  // 与流式事件过滤共用：必须在 paint 前与 sessionKey 对齐，避免「新会话已显示但 ref 仍指向旧会话」导致串会话
  useLayoutEffect(() => {
    sessionKeyRef.current = sessionKey;
  }, [sessionKey]);

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
  /** 按 sessionKey 记录 final 后的延时释放任务，避免多会话并发时产生清理冲突 */
  const finalUiReleaseTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // 已请求停止：从点击"停止"到收到 aborted/final 之间，屏蔽后续 delta 写入
  const abortRequestedRef = useRef<{ key: string; ts: number } | null>(null);

  const cancelPendingFinalUiRelease = useCallback((key?: string) => {
    if (key) {
      const timer = finalUiReleaseTimersRef.current.get(key);
      if (timer) {
        clearTimeout(timer);
        finalUiReleaseTimersRef.current.delete(key);
      }
    } else {
      finalUiReleaseTimersRef.current.forEach(timer => clearTimeout(timer));
      finalUiReleaseTimersRef.current.clear();
    }
  }, []);

  useEffect(() => () => cancelPendingFinalUiRelease(), [cancelPendingFinalUiRelease]);

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
    }, 2000);
  }, [clearStallTimer]);

  /**
   * 新建/切换会话时解除「当前消息区」的生成中锁：根据目标会话是否在生成中来平滑过渡 isTyping 状态。
   * 由会话层通过 messageOpsRef 调用（不代替 chat.abort，仅维护本地 UI 状态）。
   *
   * @param nextKey 目标切换的会话 Key
   */
  const resetTypingState = useCallback((nextKey?: string) => {
    const current = sessionKeyRef.current;
    if (current) cancelPendingFinalUiRelease(current);
    abortRequestedRef.current = null;
    clearStallTimer();

    // 如果目标会话已经在生成中（侧边栏有笔），则无缝平滑过渡 isTyping 状态，避免输入框闪烁释放
    const targetIsTyping = nextKey ? typingSessionsRef.current.has(nextKey) : false;
    
    setIsTyping(targetIsTyping);
    if (targetIsTyping) {
      resetStallTimer();
    }
    
    streamingAssistantIndexRef.current = null;
  }, [cancelPendingFinalUiRelease, clearStallTimer, resetStallTimer]);

  /**
   * 延迟释放生成中锁：统一管理 chat.final 与 agent.lifecycle.end 的释锁时机。
   * 采用“最后一次到达延迟发放”策略，确保各路流信息（消息、思考、工具调用）全部落盘后再解锁。
   */
  const releaseTypingLock = useCallback((key: string, ms = FINAL_UI_SETTLE_MS) => {
    cancelPendingFinalUiRelease(key);
    const timer = setTimeout(() => {
      if (finalUiReleaseTimersRef.current.get(key) === timer) {
        finalUiReleaseTimersRef.current.delete(key);
      }
      markSessionTyping(key, false);
      if (key === sessionKeyRef.current) {
        setIsTyping(false);
        streamingAssistantIndexRef.current = null;
        fetchSessions(true);
        setTimeout(() => inputAreaRef.current?.focus(), 100);
      } else {
        fetchSessions(true);
      }
    }, ms);
    finalUiReleaseTimersRef.current.set(key, timer);
  }, [cancelPendingFinalUiRelease, fetchSessions, inputAreaRef, markSessionTyping]);


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
   * “需要批准…请运行 /approve … allow-once|allow-always” 的提示语。UI 已有审批卡片时，这段文字应隐藏。
   */
  const extractApprovalSlugFromHint = useCallback((text: string): string => {
    if (!text) return '';
    const m = /\/approve\s+([a-f0-9-]+)\s+(allow-once|allow-always)/i.exec(text);
    if (!m) return '';
    const id = m[1].replace(/-/g, '');
    return id.length >= 8 ? id.slice(0, 8) : id;
  }, []);

  const isApprovalHintText = useCallback((text: string): boolean => {
    if (!text) return false;
    const t = text.toLowerCase();
    return (
      (text.includes('需要批准') || text.includes('审批') || t.includes('approve')) &&
      t.includes('/approve') &&
      (t.includes('allow-once') || t.includes('allow-always'))
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
      cancelPendingFinalUiRelease(pSessionKey);
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

      cancelPendingFinalUiRelease(pSessionKey);
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
            // 主气泡只承载 transcript 正文；thinking/plan/toolCall/commandOutput 已分离到 _uiMetaOnly 气泡
            const isMain = (m: Message) => !m._uiMetaOnly;
            const idx = streamingAssistantIndexRef.current;
            let targetIdx = (idx !== null && idx >= 0 && idx < prev.length && isMain(prev[idx])) ? idx : -1;
            if (targetIdx === -1) {
              const runIdIdx = prev.findLastIndex(m => isMain(m) && m.runId === payload.runId);
              targetIdx = runIdIdx !== -1
                ? runIdIdx
                : prev.findLastIndex(m => isMain(m) && m.role === 'assistant' && !m.runId);
            }
            if (targetIdx === -1) return prev;

            const next = [...prev];
            const current = next[targetIdx];
            next[targetIdx] = {
              ...current,
              runId: payload.runId,
              content: fullText,
              metrics: { ...current.metrics, ttft, tps: currentTPS },
              _sortTs: current._sortTs,
            };
            streamingAssistantIndexRef.current = targetIdx;
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
      streamEndGraceRef.current = { key: pSessionKey, until: Date.now() + 3000 };
      if (pSessionKey === sessionKeyRef.current) clearStallTimer();

      // 用户已主动停止且 UI 已标记"已手动停止"，不再用服务端 final覆盖
      if (wasUserAbort) {
        cancelPendingFinalUiRelease(pSessionKey);
        markSessionTyping(pSessionKey, false);
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
            cancelPendingFinalUiRelease(pSessionKey);
            markSessionTyping(pSessionKey, false);
            setIsTyping(false);
            streamingAssistantIndexRef.current = null;
            fetchSessions(true);
            return;
          }
        }
        cache.fullText = incomingContent;

        if (pSessionKey === sessionKeyRef.current) {
          setMessages(prev => {
            // 主气泡只承载 transcript；metadata 由 _uiMetaOnly 气泡承载，不再在主气泡里做保留/合并
            const isMain = (m: Message) => !m._uiMetaOnly;
            const idx = streamingAssistantIndexRef.current;
            const mainMatches = (i: number) => i >= 0 && i < prev.length && isMain(prev[i]);
            let targetIndex = (idx !== null && mainMatches(idx)) ? idx : -1;
            if (targetIndex === -1) {
              const runIdIdx = prev.findLastIndex(m => isMain(m) && m.runId === payload.runId);
              targetIndex = runIdIdx !== -1
                ? runIdIdx
                : prev.findLastIndex(m => isMain(m) && m.role === 'assistant' && !m.runId);
            }
            if (targetIndex === -1) return prev;

            const last = prev[targetIndex];
            if (!incomingContent && last.content && last.content !== t('chat.thinking')) return prev;

            // 记录同 runId 的 meta 气泡 content 到缓存（供切会话/重新加载历史时兜底恢复）
            const runIdForCache = payload.runId || (last as any).runId;
            if (runIdForCache) {
              const metaMsg = prev.find(m => m._uiMetaOnly && m.runId === runIdForCache);
              if (metaMsg?.content) {
                rememberMetadataForRun(pSessionKey, runIdForCache, metaMsg.content);
              }
            }

            const next = [...prev];
            next[targetIndex] = {
              ...last,
              runId: payload.runId,
              content: incomingContent || last.content,
              metrics: { ...last.metrics, ttft, duration, tps: finalTPS },
              _sortTs: last._sortTs,
            };
            return next;
          });

          releaseTypingLock(pSessionKey);
        } else {
          releaseTypingLock(pSessionKey);
        }
      }
    } else if (payload.state === 'aborted') {
      lastStreamEventAtRef.current = Date.now();
      cancelPendingFinalUiRelease(pSessionKey);
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
            const isMain = (m: Message) => !m._uiMetaOnly;
            const idx = streamingAssistantIndexRef.current;
            let targetIndex = (idx !== null && idx >= 0 && idx < prev.length && isMain(prev[idx])) ? idx : -1;
            if (targetIndex === -1) targetIndex = prev.findLastIndex(m => isMain(m) && m.role === 'assistant');
            if (targetIndex === -1) return prev;
            const last = prev[targetIndex];
            const label = t('chat.manuallyStopped', { defaultValue: '已手动停止' });

            const hasBody = partialContent && partialContent !== t('chat.thinking') && partialContent !== t('chat.deepThinking', { defaultValue: '深度思考中...' });
            const content = hasBody ? `${partialContent} (${label})` : label;

            // 记录同 runId 的 meta 气泡 content 到缓存，供切换/重载恢复
            const runIdForCache = payload.runId || (last as any).runId;
            if (runIdForCache) {
              const metaMsg = prev.find(m => m._uiMetaOnly && m.runId === runIdForCache);
              if (metaMsg?.content) rememberMetadataForRun(pSessionKey, runIdForCache, metaMsg.content);
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
      cancelPendingFinalUiRelease(pSessionKey);
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
  }, [cancelPendingFinalUiRelease, clearStallTimer, fetchSessions, formatMessageContent, getOrCreateSessionCache, inputAreaRef, markSessionTyping, rememberMetadataForRun, resetStallTimer, scrollRef, showScrollBtnRef, t, touchAndPruneSessionCache, virtuosoRef]);

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

    // 重要：卡片内需带完整 approvalId（UUID），用户发送 `/approve <id> allow-once|allow-always` 时须与此一致；
    // 不能只用截断 slug，否则网关可能无法匹配待审批项。
    const approvalBlock = `\n\n> :::approval\n> **${slug}**\n> approvalId: ${approvalId}\n> \`\`\`bash\n> ${command}\n> \`\`\`\n> :::\n`;

    setMessages(prev => {
      const mainIdx = findLastMainAssistantIndex(prev);
      if (mainIdx !== -1) {
        const last = prev[mainIdx];
        if (last.content.includes(slug)) return prev;
        const newContent = (last.content === t('chat.thinking') || !last.content)
          ? approvalBlock
          : `${last.content}${approvalBlock}`;
        const next: Message[] = [...prev];
        next[mainIdx] = { ...last, content: newContent };
        // 纠正：旧逻辑曾把审批追加到列表末尾的 _uiMetaOnly 气泡，应从 meta 中剥掉同 slug 的审批块
        for (let i = 0; i < next.length; i++) {
          const m = next[i];
          if (!m._uiMetaOnly || m.role !== 'assistant') continue;
          const c = m.content || '';
          if (!c.includes(':::approval') || !c.includes(slug)) continue;
          const cleaned = stripApprovalBlockWithSlug(c, slug);
          if (cleaned !== c) next[i] = { ...m, content: cleaned };
        }
        return next;
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
      'allow-always': '✅ 已批准(永久)',
      'denied': '❌ 已拒绝',
      'rejected': '❌ 已拒绝',
      'timeout': '⏱️ 已超时',
    };
    const label = decisionLabels[decision] || (decision === 'approved' ? '✅ 已批准' : `⚠️ ${decision || '未知'}`);

    setMessages(prev => {
      let idx = prev.findLastIndex(
        m =>
          m.role === 'assistant' &&
          !m._uiMetaOnly &&
          m.content.includes(slug) &&
          m.content.includes(':::approval'),
      );
      if (idx === -1) {
        idx = prev.findLastIndex(
          m => m.role === 'assistant' && m.content.includes(slug) && m.content.includes(':::approval'),
        );
      }
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
   * 默认在「会话仍标记为流式生成」时暂缓，避免与 chat.delta 打架；
   * 但对「同一 runId 合并进已有主气泡」的推送必须放行（审批后续、工具结果常只走 transcript）。
   */
  const handleSessionMessage = useCallback((payload: any) => {
    if (!payload) return;
    const { sessionKey: evtKey, message: msg } = payload;
    if (!evtKey || evtKey !== sessionKeyRef.current) return;
    if (!msg || !msg.role) return;

    const bypassSessionMessageGuards = shouldBypassSessionMessageTypingGuard(messagesRef.current || [], msg);

    if (typingSessionsRef.current.has(evtKey) && !bypassSessionMessageGuards) {
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
    if (grace && grace.key === evtKey && Date.now() < grace.until && !bypassSessionMessageGuards) return;

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

    // 降噪：网关对 /approve 的确认回执（allow-once / allow-always 等）
    const isApprovalConfirm = /Approval\s+\S+\s+submitted\s+for\s+[a-f0-9-]+/i.test(content.trim());
    if (isApprovalConfirm) {
      content = `> :::toolResult\n> **approval**\n> ${content.trim()}\n> :::\n`;
    }

    // 降噪：用户发出的 "/approve <id> allow-once|allow-always"
    const isApproveCommand = /^\/approve\s+[a-f0-9-]+\s+(allow-once|allow-always)$/i.test(content.trim());
    if (isApproveCommand) {
      content = `> :::toolResult\n> **approval**\n> ${content.trim()}\n> :::\n`;
    }

    const msgId = msg.id || payload.messageId || `msg-sm-${Date.now()}`;

    setMessages(prev => {
      if (prev.some(m => m.id === msgId)) return prev;

      // 网关持久化会把一次 run 拆成多条 assistant 消息（toolCall 骨架 + 正文等）。
      // 本 UI 只用「主气泡(正文)」和「_uiMetaOnly 气泡(思考信息附录)」两条承载同一个 run：
      // 1) role=assistant 且内容看起来是"只有 metadata、没有正文"的骨架消息 -> 直接丢弃；UI 已在 meta 气泡里展示更完整内容。
      // 2) role=assistant 且 runId 匹配到主气泡 -> 合并 transcript 到主气泡，不新增气泡。
      if (msg.role === 'assistant') {
        const { metadata: incomingMeta, transcript: incomingTranscript } = partitionAssistantContent(content || '');
        const isSkeleton = !!incomingMeta && !incomingTranscript.trim();
        if (isSkeleton) return prev;

        if (msg.runId) {
          // 必须用 findLastIndex：与 handleChatDelta 的「按 runId 找最后一条主气泡」一致。
          // 若用 findIndex 命中上一条（含审批卡片的）气泡，而流式正文写在列表末尾的新气泡上，会出现两条完整输出。
          const existingIdx = prev.findLastIndex(
            m => m.role === 'assistant' && !m._uiMetaOnly && m.runId === msg.runId,
          );
          if (existingIdx !== -1) {
            const existing = prev[existingIdx];
            const thinkingPlaceholder = t('chat.thinking');
            const deepThinkingPlaceholder = t('chat.deepThinking', { defaultValue: '深度思考中...' });
            const isValidBody = (s: string) =>
              !!s && s !== thinkingPlaceholder && s !== deepThinkingPlaceholder;

            const bodyText = incomingTranscript || content;
            const bt = bodyText.trim();
            let mergedContent = existing.content;
            if (isValidBody(bodyText)) {
              const ex = existing.content.trim();
              if (!isValidBody(existing.content)) {
                mergedContent = bodyText;
              } else if (bt && (ex.includes(bt) || (bt.length >= 60 && bt.includes(ex)))) {
                // 流式已写入或 transcript 为子集/同文，避免整段替换把审批块冲掉或造成双份
                mergedContent = existing.content;
              } else if (!ex.includes(bt)) {
                mergedContent = bodyText;
              }
            }

            if (mergedContent === existing.content) return prev;
            const next = [...prev];
            next[existingIdx] = { ...existing, content: mergedContent };
            return next;
          }
        }

        // chat.delta 已把同一段正文写进「最后一条主气泡」后，session.message 又以新 id 追加一条时拦截（无 runId 或 runId 未对齐）
        const incomingBodyDedup = (incomingTranscript || content).trim();
        if (incomingBodyDedup.length > 80) {
          const lastMainIdx = findLastMainAssistantIndex(prev);
          if (lastMainIdx !== -1) {
            const { transcript: lastT } = partitionAssistantContent(prev[lastMainIdx].content || '');
            const lastBody = (lastT || prev[lastMainIdx].content || '').trim();
            if (lastBody.length > 80 && lastBody === incomingBodyDedup) return prev;
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

    const phase = (toolData.phase as string) || '';
    const toolName = toolData.toolName || toolData.name || toolData.tool || 'tool';
    const toolId = toolData.toolCallId || toolData.callId || toolData.id || `${toolName}-${Date.now()}`;
    const marker = `tool:${toolId}`;
    // 优先用 payload 自带 runId，其次用当前 streaming 主气泡的 runId 兜底
    const runId = (toolData.runId as string | undefined) || (payload.runId as string | undefined);

    // 尽可能从 payload 里提取"参数/命令"与"结果/输出"。不同后端实现字段名不一致，做宽泛匹配：
    const pickFirst = (obj: any, keys: string[]) => {
      for (const k of keys) {
        const v = obj?.[k];
        if (v !== undefined && v !== null && v !== '') return v;
      }
      return undefined;
    };
    const argsRaw = pickFirst(toolData, ['arguments', 'args', 'input', 'params', 'command', 'cmd', 'request']);
    const resultRaw = phase === 'end' || phase === 'error'
      ? pickFirst(toolData, ['result', 'output', 'stdout', 'response', 'data', 'error'])
      : undefined;

    const formatAsCode = (v: any, lang = 'json') => {
      if (v === undefined || v === null) return '';
      if (typeof v === 'string') {
        // 看起来是 json 字符串就当 json；否则按纯文本
        const trimmed = v.trim();
        const looksJson = (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
        return `\`\`\`${looksJson ? 'json' : ''}\n${v}\n\`\`\``;
      }
      try { return `\`\`\`${lang}\n${JSON.stringify(v, null, 2)}\n\`\`\``; } catch { return `\`\`\`\n${String(v)}\n\`\`\``; }
    };

    const buildToolBody = (currentStatus: 'running' | 'done' | 'failed') => {
      const statusLine =
        currentStatus === 'running' ? `> 🔧 \`${toolName}\` 执行中…<!-- ${marker} -->` :
        currentStatus === 'done' ? `> ✅ \`${toolName}\` 完成` :
        `> ❌ \`${toolName}\` 失败`;
      const parts: string[] = [statusLine];
      if (argsRaw !== undefined) {
        parts.push(`**参数:**\n${formatAsCode(argsRaw)}`);
      }
      if (resultRaw !== undefined) {
        parts.push(`**结果:**\n${formatAsCode(resultRaw, '')}`);
      }
      return parts.join('\n\n');
    };

    if (phase === 'start' || phase === '') {
      if (!showThinkingRef.current) return;
      setMessages(prev => {
        const mainMsg = prev.find(m => !m._uiMetaOnly && m.role === 'assistant' && m.runId === runId);
        const effectiveRunId = runId || mainMsg?.runId
          || prev.slice().reverse().find(m => !m._uiMetaOnly && m.role === 'assistant' && m.runId)?.runId;
        const body = buildToolBody('running');
        return updateMetaMessage(prev, effectiveRunId, (current) =>
          upsertAgentBlock(current, 'toolCall', toolId, toolName, body),
        );
      });
    } else if (phase === 'end' || phase === 'error') {
      const status: 'done' | 'failed' = phase === 'end' ? 'done' : 'failed';
      setMessages(prev => {
        const metaMatchIdx = prev.findIndex(m =>
          m._uiMetaOnly &&
          (runId ? m.runId === runId : true) &&
          m.content.includes(`toolCall:${toolId}`),
        );
        const effectiveRunId = runId
          || (metaMatchIdx !== -1 ? prev[metaMatchIdx].runId : undefined)
          || prev.slice().reverse().find(m => !m._uiMetaOnly && m.role === 'assistant' && m.runId)?.runId;
        const body = buildToolBody(status);
        return updateMetaMessage(prev, effectiveRunId, (current) =>
          upsertAgentBlock(current, 'toolCall', toolId, toolName, body),
        );
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
        if (effectiveKey) cancelPendingFinalUiRelease(effectiveKey);
        setIsTyping(false);
        clearStallTimer();
        streamingAssistantIndexRef.current = null;
      }

      if (stream === 'lifecycle.start' || (stream === 'lifecycle' && agentData?.phase === 'start')) {
        lastStreamEventAtRef.current = Date.now();
        if (effectiveKey) {
          cancelPendingFinalUiRelease(effectiveKey);
          markSessionTyping(effectiveKey, true);
        }
        if (effectiveKey === sessionKeyRef.current) {
          setIsTyping(true);
          resetStallTimer();
        }
      }

      if (stream === 'lifecycle.end' || (stream === 'lifecycle' && agentData?.phase === 'end')) {
        lastStreamEventAtRef.current = Date.now();
        if (effectiveKey) {
          if (effectiveKey === sessionKeyRef.current) {
            clearStallTimer();
          }
          // 统一使用 releaseTypingLock 延迟释放。
          // 不再检查 .has(effectiveKey)，以便后续到达的 lifecycle.end 能够“刷新”并延长释锁时间，防止提前释放。
          releaseTypingLock(effectiveKey);
        }
      }

      if (stream === 'lifecycle.error' || (stream === 'lifecycle' && agentData?.phase === 'error')) {
        lastStreamEventAtRef.current = Date.now();
        if (effectiveKey) {
          cancelPendingFinalUiRelease(effectiveKey);
          markSessionTyping(effectiveKey, false);
        }
        if (effectiveKey === sessionKeyRef.current) {
          clearStallTimer();
          setIsTyping(false);
          streamingAssistantIndexRef.current = null;

          // 扩大 error 字段兜底：很多后端把错因放在非标准字段，只看 .error.message / .message 会得到空串后落到"Agent error"硬编码
          const extractErrMsg = (d: any): string => {
            if (!d) return '';
            if (typeof d === 'string') return d;
            const candidates = [
              d?.error?.message,
              d?.error?.detail,
              d?.error?.reason,
              typeof d?.error === 'string' ? d.error : '',
              d?.message,
              d?.errorMessage,
              d?.reason,
              d?.detail,
              d?.stopReason,
              d?.errorKind,
              d?.code,
            ].filter(x => typeof x === 'string' && x.trim());
            if (candidates.length > 0) return candidates.join(' | ');
            // 最后兜底：把整个对象序列化并截断，避免只展示"Agent error"三字看不出根因
            try {
              const json = JSON.stringify(d);
              if (json && json !== '{}') return json.length > 500 ? json.slice(0, 500) + '…' : json;
            } catch {}
            return '';
          };
          const errMsg = extractErrMsg(agentData) || 'Agent error';

          setMessages(prev => {
            // 1) 找到最近一条主气泡（非 meta），追加 Agent 错误 banner
            const mainIdx = prev.findLastIndex(m => !m._uiMetaOnly && m.role === 'assistant');
            if (mainIdx === -1) return prev;
            const main = prev[mainIdx];

            const isPlaceholder =
              !main.content ||
              main.content === t('chat.thinking') ||
              main.content === t('chat.deepThinking', { defaultValue: '深度思考中...' });
            const mainNextContent = isPlaceholder
              ? `> **⚠️ Agent 错误**\n> ${errMsg}`
              : `${main.content}\n\n> **⚠️ Agent 错误**\n> ${errMsg}`;

            // 2) 同 runId 的 meta 气泡：把所有 "🔧 xxx 执行中…" 封印为 "❌ xxx 已中断"
            const sealPending = (raw: string) => {
              if (!raw) return raw;
              return raw
                .replace(
                  /(?<=(?:^|\n)\s*(?:>\s*)?)🔧\s*(`[^`]+`)\s*执行中(?:…|\.\.\.)/g,
                  '❌ $1 已中断',
                )
                .replace(/<!--\s*tool:[^>]*-->/g, '');
            };

            const next = prev.map((m, i) => {
              if (i === mainIdx) return { ...m, content: mainNextContent };
              if (m._uiMetaOnly && m.runId === main.runId) {
                const sealed = sealPending(m.content || '');
                if (sealed === m.content) return m;
                return { ...m, content: sealed };
              }
              return m;
            });
            return next;
          });
        }
      }

      // 处理实时流：thinking / plan / command_output / tool
      // 事件数据结构常见字段：{ itemId, phase: start|delta|end, title, toolCallId, name,
      //   output|content|text|delta|chunk|stdout|stderr|reasoning|thinking,
      //   arguments|args|input|params|command, result, status }
      // 同一个 itemId 在整个运行期间只对应一个折叠块（按 itemId 做 upsert / append）。
      if (
        stream === 'thinking' ||
        stream === 'plan' ||
        stream === 'command_output' ||
        stream === 'tool'
      ) {
        if (!effectiveKey || effectiveKey !== sessionKeyRef.current) return;

        // transcript 已 final 但 agent 侧仍在推 thinking/tool：撤掉 final 的延时解锁，并保持会话「生成中」
        cancelPendingFinalUiRelease(effectiveKey);
        markSessionTyping(effectiveKey, true);
        lastStreamEventAtRef.current = Date.now();
        resetStallTimer();
        setIsTyping(true);

        const pickFirst = (obj: any, keys: string[]) => {
          for (const k of keys) {
            const v = obj?.[k];
            if (v !== undefined && v !== null && v !== '') return v;
          }
          return undefined;
        };
        const toText = (v: any): string => {
          if (v === undefined || v === null) return '';
          if (typeof v === 'string') return v;
          try { return JSON.stringify(v, null, 2); } catch { return String(v); }
        };
        const formatAsCode = (v: any, lang = 'json'): string => {
          if (v === undefined || v === null) return '';
          if (typeof v === 'string') {
            const trimmed = v.trim();
            const looksJson = (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
            return `\`\`\`${looksJson ? 'json' : ''}\n${v}\n\`\`\``;
          }
          try { return `\`\`\`${lang}\n${JSON.stringify(v, null, 2)}\n\`\`\``; } catch { return `\`\`\`\n${String(v)}\n\`\`\``; }
        };

        let itemId = '';
        let title = '';
        let body = '';
        let deltaOnly = false;
        const phase = (agentData?.phase as string) || '';

        if (typeof agentData === 'string') {
          body = agentData;
        } else if (agentData && typeof agentData === 'object') {
          itemId = agentData.itemId || agentData.toolCallId || agentData.callId || agentData.id || '';
          title = agentData.title || agentData.name || agentData.tool || '';

          if (stream === 'tool') {
            // tool 流：尽可能同时展示"参数"和"结果"
            const argsRaw = pickFirst(agentData, ['arguments', 'args', 'input', 'params', 'command', 'cmd', 'request']);
            const resultRaw = pickFirst(agentData, ['result', 'output', 'stdout', 'response', 'data']);
            const errorRaw = pickFirst(agentData, ['error', 'stderr']);
            const status = (agentData.status as string) || (phase === 'end' ? 'done' : phase === 'error' ? 'failed' : 'running');
            const statusLine =
              status === 'done' ? `> ✅ \`${title || 'tool'}\` 完成` :
              status === 'failed' ? `> ❌ \`${title || 'tool'}\` 失败` :
              `> 🔧 \`${title || 'tool'}\` 执行中…<!-- tool:${itemId} -->`;
            const parts: string[] = [statusLine];
            if (argsRaw !== undefined) parts.push(`**参数:**\n${formatAsCode(argsRaw)}`);
            if (resultRaw !== undefined) parts.push(`**结果:**\n${formatAsCode(resultRaw, '')}`);
            if (errorRaw !== undefined) parts.push(`**错误:**\n${formatAsCode(errorRaw, '')}`);
            body = parts.join('\n\n');
          } else if (stream === 'command_output') {
            // 优先取全量字段；只有增量字段时标记 deltaOnly 走 append 路径
            const full = pickFirst(agentData, ['output', 'stdout', 'content', 'text', 'result']);
            const err = pickFirst(agentData, ['stderr', 'error']);
            const delta = pickFirst(agentData, ['delta', 'chunk']);
            const cmd = pickFirst(agentData, ['command', 'cmd']);

            if (full !== undefined || err !== undefined) {
              // 全量：title 带命令摘要，body 是完整输出
              const parts: string[] = [];
              if (cmd) parts.push(`**command ${toText(cmd)}**`);
              if (full !== undefined) parts.push(`\`\`\`\n${toText(full)}\n\`\`\``);
              if (err !== undefined) parts.push(`**stderr:**\n\`\`\`\n${toText(err)}\n\`\`\``);
              body = parts.join('\n\n');
              if (!title && cmd) title = `command ${toText(cmd).slice(0, 80)}`;
            } else if (delta !== undefined) {
              deltaOnly = true;
              body = toText(delta);
            } else if (cmd) {
              // start 阶段只有 command，body 暂时给个提示
              body = `**command ${toText(cmd)}**\n\n_执行中…_`;
              if (!title) title = `command ${toText(cmd).slice(0, 80)}`;
            }
          } else {
            // thinking / plan：主体为累积的文本
            const full = pickFirst(agentData, ['content', 'text', 'reasoning', 'thinking', 'plan', 'output']);
            const delta = pickFirst(agentData, ['delta', 'chunk']);
            if (full !== undefined) body = toText(full);
            else if (delta !== undefined) { deltaOnly = true; body = toText(delta); }
          }

          // 兜底：已知字段都没命中，但 payload 里确实携带数据，
          // 把未识别字段全量 JSON 化，避免 UI 上只看到"执行中…"空壳而不知道为什么。
          if (!body) {
            const knownKeys = new Set([
              'itemId', 'toolCallId', 'callId', 'id', 'title', 'name', 'tool',
              'phase', 'status', 'seq', 'ts', 'runId', 'sessionKey',
              // 上面各分支已识别的业务字段（不需要再回显）
              'arguments', 'args', 'input', 'params', 'command', 'cmd', 'request',
              'result', 'output', 'stdout', 'stderr', 'response', 'data',
              'delta', 'chunk', 'content', 'text', 'reasoning', 'thinking', 'plan',
              'error',
            ]);
            const rest: Record<string, any> = {};
            for (const k of Object.keys(agentData || {})) {
              if (!knownKeys.has(k)) rest[k] = agentData[k];
            }
            if (Object.keys(rest).length > 0) {
              body = `_（未识别的事件字段，已原样展示以便排查）_\n\n\`\`\`json\n${JSON.stringify(rest, null, 2)}\n\`\`\``;
            }
          }
        }

        if (!body && !title) {
          // 已在上方锁定 UI；无 meta 可写则跳过 setMessages（避免空事件误刷列表）
          return;
        }

        const segmentName =
          stream === 'command_output' ? 'commandOutput' :
          stream === 'tool' ? 'toolCall' :
          stream; // thinking | plan

        setMessages(prev => {
          const idx = streamingAssistantIndexRef.current;
          const mainMsg = (idx !== null && idx >= 0 && idx < prev.length) ? prev[idx] : undefined;
          const runId = (agentData?.runId as string | undefined)
            || (data.payload?.runId as string | undefined)
            || mainMsg?.runId
            || prev.slice().reverse().find(m => !m._uiMetaOnly && m.role === 'assistant' && m.runId)?.runId;

          return updateMetaMessage(prev, runId, (current) =>
            deltaOnly
              ? appendToAgentBlock(current, segmentName, itemId, body, title)
              : upsertAgentBlock(current, segmentName, itemId, title, body),
          );
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
  }, [cancelPendingFinalUiRelease, clearStallTimer, handleApprovalRequested, handleApprovalResolved, handleChatDelta, handleSessionMessage, handleSessionTool, markSessionTyping, resetStallTimer, t]);

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

      // 3) "Approval … submitted for <id>." —— 网关确认回执
      if (/Approval\s+\S+\s+submitted\s+for\s+[a-f0-9-]+/i.test(content.trim())) {
        content = `> :::toolResult\n> **approval**\n> ${content.trim()}\n> :::\n`;
        roleOverride = 'assistant';
      }

      // 4) "/approve <id> allow-once|allow-always" —— 用户指令消息
      if (/^\/approve\s+[a-f0-9-]+\s+(allow-once|allow-always)$/i.test(content.trim())) {
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
    // 新架构下 metadata 不再贴到主消息 content，而是以独立的 _uiMetaOnly 气泡插入到对应主消息后面。
    // 注意：同一 runId 可能有多条 assistant 消息（思考/工具/正文被拆），meta 气泡只插在最后一条后面，避免重复。
    if (cache?.metadataByRunId && cache.metadataByRunId.size > 0) {
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
        // 已存在同 runId 的 meta 气泡则跳过
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

    // resetTypingState 只清当前页 isTyping，不会从 typingSessionsRef 摘掉「已切走」的会话。
    // 若网关已发 final 导致 cache.isTyping=false，仅靠 cache 无法 shouldKeepTyping；但 ref 仍可能
    // 表示该会话在生成（延时释锁尚未执行），切回时应恢复输入锁与 stall 计时。
    if (!shouldKeepTyping && typingSessionsRef.current.has(key)) {
      shouldKeepTyping = true;
    }

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
    if (sessionComposeBlocked) return;
    if ((!text && (!attachedFiles || attachedFiles.length === 0)) || status !== 'authenticated') return;

    cancelPendingFinalUiRelease();
    abortRequestedRef.current = null;
    setIsTyping(true);
    setTpsData([]);
    chatEventSeenSinceSendRef.current = false;
    hadTypingSinceSendRef.current = true;

    let currentKey = sessionKeyRef.current ?? sessionKey;
    if (!currentKey) {
      const agentId = selectedBot.replace('openclaw:', '');
      const key = buildBuddyDirectSessionKey(agentId);
      // 不传 label，保持空标题，便于后续「无标题时自动总结」逻辑触发
      const res = await sendRPC('sessions.create', { agentId, key });
      if (res.ok) {
        currentKey = res.payload.key;
        setSessionKey(currentKey);
        // 兼容：部分网关版本只认 key 字段
        sendRPC('sessions.messages.subscribe', { key: currentKey, sessionKey: currentKey }).catch(() => {});
        // 不在此处 await patch：否则会拖住首条消息的 setMessages，会话区体感「卡住」。
        void sendRPC('sessions.patch', { key: currentKey, thinkingLevel, model: sessionModel }).catch(() => {});
        // 静默刷新列表，避免 setLoadingSessions(true) + 300ms 最短 loading 与首屏消息抢同一帧
        queueMicrotask(() => {
          fetchSessions(true);
        });
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
      cancelPendingFinalUiRelease();
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
      cancelPendingFinalUiRelease();
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
  }, [cancelPendingFinalUiRelease, clearStallTimer, fetchSessions, inputAreaRef, isTyping, markSessionTyping, resetStallTimer, scrollRef, selectedBot, sendRPC, sessionComposeBlocked, sessionKey, sessionModel, setSessionKey, status, t, thinkingLevel, touchAndPruneSessionCache, virtuosoRef]);

  /**
   * 重试/再生成：复用既有的 User 消息，不额外创建新的 User 消息。
   */
  const resendFromExistingUserMessage = useCallback(async (userMsg: Message) => {
    if (!sessionKey) return;
    if (status !== 'authenticated') return;
    if (isTyping) return;
    if (sessionComposeBlocked) return;

    cancelPendingFinalUiRelease();
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
      cancelPendingFinalUiRelease();
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
  }, [cancelPendingFinalUiRelease, clearStallTimer, isTyping, markSessionTyping, resetStallTimer, sendRPC, sessionComposeBlocked, sessionKey, status, t, touchAndPruneSessionCache, virtuosoRef]);

  /**
   * 停止生成：更新 UI 并通过 chat.abort 中止 Agent 运行，不污染对话历史。
   */
  const handleStopGeneration = useCallback(async () => {
    if (!sessionKey) return;
    if (status !== 'authenticated') return;

    cancelPendingFinalUiRelease();
    abortRequestedRef.current = { key: sessionKey, ts: Date.now() };
    setIsTyping(false);
    clearStallTimer();
    streamingAssistantIndexRef.current = null;
    markSessionTyping(sessionKey, false);
    streamEndGraceRef.current = { key: sessionKey, until: Date.now() + 3000 };

    setMessages(prev => {
      // 1) 找最近主气泡（跳过 meta 附录），追加「(已手动停止)」标签
      const mainIdx = prev.findLastIndex(m => !m._uiMetaOnly && m.role === 'assistant');
      if (mainIdx === -1) return prev;
      const main = prev[mainIdx];
      const label = t('chat.manuallyStopped', { defaultValue: '已手动停止' });
      const mainContent = (main.content === t('chat.thinking') || !main.content) ? label : main.content + ` (${label})`;

      // 2) 同 runId 的 meta 气泡：把所有"执行中"封印为"已中断"
      const sealPending = (raw: string) => raw
        ? raw
            .replace(/(?<=(?:^|\n)\s*(?:>\s*)?)🔧\s*(`[^`]+`)\s*执行中(?:…|\.\.\.)/g, '❌ $1 已中断')
            .replace(/<!--\s*tool:[^>]*-->/g, '')
        : raw;

      return prev.map((m, i) => {
        if (i === mainIdx) return { ...m, content: mainContent };
        if (m._uiMetaOnly && m.runId === main.runId) {
          const sealed = sealPending(m.content || '');
          if (sealed === m.content) return m;
          return { ...m, content: sealed };
        }
        return m;
      });
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
  }, [cancelPendingFinalUiRelease, clearStallTimer, markSessionTyping, sendRPC, sessionKey, status, t]);

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
    if (sessionComposeBlocked) return;
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
  }, [clearStallTimer, handleSend, isTyping, markSessionTyping, resetStallTimer, sendRPC, sessionComposeBlocked, status, t, touchAndPruneSessionCache]);

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
      getMessagesCount: () => messagesCountRef.current,
      resetTypingState,
    };
  }, [handleApprovalRequested, handleChatDelta, handleGatewayEvent, handleInjectMessage, handleRegenerate, handleSaveEdit, handleSend, handleStopGeneration, hasNewMessages, isLoadingHistory, isStalled, isTyping, messages, resetTypingState, setMessages, tpsData, typingSessionKeys, showScrollBtnRef]);
}

