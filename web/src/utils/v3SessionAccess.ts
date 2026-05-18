/** 与 OnlineChat / App 传入的 RBAC 字段一致 */
export type V3ChatAdminAccess = {
  isSuperAdmin?: boolean;
  /** 普通用户为 string[]；admin / superadmin 为 undefined（不受 bot 白名单限制） */
  allowedBotIDs?: string[] | null;
};

/** 管理员可清理「Bot 已下线 / 不在 bots-models」的历史会话（仍不可打开聊天） */
export function canBypassV3SessionBotAccess(params: V3ChatAdminAccess | undefined): boolean {
  if (!params) return false;
  if (params.isSuperAdmin) return true;
  return !Array.isArray(params.allowedBotIDs);
}
