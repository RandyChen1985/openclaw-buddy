/**
 * 管理后台（Buddy）直连会话：由前端生成稳定可识别的 session key，便于检索与对账。
 * 格式（兼容两种）：
 * - 旧：agent:{agentId}:buddy:direct:{时间戳}{随机段}
 * - 新：agent:{agentId}:buddy:direct:{username}:{时间戳}{随机段}
 */
const BUDDY_DIRECT_RE = /^agent:[^:]+:buddy:direct:(?:[^:]+:)?[^:]+$/;

function normalizeUsername(username?: string | null): string {
  const raw = (username || '').trim();
  if (!raw) return '';
  // session key 使用 ":" 分隔，用户名段必须不包含 ":"，避免解析歧义
  const safe = raw
    .replace(/:/g, '_')
    .replace(/\s+/g, '')
    // 仅保留常见安全字符（过于严格会丢信息，这里以可读可检索为主）
    .replace(/[^a-zA-Z0-9._-]/g, '');
  return safe.slice(0, 48); // 限长，避免 key 过长影响 UI
}

export function isBuddyDirectSessionKey(key: string | null | undefined): boolean {
  return !!key && BUDDY_DIRECT_RE.test(key);
}

export function buildBuddyDirectSessionKey(agentId: string, username?: string | null): string {
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  const u = normalizeUsername(username);
  return u
    ? `agent:${agentId}:buddy:direct:${u}:${suffix}`
    : `agent:${agentId}:buddy:direct:${suffix}`;
}
