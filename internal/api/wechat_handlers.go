package api

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"openclaw-buddy/internal/process"

	"github.com/gin-gonic/gin"
)

func (s *Server) getWeChatConfigStatus(c *gin.Context) {
	key := "chat_channels"
	if c.Query("refresh") == "true" {
		if err := process.SyncKeySingle(key, s.cfg.OpenClawConfigDir); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
	}

	data, updatedAt, err := process.GetCachedData(key)
	if err != nil {
		// 如果缓存不存在且没要求强制刷新，则实时获取一次
		channels, err := process.GetChatChannels()
		if err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		s.Success(c, gin.H{"data": channels, "updated_at": "实时"})
		return
	}

	s.Success(c, gin.H{"data": data, "updated_at": updatedAt})
}

func (s *Server) getWeChatQRCode(c *gin.Context) {
	force := c.Query("force") == "true"
	qrcode, err := process.GetWeChatQRCode(force)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if qrcode == nil {
		s.Error(c, http.StatusNotFound, "QR code not found in CLI output")
		return
	}
	s.Success(c, qrcode)
}

func (s *Server) installWeChatPlugin(c *gin.Context) {
	log.Printf("🎮 [控制] 用户请求: 【安装微信插件】")
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.install_plugin:wechat",
		Module: "plugins",
		Action: "install",
		Target: "wechat",
	}
	s.runAsyncTask(c, task, func() (string, error) {
		err := process.InstallWeChatPlugin()
		if err != nil {
			return "", err
		}

		return "tasks.results.installed", nil
	})
}

func (s *Server) checkWeChatPlugin(c *gin.Context) {
	refresh := c.Query("refresh") == "true"
	status, err := process.GetWeChatPluginStatus(refresh)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, status)
}

func (s *Server) unbindWeChatAccount(c *gin.Context) {
	accountID := c.Param("id")
	if accountID == "" {
		s.Error(c, http.StatusBadRequest, "account id is required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【解绑微信账号】 (ID: %s)", accountID)
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.unbind_wechat:" + accountID,
		Module: "wechat",
		Action: "unbind",
		Target: accountID,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.UnbindWeChatAccount(s.cfg.OpenClawConfigDir, accountID); err != nil {
			return "", err
		}
		// 解绑后同步一次渠道列表
		_ = process.SyncKeySingle("chat_channels", s.cfg.OpenClawConfigDir)
		return "tasks.results.unbound", nil
	})
}
