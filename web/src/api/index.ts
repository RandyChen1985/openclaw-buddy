import axios from 'axios';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('guardian_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
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
      return Promise.reject(new Error(msg || '接口业务错误'));
    }
    // 对于非标准包装的接口（如 chat/completions 流、proxy 代理等）直接原样放行
    return response;
  },
  (error) => {
    // 处理 HTTP 状态码层面的错误
    const msg = error.response?.data?.message || error.message;
    return Promise.reject(new Error(msg));
  }
);

export default api;
