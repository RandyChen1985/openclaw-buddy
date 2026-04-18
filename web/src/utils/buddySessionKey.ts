/**
 * 管理后台（Buddy）直连会话：由前端生成稳定可识别的 session key，便于检索与对账。
 * 格式：agent:{agentId}:buddy:direct:{时间戳}{随机段}
 */
const BUDDY_DIRECT_RE = /^agent:[^:]+:buddy:direct:.+/;

export function isBuddyDirectSessionKey(key: string | null | undefined): boolean {
  return !!key && BUDDY_DIRECT_RE.test(key);
}

export function buildBuddyDirectSessionKey(agentId: string): string {
  const suffix = `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  return `agent:${agentId}:buddy:direct:${suffix}`;
}
