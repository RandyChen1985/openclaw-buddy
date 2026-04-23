/**
 * 与插件管理页 PluginManagement 中「已加载 / 已禁用 / 异常」判定一致，
 * 供渠道绑定等页面复用，避免各写一套规则。
 */
export type ChannelPluginUiState = 'loaded' | 'disabled' | 'error' | 'missing' | 'unknown';

export type PluginLike = {
  id?: string;
  status?: string;
  enabled?: boolean;
  error?: string;
};

/**
 * OpenClaw 在 plugins list --json 里会把「为何未激活」写在 error 里（如 bundled 默认关闭），
 * 这与 CLI 表格里看到的 disabled/loaded 不是一回事；此类文案不应标成「加载失败」。
 */
export function isBenignPluginNotice(err?: string): boolean {
  const s = (err || '').trim().toLowerCase();
  if (!s) return true;
  if (s.includes('disabled by default')) return true;
  if (s.includes('disabled in config')) return true;
  if (s.startsWith('bundled') && s.includes('disabled')) return true;
  if (s.includes('not activated') && s.includes('disabled')) return true;
  if (s.includes('stock extension') || s.includes('built-in')) return true;
  if (s.includes('optional') || s.includes('provider plugin')) return true;
  return false;
}

/** 真正的异常：status 为 error，或 error 字段为实质性错误信息 */
export function hasSignificantPluginError(p: PluginLike): boolean {
  if (p.status === 'error') return true;
  const err = (p.error || '').trim();
  return !!err && !isBenignPluginNotice(err);
}

/** 与插件列表「已加载」筛选一致：无实质性错误时，status=loaded 或已启用视为可用态 */
export function isPluginOperational(p: PluginLike): boolean {
  if (hasSignificantPluginError(p)) return false;
  return p.status === 'loaded' || !!p.enabled;
}

/**
 * 渠道卡片用：区分未安装 / 未启用(已装) / 异常 / 可用。
 * 判定顺序与 PluginManagement 的 getStatusTag 一致。
 */
export function channelPluginUiState(p: PluginLike | undefined): ChannelPluginUiState {
  if (!p || !p.id) return 'missing';
  if (hasSignificantPluginError(p)) return 'error';
  if (isPluginOperational(p)) return 'loaded';
  if (p.status === 'disabled' || !p.enabled) return 'disabled';
  return 'disabled';
}

/** 获取指定渠道可能对应的插件 ID 别名 */
export function getPluginIdAliases(channelId: string): string[] {
  const aliases = [channelId];
  if (channelId === 'feishu') {
    aliases.push('lark', 'openclaw-lark', '@openclaw/feishu', '@larksuite/openclaw-lark');
  } else {
    aliases.push(`@openclaw/${channelId}`);
  }
  return aliases;
}

/** 在插件列表中寻找与特定渠道匹配的插件（考虑别名） */
export function findPluginForChannel(plugins: PluginLike[], channelId: string): PluginLike | undefined {
  const aliases = getPluginIdAliases(channelId);
  return plugins.find(p => p.id && aliases.includes(p.id));
}
