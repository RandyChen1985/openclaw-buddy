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

export default api;
