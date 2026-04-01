import { getBaseURL } from './url';

/**
 * 获取当前的命名空间前缀
 * 基于 WebRoot 生成，例如:
 * / -> ocb_
 * /claw1 -> ocb_claw1_
 */
const getPrefix = () => {
  const base = getBaseURL();
  // 移除斜杠并用下划线连接，如果是根目录就只用 ocb_
  const namespace = base ? base.replace(/\//g, '') : '';
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
