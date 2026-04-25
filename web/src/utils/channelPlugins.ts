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
 * 渠道卡片用：仅区分 未安装 / 已禁用(已装) / 已启用。
 * 不再判断插件运行时的具体 Error 状态。
 */
export function channelPluginUiState(p: PluginLike | undefined): ChannelPluginUiState {
  if (!p || !p.id) return 'missing';
  // 只要是 enabled 或者 status 为 loaded，均视为「已启用/已加载」
  if (p.enabled || p.status === 'loaded') return 'loaded';
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

/** 在插件列表中寻找与特定渠道匹配的插件（考虑别名，且优先选择可用状态的插件） */
export function findPluginForChannel(plugins: PluginLike[], channelId: string): PluginLike | undefined {
  const aliases = getPluginIdAliases(channelId);
  const matches = plugins.filter(p => p.id && aliases.includes(p.id));
  if (matches.length === 0) return undefined;
  
  // 优先级：优先返回「已启用/已加载」的插件，避免被同名的禁用插件（如内置 feishu）覆盖
  return matches.find(p => isPluginOperational(p)) || matches[0];
}
