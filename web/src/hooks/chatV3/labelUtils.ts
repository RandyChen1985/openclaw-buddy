/**
 * 判断一个会话标题是否属于“未命名/默认标题”。
 *
 * 说明：
 * - 后端可能返回空串或默认英文；旧数据也可能存在中文默认标题
 * - 这里集中收敛判定逻辑，避免各模块分散 hardcode
 */
export function isUntitledSessionLabel(label: any) {
  const s = (label ?? '').toString().trim();
  return !s || s === '未命名会话' || s === 'New Session';
}

