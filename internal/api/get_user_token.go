package api

import (
	"net/http"
	"strings"

	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

// principalIsBuddyTokenOrAdminRole 是否为环境 BUDDY_TOKEN（超级管理员）或数据库中 role key 为 admin 的用户主体。
func principalIsBuddyTokenOrAdminRole(p *Principal) bool {
	if p == nil {
		return false
	}
	if p.IsSuperAdmin {
		return true
	}
	if p.User == nil {
		return false
	}
	keys, err := utils.GetUserRoleKeys(p.User.ID)
	if err != nil {
		return false
	}
	for _, k := range keys {
		if k == "admin" {
			return true
		}
	}
	return false
}

// handleGetUserToken 对外接口：凭 adminToken 查询指定用户名的访问令牌（api_token）信息。
// adminToken 须为 BUDDY_TOKEN，或任意能解析为「admin 角色用户」的会话令牌 / 用户 api_token（buddyu_*）。
// 请求体支持 JSON 或 application/x-www-form-urlencoded，字段：adminToken、username。
func (s *Server) handleGetUserToken(c *gin.Context) {
	var req struct {
		AdminToken string `json:"adminToken" form:"adminToken"`
		Username   string `json:"username" form:"username"`
	}
	if err := c.ShouldBind(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "Invalid request")
		return
	}
	adminTok := strings.TrimSpace(req.AdminToken)
	username := strings.TrimSpace(req.Username)
	if adminTok == "" || username == "" {
		s.Error(c, http.StatusBadRequest, "adminToken and username are required")
		return
	}

	p := resolveBearerPrincipal(adminTok, s.cfg.Token)
	if p == nil {
		s.Error(c, http.StatusUnauthorized, "Invalid adminToken")
		return
	}
	if !principalIsBuddyTokenOrAdminRole(p) {
		s.Error(c, http.StatusForbidden, "adminToken must be BUDDY_TOKEN or an admin-role bearer token")
		return
	}

	u, err := utils.GetUserByUsername(username)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if u == nil {
		s.Error(c, http.StatusNotFound, "user not found")
		return
	}

	tok, err := utils.GetUserAPIToken(u.ID)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{
		"username":   u.Username,
		"real_name":  u.RealName,
		"configured": tok != "",
		"token":      tok,
	})
}
