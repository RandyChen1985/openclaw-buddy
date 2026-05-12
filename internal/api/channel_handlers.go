package api

import (
	"log"
	"net/http"
	"strings"
	"time"

	"openclaw-buddy/internal/process"

	"github.com/gin-gonic/gin"
)

func (s *Server) getChannelsMetadata(c *gin.Context) {
	s.Success(c, gin.H{"data": process.SupportedChannels})
}

func (s *Server) getChannelsStatus(c *gin.Context) {
	status, err := process.GetChannelsStatus(s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "Failed to get channels status: "+err.Error())
		return
	}
	s.Success(c, gin.H{"data": status})
}

// getChannelAccounts GET /v1/channels/:channelId/accounts — 凭证是否已写入（脱敏）+ 绑定该渠道的 Agent 列表
func (s *Server) getChannelAccounts(c *gin.Context) {
	channelID := c.Param("channelId")
	switch channelID {
	case "feishu", "telegram", "qqbot":
	default:
		s.Error(c, http.StatusBadRequest, "unsupported channelId")
		return
	}
	ov, err := process.GetChannelAccountsOverview(s.cfg.OpenClawConfigDir, channelID)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"data": ov})
}

// bindChannelRoute POST /v1/channels/:channelId/bind — 根级 bindings[] 路由（openclaw agents bind）
func (s *Server) bindChannelRoute(c *gin.Context) {
	channelID := c.Param("channelId")
	switch channelID {
	case "feishu", "telegram", "qqbot":
	default:
		s.Error(c, http.StatusBadRequest, "unsupported channelId")
		return
	}
	var req struct {
		AgentID   string `json:"agentId" binding:"required"`
		AccountID string `json:"accountId"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "Invalid request body")
		return
	}
	if err := process.BindChannelRouteToAgent(s.cfg.OpenClawConfigDir, channelID, req.AgentID, req.AccountID); err != nil {
		s.Error(c, http.StatusInternalServerError, "Failed to bind route: "+err.Error())
		return
	}
	s.Success(c, gin.H{"message": "Route binding added"})
}

func (s *Server) getChannelQRCode(c *gin.Context) {
	channelID := c.Param("id")
	if channelID == "" {
		s.Error(c, http.StatusBadRequest, "Channel ID is required")
		return
	}

	force := c.Query("force") == "true"
	// 如果是微信，复用原逻辑
	if channelID == "openclaw-weixin" {
		qr, err := process.GetWeChatQRCode(force)
		if err != nil {
			s.Error(c, http.StatusInternalServerError, "获取微信二维码失败: "+err.Error())
			return
		}
		s.Success(c, qr)
		return
	}

	// 其他渠道使用通用逻辑
	qr, err := process.GetGenericQRCode(channelID)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "获取二维码失败: "+err.Error())
		return
	}
	s.Success(c, qr)
}

func (s *Server) saveChannelConfig(c *gin.Context) {
	var req struct {
		ChannelID string            `json:"channelId" binding:"required"`
		AgentID   string            `json:"agentId"`
		Secrets   map[string]string `json:"secrets" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "Invalid request body")
		return
	}

	// 使用新的 SaveChannelSecret（接收整个 secrets map，按渠道选择正确写入方式）
	if err := process.SaveChannelSecret(s.cfg.OpenClawConfigDir, req.ChannelID, req.Secrets); err != nil {
		s.Error(c, http.StatusInternalServerError, "Failed to save channel config: "+err.Error())
		return
	}

	// 如果指定了机器人，进行绑定
	if req.AgentID != "" {
		var bindErr error
		switch req.ChannelID {
		case "feishu":
			bindErr = process.BindChannelRouteToAgent(s.cfg.OpenClawConfigDir, req.ChannelID, req.AgentID, "")
		case "telegram":
			bindErr = process.BindTelegramToAgent(s.cfg.OpenClawConfigDir, req.AgentID)
		case "qqbot":
			bindErr = process.BindQQBotToAgent(s.cfg.OpenClawConfigDir, req.AgentID)
		default:
			log.Printf("⚠️ No specific binding logic for channel: %s", req.ChannelID)
			env, envErr := process.OpenClawConfigEnv(s.cfg.OpenClawConfigDir)
			if envErr != nil {
				s.Error(c, http.StatusInternalServerError, envErr.Error())
				return
			}
			_, bindErr = process.RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "agents", "bind",
				"--agent", req.AgentID, "--bind", req.ChannelID)
		}

		if bindErr != nil {
			s.Error(c, http.StatusInternalServerError, "Failed to bind channel to agent: "+bindErr.Error())
			return
		}
	}

	s.Success(c, gin.H{"message": "Configuration saved successfully"})
}

// unbindChannel 解绑指定渠道与 Agent 的绑定关系
// DELETE /v1/channels/:channelId/setup
func (s *Server) unbindChannel(c *gin.Context) {
	channelID := c.Param("channelId")
	agentID := c.DefaultQuery("agentId", "main")
	accountID := strings.TrimSpace(c.Query("accountId"))

	if channelID == "" {
		s.Error(c, http.StatusBadRequest, "channelId is required")
		return
	}

	log.Printf("🔗 Unbinding channel %s from agent %s (accountId=%q)", channelID, agentID, accountID)

	var unbindErr error
	switch channelID {
	case "feishu", "telegram", "qqbot":
		unbindErr = process.UnbindChannelRouteFromAgent(s.cfg.OpenClawConfigDir, channelID, agentID, accountID)
	default:
		log.Printf("⚠️ No specific unbind logic for channel: %s, falling back to basic CLI unbind", channelID)
		env, envErr := process.OpenClawConfigEnv(s.cfg.OpenClawConfigDir)
		if envErr != nil {
			s.Error(c, http.StatusInternalServerError, envErr.Error())
			return
		}
		bindSpec := channelID
		if accountID != "" {
			bindSpec = channelID + ":" + accountID
		}
		_, unbindErr = process.RunCommandWithEnvAndTimeout(15*time.Second, env, "openclaw", "agents", "unbind",
			"--agent", agentID, "--bind", bindSpec)
	}

	if unbindErr != nil {
		log.Printf("❌ Unbind failed for %s: %v", channelID, unbindErr)
		s.Error(c, http.StatusInternalServerError, "Failed to unbind channel: "+unbindErr.Error())
		return
	}

	log.Printf("✅ Successfully unbound channel %s from agent %s", channelID, agentID)
	s.Success(c, gin.H{"message": "Channel unbound successfully"})
}

// deleteChannelAccount 删除渠道账号凭证
// DELETE /v1/channels/:channelId/accounts/:accountId
func (s *Server) deleteChannelAccount(c *gin.Context) {
	channelID := c.Param("channelId")
	accountID := c.Param("accountId")

	if channelID == "" || accountID == "" {
		s.Error(c, http.StatusBadRequest, "channelId and accountId are required")
		return
	}

	log.Printf("🗑️ Deleting channel account credentials: %s:%s", channelID, accountID)

	if err := process.DeleteChannelAccount(s.cfg.OpenClawConfigDir, channelID, accountID); err != nil {
		s.Error(c, http.StatusInternalServerError, "Failed to delete account: "+err.Error())
		return
	}

	s.Success(c, gin.H{"message": "Account deleted successfully"})
}
