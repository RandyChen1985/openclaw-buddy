package api

import (
	"net/http"
	"strconv"
	"strings"

	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

// handleAuthMe 返回当前认证主体的概要信息与权限集合，用于前端菜单与按钮渲染。
func (s *Server) handleAuthMe(c *gin.Context) {
	p := GetPrincipal(c)
	if p == nil {
		s.Error(c, http.StatusUnauthorized, "Unauthorized")
		return
	}

	if p.IsSuperAdmin {
		s.Success(c, gin.H{
			"is_superadmin": true,
			"username":      "superadmin",
			"real_name":     "超级管理员",
			"role_keys":     []string{"admin"},
			"permissions":   []string{},
			"login_type":    "token",
		})
		return
	}

	roleKeys, _ := utils.GetUserRoleKeys(p.User.ID)
	s.Success(c, gin.H{
		"is_superadmin": false,
		"id":            p.User.ID,
		"username":      p.User.Username,
		"real_name":     p.User.RealName,
		"remark":        p.User.Remark,
		"role_keys":     roleKeys,
		"permissions":   p.Permissions,
		"login_type":    "password",
	})
}

// handleLogout 仅会清理 session token（BUDDY_TOKEN 不可注销）。
func (s *Server) handleLogout(c *gin.Context) {
	authHeader := c.GetHeader("Authorization")
	if authHeader != "" {
		parts := strings.Split(authHeader, " ")
		if len(parts) == 2 && parts[0] == "Bearer" {
			tok := strings.TrimSpace(parts[1])
			if tok != s.cfg.Token {
				_ = utils.DeleteSession(tok)
			}
		}
	}

	cookiePath := s.cfg.WebRoot
	if cookiePath == "" {
		cookiePath = "/"
	}
	c.SetCookie("guardian_token", "", -1, cookiePath, "", false, true)
	s.Success(c, gin.H{"status": "success"})
}

// handleListUsers 用户管理列表
func (s *Server) handleListUsers(c *gin.Context) {
	keyword := strings.TrimSpace(c.Query("keyword"))
	users, err := utils.ListUsers(keyword)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"items": users})
}

type createUserReq struct {
	Username string   `json:"username"`
	RealName string   `json:"real_name"`
	Remark   string   `json:"remark"`
	Password string   `json:"password"`
	RoleKeys []string `json:"role_keys"`
}

// handleCreateUser 创建一个用户
func (s *Server) handleCreateUser(c *gin.Context) {
	var req createUserReq
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "Invalid request")
		return
	}
	if len(req.RoleKeys) == 0 {
		req.RoleKeys = []string{"user"}
	}
	u, err := utils.CreateUser(req.Username, req.RealName, req.Remark, req.Password, req.RoleKeys)
	if err != nil {
		s.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	s.Success(c, u)
}

type updateUserReq struct {
	RealName string   `json:"real_name"`
	Remark   string   `json:"remark"`
	Status   *int     `json:"status"`
	RoleKeys []string `json:"role_keys"`
}

// handleUpdateUser 更新用户基本信息与角色（不含密码）
func (s *Server) handleUpdateUser(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		s.Error(c, http.StatusBadRequest, "invalid id")
		return
	}
	var req updateUserReq
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "Invalid request")
		return
	}
	status := 1
	if req.Status != nil {
		status = *req.Status
	}
	if err := utils.UpdateUser(id, req.RealName, req.Remark, status, req.RoleKeys); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success"})
}

type resetPasswordReq struct {
	Password string `json:"password"`
}

// handleResetUserPassword 重置指定用户的密码并撤销其所有会话
func (s *Server) handleResetUserPassword(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		s.Error(c, http.StatusBadRequest, "invalid id")
		return
	}
	var req resetPasswordReq
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "Invalid request")
		return
	}
	if err := utils.SetUserPassword(id, req.Password); err != nil {
		s.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success"})
}

// handleDeleteUser 删除一个用户
func (s *Server) handleDeleteUser(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		s.Error(c, http.StatusBadRequest, "invalid id")
		return
	}
	if p := GetPrincipal(c); p != nil && !p.IsSuperAdmin && p.User != nil && p.User.ID == id {
		s.Error(c, http.StatusBadRequest, "不能删除当前登录的用户")
		return
	}
	if err := utils.DeleteUser(id); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success"})
}

// handleListRoles 角色列表（前端做角色选择时用）
func (s *Server) handleListRoles(c *gin.Context) {
	roles, err := utils.ListRoles()
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"items": roles})
}

// handleListPermissions 权限点列表（前端做角色权限分配用）
func (s *Server) handleListPermissions(c *gin.Context) {
	pt := strings.TrimSpace(c.Query("type"))
	items, err := utils.ListPermissions(pt)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"items": items})
}

type updateRolePermReq struct {
	PermissionKeys []string `json:"permission_keys"`
}

// handleGetUserPermissions 获取用户直接权限 key 列表
func (s *Server) handleGetUserPermissions(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		s.Error(c, http.StatusBadRequest, "invalid id")
		return
	}
	keys, err := utils.GetUserDirectPermissionKeys(id)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"permission_keys": keys})
}

// handleUpdateUserPermissions 覆盖更新用户的权限点绑定
func (s *Server) handleUpdateUserPermissions(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		s.Error(c, http.StatusBadRequest, "invalid id")
		return
	}
	var req updateRolePermReq
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "Invalid request")
		return
	}
	if err := utils.SetUserPermissions(id, req.PermissionKeys); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success"})
}
