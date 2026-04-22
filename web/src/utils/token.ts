/**
 * Token 估算工具函数
 * 基于项目已有的估算逻辑进行封装
 */

export const estimateTokens = (text: string): number => {
  if (!text) return 0;
  
  // 匹配中文字符
  const chineseChars = text.match(/[\u4e00-\u9fa5]/g)?.length || 0;
  
  // 其他字符（英文字母、数字、符号、空格等）
  const nonChineseChars = text.length - chineseChars;
  
  /**
   * 估算规则：
   * 1. 中文字符：1 个字符约为 1 个 token (在大多数国产模型和 GPT-4o 中比较接近)
   * 2. 非中文字符：平均约 2.8 个字符 1 个 token (针对英文单词和 Markdown 符号的权衡)
   * 
   * 这个公式是一个粗略的估算，用于前端实时显示。
   */
  return Math.ceil(chineseChars + (nonChineseChars / 2.8));
};
