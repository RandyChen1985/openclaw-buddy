/**
 * 获取当前的命名空间前缀
 */
const getPrefix = () => {
  // 如果是 Wails 协议环境，强制使用固定前缀，确保持久化稳定性
  if (window.location.protocol.includes('wails') || window.location.hostname === 'wails.localhost') {
    return 'ocb_wails_';
  }

  // 优先读取由 Go 后端在运行时注入的 __WEB_ROOT__ 全局变量 (用于多实例隔离)
  const webRoot = (window as any).__WEB_ROOT__ || import.meta.env.BASE_URL || '/';
  
  // 处理格式: / -> "" ; /console/claw -> consoleclaw
  const namespace = (webRoot === '/' || !webRoot) ? '' : webRoot.replace(/\//g, '');
  
  return `ocb${namespace ? '_' + namespace : ''}_`;
};


/**
 * 带有命名空间的 LocalStorage 封装
 */
export const storage = {
  /**
   * 获取存储项
   */
  getItem: (key: string): string | null => {
    return localStorage.getItem(getPrefix() + key);
  },

  /**
   * 设置存储项
   */
  setItem: (key: string, value: string): void => {
    localStorage.setItem(getPrefix() + key, value);
  },

  /**
   * 移除存储项
   */
  removeItem: (key: string): void => {
    localStorage.removeItem(getPrefix() + key);
  },

  /**
   * 清空当前命名空间下的所有项 (慎用)
   */
  clear: (): void => {
    const prefix = getPrefix();
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith(prefix)) {
        localStorage.removeItem(key);
      }
    });
  },
  
  /**
   * 获取原始存储 Key (用于 i18next 等第三方库)
   */
  getRawKey: (key: string): string => {
    return getPrefix() + key;
  }
};

export default storage;
