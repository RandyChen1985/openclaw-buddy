import { getBaseURL } from './url';

/** 嵌入页布局：双 Tab 切换 / 仅 V3 / 仅经典 */
export type ChatEmbedLayout = 'tabs' | 'v3' | 'classic';

/**
 * 构建「对话实验室」嵌入地址（page=chat&embed=true…）。
 *
 * - layout=tabs：带 V3/经典 顶部 Tab，可用 defaultTab 指定默认选中。
 * - layout=v3 | classic：只渲染单一模式，无顶部切换条（适合 iframe 更窄场景）。
 */
export function buildChatEmbedPageUrl(opts: {
  token: string | null | undefined;
  botId: string;
  layout: ChatEmbedLayout;
  /** 仅 layout === 'tabs' 时生效，默认 v3 */
  defaultTab?: 'v3' | 'classic';
}): string {
  const base = getBaseURL();
  const params = new URLSearchParams();
  params.set('page', 'chat');
  if (opts.token) params.set('token', opts.token);
  params.set('bot', opts.botId);
  params.set('embed', 'true');
  if (opts.layout === 'v3') {
    params.set('embedLayout', 'v3');
  } else if (opts.layout === 'classic') {
    params.set('embedLayout', 'classic');
  } else {
    params.set('chatTab', opts.defaultTab === 'classic' ? 'classic' : 'v3');
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return `${origin}${base}/?${params.toString()}`;
}
