/**
 * 比较两个版本号字符串 (Semantic Versioning 简化版)
 * @param v1 第一个版本号 (如 1.0.2)
 * @param v2 第二个版本号 (如 1.0.3)
 * @returns 如果 v1 > v2 返回 1, 如果 v1 < v2 返回 -1, 如果相等返回 0
 */
export function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number);
  const parts2 = v2.split('.').map(Number);
  
  const maxLength = Math.max(parts1.length, parts2.length);
  
  for (let i = 0; i < maxLength; i++) {
    const p1 = parts1[i] || 0;
    const p2 = parts2[i] || 0;
    
    if (p1 > p2) return 1;
    if (p1 < p2) return -1;
  }
  
  return 0;
}

/**
 * 检查是否有新版本可用
 * @param current 当前本地版本
 * @param latest 远程最新版本
 * @returns 是否有更新
 */
export function hasNewVersion(current: string, latest: string): boolean {
  return compareVersions(latest, current) === 1;
}
