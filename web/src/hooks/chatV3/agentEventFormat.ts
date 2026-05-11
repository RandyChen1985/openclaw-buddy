import { formatAsCode, pickFirst, toText } from './toolFormat';

export type AgentMetadataEvent = {
  itemId: string;
  title: string;
  body: string;
  deltaOnly: boolean;
  segmentName: string;
};

export function isAgentMetadataStream(stream: string): boolean {
  return stream === 'thinking' ||
    stream === 'plan' ||
    stream === 'command_output' ||
    stream === 'tool';
}

export function extractAgentErrorMessage(d: any): string {
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
  try {
    const json = JSON.stringify(d);
    if (json && json !== '{}') return json.length > 500 ? json.slice(0, 500) + '…' : json;
  } catch {}
  return '';
}

export function sealPendingToolMarkers(raw: string): string {
  if (!raw) return raw;
  return raw
    .replace(
      /(?<=(?:^|\n)\s*(?:>\s*)?)🔧\s*(`[^`]+`)\s*执行中(?:…|\.\.\.)/g,
      '❌ $1 已中断',
    )
    .replace(/<!--\s*tool:[^>]*-->/g, '');
}

export function formatAgentMetadataEvent(stream: string, agentData: any): AgentMetadataEvent {
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
      const status = (agentData.status as string) || (phase === 'end' ? 'done' : phase === 'error' ? 'failed' : 'running');
      const statusLine =
        status === 'done' ? `> ✅ \`${title || 'tool'}\` 完成` :
        status === 'failed' ? `> ❌ \`${title || 'tool'}\` 失败` :
        `> 🔧 \`${title || 'tool'}\` 执行中…<!-- tool:${itemId} -->`;
      const parts: string[] = [statusLine];
      const argsRaw = pickFirst(agentData, ['arguments', 'args', 'input', 'params', 'command', 'cmd', 'request']);
      const resultRaw = pickFirst(agentData, ['result', 'output', 'stdout', 'response', 'data']);
      const errorRaw = pickFirst(agentData, ['error', 'stderr']);
      if (argsRaw !== undefined) parts.push(`**参数:**\n${formatAsCode(argsRaw)}`);
      if (resultRaw !== undefined) parts.push(`**结果:**\n${formatAsCode(resultRaw, '')}`);
      if (errorRaw !== undefined) parts.push(`**错误:**\n${formatAsCode(errorRaw, '')}`);
      body = parts.join('\n\n');
    } else if (stream === 'command_output') {
      const full = pickFirst(agentData, ['output', 'stdout', 'content', 'text', 'result']);
      const err = pickFirst(agentData, ['stderr', 'error']);
      const delta = pickFirst(agentData, ['delta', 'chunk']);
      const cmd = pickFirst(agentData, ['command', 'cmd']);

      if (full !== undefined || err !== undefined) {
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
        body = `**command ${toText(cmd)}**\n\n_执行中…_`;
        if (!title) title = `command ${toText(cmd).slice(0, 80)}`;
      }
    } else {
      const full = pickFirst(agentData, ['content', 'text', 'reasoning', 'thinking', 'plan', 'output']);
      const delta = pickFirst(agentData, ['delta', 'chunk']);
      if (full !== undefined) body = toText(full);
      else if (delta !== undefined) {
        deltaOnly = true;
        body = toText(delta);
      }
    }

    if (!body) {
      const knownKeys = new Set([
        'itemId', 'toolCallId', 'callId', 'id', 'title', 'name', 'tool',
        'phase', 'status', 'seq', 'ts', 'runId', 'sessionKey',
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

  const segmentName =
    stream === 'command_output' ? 'commandOutput' :
    stream === 'tool' ? 'toolCall' :
    stream;

  return { itemId, title, body, deltaOnly, segmentName };
}
