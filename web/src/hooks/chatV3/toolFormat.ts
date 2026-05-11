export function pickFirst(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

export function toText(v: any): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v, null, 2); } catch { return String(v); }
}

export function formatAsCode(v: any, lang = 'json'): string {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') {
    const trimmed = v.trim();
    const looksJson = (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'));
    return `\`\`\`${looksJson ? 'json' : ''}\n${v}\n\`\`\``;
  }
  try { return `\`\`\`${lang}\n${JSON.stringify(v, null, 2)}\n\`\`\``; } catch { return `\`\`\`\n${String(v)}\n\`\`\``; }
}

export function buildSessionToolBody(
  toolName: string,
  marker: string,
  currentStatus: 'running' | 'done' | 'failed',
  argsRaw: any,
  resultRaw: any,
): string {
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
}
