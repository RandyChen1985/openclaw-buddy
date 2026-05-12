import type { Message } from '../useChatV3WebSocket';

export function isSessionRunningStatus(status?: string): boolean {
  const s = (status || '').toLowerCase();
  return s === 'running' || s === 'started' || s === 'pending' || s === 'queued';
}

export function isSessionTerminalStatus(status?: string): boolean {
  const s = (status || '').toLowerCase();
  return s === 'done' || s === 'error' || s === 'failed' || s === 'aborted' || s === 'cancelled' || s === 'canceled';
}

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
export function upsertAgentBlock(
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
export function appendToAgentBlock(
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

export const META_MESSAGE_ID_PREFIX = 'meta-';

/**
 * 在消息列表里找/新建某个 run 的 "思考信息附录气泡"（_uiMetaOnly = true），
 * 并用 updateFn 更新它的 content。meta 气泡独立于正文气泡存在，
 * - 跟在同 runId 的正文气泡后面显示；
 * - 不参与 session.message 的合并/去重（它是纯 UI、无持久化 id 的）；
 * - showThinking 关闭时整体在渲染层过滤掉。
 *
 * 若新建时 updateFn 返回空串，直接返回原列表（避免建出空气泡）。
 */
export function updateMetaMessage(
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
export function findLastMainAssistantIndex(prev: Message[]): number {
  for (let i = prev.length - 1; i >= 0; i--) {
    const m = prev[i];
    if (m.role === 'assistant' && !m._uiMetaOnly) return i;
  }
  return -1;
}

/** 从内容中移除与 slug 对应的一条 :::approval 块（用于纠正误写入 meta 气泡的历史数据） */
export function stripApprovalBlockWithSlug(content: string, slug: string): string {
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
export function shouldBypassSessionMessageTypingGuard(rows: Message[], msg: { role?: string; runId?: string }): boolean {
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
export function partitionAssistantContent(content: string): { metadata: string, transcript: string } {
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

export function mergeTrailingThinkingIntoPreviousAssistant(prev: Message[], incoming: Message): Message[] | null {
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

export function compactAssistantThinkingAfterToolInPlace(rows: Message[]): void {
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
export function isAssistantUiThinkingPlaceholder(content: string, thinkingLabel: string, deepLabel: string): boolean {
  const x = (content || '').trim();
  if (x === thinkingLabel.trim() || x === deepLabel.trim() || x === '思考中...') return true;
  // 英文/轻微变体：短句 + Lobster + thinking
  if (/^Lobster\s+/i.test(x) && x.length < 140 && /thinking|思考/i.test(x)) return true;
  return false;
}

export function assistantMessageLooksSubstantial(content: string, thinkingLabel: string, deepLabel: string): boolean {
  const x = (content || '').trim();
  if (x.length < 32) return false;
  return !isAssistantUiThinkingPlaceholder(x, thinkingLabel, deepLabel);
}

export function stripTrailingUiThinkingPlaceholderAfterAssistantReply(rows: Message[], thinkingLabel: string, deepLabel: string): void {
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
