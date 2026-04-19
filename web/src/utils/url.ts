import storage from './storage';

// Get base URL dynamically at runtime if available
export const getBaseURL = () => {
  // 1. 如果在 Windows 客户端 (Wails) 环境下，由于 Origin 是 wails:// 或类似的，
  // 我们必须显式指向本地 Gin 服务器的地址，否则相对路径会发往 wails:// 导致 404。
  const isWails = window.location.protocol.includes('wails') || window.location.hostname === 'wails.localhost';
  if (isWails && !import.meta.env.DEV) {
    // 生产环境下，Wails 客户端强制指向本地 Gin 端口
    // 同时必须考虑后端可能配置了 WebRoot
    const webRoot = (window as any).__WEB_ROOT__ || '/';
    const normalizedRoot = (webRoot === '/' || !webRoot) ? '' : (webRoot.startsWith('/') ? webRoot : '/' + webRoot);
    return `http://localhost:3000${normalizedRoot}`;
  }


  // 2. 尝试从 Go 后端注入的全局变量读取 (适配子路径部署)
  let base = (window as any).__WEB_ROOT__ || import.meta.env.BASE_URL || '/';
  
  // Ensure base starts with /
  if (!base.startsWith('/')) base = '/' + base;
  // Remove trailing slash for consistent joining
  if (base.length > 1 && base.endsWith('/')) base = base.slice(0, -1);
  
  return base === '/' ? '' : base;
};

// Get WebSocket URL with correct base path
export const getWsUrl = (path: string) => {
  const isWails = window.location.protocol.includes('wails') || window.location.hostname === 'wails.localhost';
  const base = getBaseURL(); // 在 Wails 下会返回 http://localhost:3000
  
  // path should start with /
  const normalizedPath = path.startsWith('/') ? path : '/' + path;
  const token = storage.getItem('guardian_token');

  let authUrl = '';
  if (isWails && !import.meta.env.DEV) {
    // Wails 生产环境：直接构造指向 localhost:3000 的 ws 地址
    authUrl = `ws://localhost:3000${normalizedPath}`;
  } else if (import.meta.env.DEV && !(window as any).__WEB_ROOT__) {
    authUrl = `ws://localhost:3000${base}${normalizedPath}`;
  } else {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    authUrl = `${protocol}//${host}${base}${normalizedPath}`;
  }

  // 拼接 Token 参数
  if (token) {
    const separator = authUrl.includes('?') ? '&' : '?';
    authUrl += `${separator}token=${encodeURIComponent(token)}`;
  }

  return authUrl;
};

