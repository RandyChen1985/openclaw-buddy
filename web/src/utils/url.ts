import storage from './storage';

// Get base URL dynamically at runtime if available
export const getBaseURL = () => {
  // Try to read from global variable injected by Go backend
  let base = (window as any).__WEB_ROOT__ || import.meta.env.BASE_URL || '/';
  
  // Ensure base starts with /
  if (!base.startsWith('/')) base = '/' + base;
  // Remove trailing slash for consistent joining
  if (base.length > 1 && base.endsWith('/')) base = base.slice(0, -1);
  
  return base === '/' ? '' : base;
};

// Get WebSocket URL with correct base path
export const getWsUrl = (path: string) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const base = getBaseURL(); // Returns "" or "/prefix"
  
  // path should start with /
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  
  // 添加认证 Token
  const token = storage.getItem('guardian_token');
  let authUrl = '';
  if (import.meta.env.DEV && !(window as any).__WEB_ROOT__) {
    authUrl = `ws://localhost:3000${base}${normalizedPath}`;
  } else {
    authUrl = `${protocol}//${host}${base}${normalizedPath}`;
  }

  // 拼接 Token 参数（Tag 不参与鉴权，故移除）
  if (token) {
    const separator = authUrl.includes('?') ? '&' : '?';
    authUrl += `${separator}token=${encodeURIComponent(token)}`;
  }

  return authUrl;
};
