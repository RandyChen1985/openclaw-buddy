import storage from './storage';

// Get base URL dynamically at runtime if available
export const getBaseURL = () => {
  // Try to read from global variable injected by Go backend
  let base = (window as any).__WEB_ROOT__;
  if (base == null || base === '') {
    base = import.meta.env.BASE_URL || '/';
  }
  // 相对 base 构建（import.meta.env.BASE_URL 为 ./）时不要当成路径前缀
  if (base === './' || base === '.') {
    base = '/';
  }

  // Ensure base starts with /
  if (!base.startsWith('/')) base = '/' + base;
  // Remove trailing slash for consistent joining
  if (base.length > 1 && base.endsWith('/')) base = base.slice(0, -1);
  
  return base === '/' ? '' : base;
};

/**
 * 与 HTTP API 一致：若配置了 VITE_API_URL，则 WebSocket 也连到该主机端口
 *（避免 dev 时误连 ws://localhost:3000 而实际后端在 VITE_API_URL 上，导致日志/终端长连挂起）
 */
function getWsOrigin(): string {
  const raw = import.meta.env.VITE_API_URL?.trim();
  if (raw) {
    try {
      const u = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
      const wsProto = u.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${wsProto}//${u.host}`;
    } catch {
      /* fall through */
    }
  }
  const protocol = typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = typeof window !== 'undefined' ? window.location.host : 'localhost';
  return `${protocol}//${host}`;
}

// Get WebSocket URL with correct base path
export const getWsUrl = (path: string) => {
  const base = getBaseURL(); // Returns "" or "/prefix"
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  const token = storage.getItem('guardian_token');

  let authUrl = `${getWsOrigin()}${base}${normalizedPath}`;

  // 若 path 已带 token / ticket 参数，则不再重复拼接
  if (token && !/[?&]token=/.test(authUrl) && !/[?&]ticket=/.test(authUrl)) {
    const separator = authUrl.includes('?') ? '&' : '?';
    authUrl += `${separator}token=${encodeURIComponent(token)}`;
  }

  return authUrl;
};
