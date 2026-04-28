import axios from 'axios';
import { getBaseURL } from '../utils/url';

import storage from '../utils/storage';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '' });

api.interceptors.request.use((config) => {
  // Prepend base path to relative URLs starting with /
  if (config.url && config.url.startsWith('/') && !config.url.startsWith('http')) {
    const base = getBaseURL();
    // Only prepend if not already starting with the base path
    if (base !== '/' && !config.url.startsWith(base + '/')) {
      config.url = base + config.url;
    }
  }
  
  const token = storage.getItem('guardian_token');
  if (token) {
    if (typeof config.headers?.set === 'function') {
      config.headers.set('Authorization', `Bearer ${token}`);
    } else if (config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
  }
  return config;
});

// 响应拦截器：处理标准包装格式 {code, message, data}
api.interceptors.response.use(
  (response) => {
    // 如果返回的数据包含标准的业务 code 字段
    if (response.data && typeof response.data.code === 'number') {
      const { code, message: msg, data } = response.data;
      if (code === 200 || code === 202) {
        // 业务成功：解包并直接返回数据部分，保持前端组件逻辑（如 res.data）不变
        return { ...response, data: data || response.data };
      }
      // 业务失败：抛出异常
      const bizError = new Error(msg || '接口业务错误');
      (bizError as any).response = response;
      return Promise.reject(bizError);
    }
    // 对于非标准包装的接口（如 chat/completions 流、proxy 代理等）直接原样放行
    return response;
  },
  (error) => {
    // 处理 HTTP 状态码层面的错误
    if (error.response?.data?.message) {
      error.message = error.response.data.message;
    }
    return Promise.reject(error);
  }
);


/**
 * 助手函数：获取经过路径补全后的完整 URL
 * 用于 fetch (SSE) 等无法直接使用 axios 实例的场景，确保 WebRoot 一致性
 */
export const getFullUrl = (url: string) => {
  const base = getBaseURL();
  if (url && url.startsWith('/') && !url.startsWith('http')) {
    if (base !== '/' && !url.startsWith(base + '/')) {
      return base + url;
    }
  }
  return url;
};

/**
 * 获取 WebSocket 连接所需的一次性短效票据 (Ticket)
 */
export const getTicket = async (): Promise<string | null> => {
  try {
    const response = await api.post('/v1/auth/ticket');
    return response.data.ticket;
  } catch (err) {
    console.error('Failed to get auth ticket:', err);
    return null;
  }
};

/**
 * 自动总结会话标题
 */
export const summarizeSession = async (messages: any[], modelID?: string): Promise<string | null> => {
  try {
    const response = await api.post('/v1/openclaw/chat/summarize', { messages, modelID });
    return response.data.title;
  } catch (err) {
    const anyErr = err as any;
    const status = anyErr?.response?.status;
    const url = anyErr?.config?.url;

    // 兼容某些反代场景：前端挂在子路径 (WebRoot)，但 API 实际挂在根路径 /v1/...
    // 此时 request interceptor 会把 /v1/... 前缀化为 `${WebRoot}/v1/...`，导致 404。
    // 这里在检测到 404 时，自动回退到根路径重试一次。
    if (status === 404 && typeof window !== 'undefined') {
      try {
        const token = storage.getItem('guardian_token');
        const base = getBaseURL();
        const normalizedBase = base === '/' ? '' : base;
        const fullUrl = `${window.location.origin}${normalizedBase}/v1/openclaw/chat/summarize`;
        
        const retryRes = await axios.post(
          fullUrl,
          { messages, modelID },
          token ? { headers: { Authorization: `Bearer ${token}` } } : undefined
        );
        return retryRes.data.data?.title || retryRes.data.title;
      } catch (retryErr) {
        console.warn('Retry failed:', retryErr);
        console.error('Failed to summarize session (retry root /v1):', retryErr, { originalUrl: url });
        return null;
      }
    }

    console.error('Failed to summarize session:', err, { url });
    return null;
  }
};

export default api;
