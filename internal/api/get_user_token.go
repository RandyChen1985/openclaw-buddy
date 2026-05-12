package api

import (
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"regexp"
	"strings"

	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

// 与面板创建用户一致：2~32 位，仅字母、数字、下划线。
var createUserTokenUsernamePattern = regexp.MustCompile(`^[A-Za-z0-9_]{2,32}$`)

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

func parseAdminUsernameForm(c *gin.Context) (adminTok, username string, bindOK bool) {
	var req struct {
		AdminToken string `json:"adminToken" form:"adminToken"`
		Username   string `json:"username" form:"username"`
	}
	if err := c.ShouldBind(&req); err != nil {
		return "", "", false
	}
	return strings.TrimSpace(req.AdminToken), strings.TrimSpace(req.Username), true
}

// authorizeAdminTokenBody 校验 adminToken；失败时已写入 HTTP 响应。
func (s *Server) authorizeAdminTokenBody(c *gin.Context, adminTok string) bool {
	p := resolveBearerPrincipal(adminTok, s.cfg.Token)
	if p == nil {
		s.Error(c, http.StatusUnauthorized, "Invalid adminToken")
		return false
	}
	if !principalIsBuddyTokenOrAdminRole(p) {
		s.Error(c, http.StatusForbidden, "adminToken must be BUDDY_TOKEN or an admin-role bearer token")
		return false
	}
	return true
}

type createUserTokenReq struct {
	AdminToken    string `json:"adminToken" form:"adminToken"`
	Username      string `json:"username" form:"username"`
	Realname      string `json:"realname" form:"realname"`
	RealNameSnake string `json:"real_name" form:"real_name"`
	BotID         string `json:"botId" form:"botId"`
	BotIDLower    string `json:"botid" form:"botid"`
}

func parseCreateUserTokenReq(c *gin.Context) (createUserTokenReq, bool) {
	var req createUserTokenReq
	if err := c.ShouldBind(&req); err != nil {
		return req, false
	}
	return req, true
}

func effectiveDisplayRealname(req createUserTokenReq, username string) string {
	r := strings.TrimSpace(req.Realname)
	if r == "" {
		r = strings.TrimSpace(req.RealNameSnake)
	}
	if r == "" {
		return username
	}
	return r
}

func effectiveBotIDParam(req createUserTokenReq) string {
	b := strings.TrimSpace(req.BotID)
	if b != "" {
		return b
	}
	return strings.TrimSpace(req.BotIDLower)
}

// mergeOpenclawBotForUser：若 botID 在当前 OpenClaw 机器人列表中存在，且用户尚未拥有该 bot，则写入 user_bots；否则无操作（未知 bot、列表拉取失败、已授权均忽略）。
func mergeOpenclawBotForUser(configDir string, userID int64, botID string) error {
	botID = strings.TrimSpace(botID)
	if botID == "" {
		return nil
	}
	res, err := process.GetOpenClawBotsModels(configDir)
	if err != nil || res == nil {
		return nil
	}
	found := false
	for _, b := range res.Bots {
		if strings.TrimSpace(b.ID) == botID {
			found = true
			break
		}
	}
	if !found {
		return nil
	}
	ids, err := utils.GetUserBotIDs(userID)
	if err != nil {
		return err
	}
	for _, id := range ids {
		if strings.TrimSpace(id) == botID {
			return nil
		}
	}
	return utils.SetUserBots(userID, append(ids, botID))
}

// handleGetUserToken 对外接口（POST /v1/getUserToken）：凭 adminToken 查询指定用户名的访问令牌（api_token）信息。
// adminToken 须为 BUDDY_TOKEN，或任意能解析为「admin 角色用户」的会话令牌 / 用户 api_token（buddyu_*）。
// 请求体支持 JSON 或 application/x-www-form-urlencoded，字段：adminToken、username。
func (s *Server) handleGetUserToken(c *gin.Context) {
	adminTok, username, ok := parseAdminUsernameForm(c)
	if !ok {
		s.Error(c, http.StatusBadRequest, "Invalid request")
		return
	}
	if adminTok == "" || username == "" {
		s.Error(c, http.StatusBadRequest, "adminToken and username are required")
		return
	}
	if !s.authorizeAdminTokenBody(c, adminTok) {
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

// handleCreateUserToken 对外接口（POST /v1/createUserToken）：与 getUserToken 相同 adminToken 规则；
// 若用户名已存在则返回该用户及当前 api_token；若不存在则创建 role=user 的用户、自动生成 api_token 并返回。
// 可选：realname / real_name（未传则用 username 作为真实姓名）；botId / botid（若存在于 OpenClaw 机器人列表且用户尚未授权则补齐 user_bots）。
func (s *Server) handleCreateUserToken(c *gin.Context) {
	body, ok := parseCreateUserTokenReq(c)
	if !ok {
		s.Error(c, http.StatusBadRequest, "Invalid request")
		return
	}
	adminTok := strings.TrimSpace(body.AdminToken)
	username := strings.TrimSpace(body.Username)
	if adminTok == "" || username == "" {
		s.Error(c, http.StatusBadRequest, "adminToken and username are required")
		return
	}
	if !s.authorizeAdminTokenBody(c, adminTok) {
		return
	}
	if !createUserTokenUsernamePattern.MatchString(username) {
		s.Error(c, http.StatusBadRequest, "用户名须为 2~32 位字母、数字或下划线")
		return
	}
	displayName := effectiveDisplayRealname(body, username)
	botWant := effectiveBotIDParam(body)

	u, err := utils.GetUserByUsername(username)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if u != nil {
		if err := mergeOpenclawBotForUser(s.cfg.OpenClawConfigDir, u.ID, botWant); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		tok, err := utils.GetUserAPIToken(u.ID)
		if err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		s.Success(c, gin.H{
			"id":         u.ID,
			"username":   u.Username,
			"real_name":  u.RealName,
			"status":     u.Status,
			"configured": tok != "",
			"token":      tok,
			"created":    false,
		})
		return
	}

	pw := make([]byte, 18)
	if _, err := rand.Read(pw); err != nil {
		s.Error(c, http.StatusInternalServerError, "failed to generate password")
		return
	}
	plain := "auto_" + hex.EncodeToString(pw)

	uw, err := utils.CreateUser(username, displayName, "", plain, []string{"user"})
	if err != nil {
		s.Error(c, http.StatusBadRequest, err.Error())
		return
	}
	tok, err := utils.EnsureUserAPIToken(uw.ID)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if err := mergeOpenclawBotForUser(s.cfg.OpenClawConfigDir, uw.ID, botWant); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{
		"id":         uw.ID,
		"username":   uw.Username,
		"real_name":  uw.RealName,
		"status":     uw.Status,
		"configured": true,
		"token":      tok,
		"created":    true,
	})
}
