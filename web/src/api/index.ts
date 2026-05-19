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
  const normalizedUrl = url.startsWith('/') ? url : '/' + url;
  let path = normalizedUrl;
  if (url && url.startsWith('/') && !url.startsWith('http')) {
    if (base !== '/' && !url.startsWith(base + '/')) {
      path = base + url;
    }
  }

  const apiBase = import.meta.env.VITE_API_URL?.trim();
  if (!apiBase || url.startsWith('http')) return url.startsWith('http') ? url : path;

  try {
    const baseUrl = new URL(apiBase, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
    const apiBasePath = baseUrl.pathname && baseUrl.pathname !== '/'
      ? baseUrl.pathname.replace(/\/$/, '')
      : '';
    const fullPath = apiBasePath && !path.startsWith(apiBasePath + '/')
      ? apiBasePath + path
      : path;
    return `${baseUrl.origin}${fullPath}`;
  } catch {
    return path;
  }
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
export type ChatCompletionMessage = { role: 'user' | 'assistant' | 'system'; content: string };

function parseModelChatSseLine(line: string): string | null {
  if (!line.startsWith('data:')) return null;
  const dataStr = line.slice(5).trim();
  if (!dataStr || dataStr === '[DONE]') return null;
  const data = JSON.parse(dataStr);
  if (data?.error) {
    const errRaw = data.error?.message ?? data.error;
    throw new Error(typeof errRaw === 'string' ? errRaw : JSON.stringify(errRaw));
  }
  const piece = data?.choices?.[0]?.delta?.content ?? data?.choices?.[0]?.message?.content ?? '';
  return typeof piece === 'string' && piece.length > 0 ? piece : null;
}

async function readModelChatSseStream(
  response: Response,
  onDelta: (chunk: string) => void,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Stream not supported');

  const decoder = new TextDecoder();
  let pendingLine = '';
  let full = '';

  const consumeLine = (line: string) => {
    const delta = parseModelChatSseLine(line);
    if (!delta) return;
    full += delta;
    onDelta(delta);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      pendingLine += decoder.decode();
      if (pendingLine.trim()) {
        for (const line of pendingLine.split(/\r?\n/)) {
          if (line.trim()) consumeLine(line);
        }
      }
      break;
    }
    pendingLine += decoder.decode(value, { stream: true });
    const lines = pendingLine.split(/\r?\n/);
    pendingLine = lines.pop() || '';
    for (const line of lines) {
      if (line.trim()) consumeLine(line);
    }
  }

  return full;
}

export type StreamModelChatOptions = {
  onDelta: (chunk: string) => void;
  signal?: AbortSignal;
};

/**
 * 模型试聊流式对话：直连提供商 SSE（与 summarize 同路由，stream: true）。
 */
export async function streamModelChatCompletions(
  modelID: string,
  messages: ChatCompletionMessage[],
  options: StreamModelChatOptions,
): Promise<string> {
  const token = storage.getItem('guardian_token');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  const body = JSON.stringify({ modelID, messages, stream: true });

  const postStream = (url: string) =>
    fetch(url, { method: 'POST', headers, body, signal: options.signal });

  let response = await postStream(getFullUrl('/v1/openclaw/chat/complete'));

  if (response.status === 404 && typeof window !== 'undefined') {
    const base = getBaseURL();
    const normalizedBase = base === '/' ? '' : base;
    const fallbackUrl = `${window.location.origin}${normalizedBase}/v1/openclaw/chat/complete`;
    response = await postStream(fallbackUrl);
  }

  if (!response.ok) {
    let errMsg = `HTTP ${response.status}`;
    try {
      const errJson = await response.json();
      errMsg = errJson?.message || errJson?.error?.message || errJson?.error || errMsg;
    } catch {
      try {
        errMsg = await response.text();
      } catch {
        /* ignore */
      }
    }
    throw new Error(typeof errMsg === 'string' ? errMsg : JSON.stringify(errMsg));
  }

  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    return readModelChatSseStream(response, options.onDelta);
  }

  const json = await response.json();
  const content =
    (typeof json?.data?.content === 'string' ? json.data.content : '') ||
    (typeof json?.content === 'string' ? json.content : '');
  if (content) options.onDelta(content);
  return content;
}

/** 非流式（保留兼容）；模型试聊默认用 streamModelChatCompletions */
export const chatCompletions = async (
  modelID: string,
  messages: ChatCompletionMessage[],
): Promise<string> => {
  const postComplete = async (url: string) => {
    const token = storage.getItem('guardian_token');
    return axios.post(
      url,
      { modelID, messages, stream: false },
      token ? { headers: { Authorization: `Bearer ${token}` } } : undefined,
    );
  };

  try {
    const response = await api.post('/v1/openclaw/chat/complete', { modelID, messages, stream: false });
    const content = response.data?.content;
    if (typeof content === 'string') return content;
    return '';
  } catch (err) {
    const anyErr = err as any;
    const status = anyErr?.response?.status;
    const url = anyErr?.config?.url;

    if (status === 404 && typeof window !== 'undefined') {
      try {
        const base = getBaseURL();
        const normalizedBase = base === '/' ? '' : base;
        const fullUrl = `${window.location.origin}${normalizedBase}/v1/openclaw/chat/complete`;
        const retryRes = await postComplete(fullUrl);
        const content = retryRes.data?.data?.content ?? retryRes.data?.content;
        if (typeof content === 'string') return content;
        return '';
      } catch (retryErr) {
        console.error('Failed to chat complete (retry root /v1):', retryErr, { originalUrl: url });
        throw retryErr;
      }
    }

    console.error('Failed to chat complete:', err, { url });
    throw err;
  }
};

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
