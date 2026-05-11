package api

import (
	"net/http"

	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

func (s *Server) getOpenClawStatus(c *gin.Context) {
	status, err := process.GetStructuredStatus(s.cfg.HealthPort)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	status.InstalledAt = utils.GetSetting("first_run_at", "未知")
	s.Success(c, status)
}

func (s *Server) getSessions(c *gin.Context) {
	refresh := c.Query("refresh") == "true"
	if refresh {
		if err := process.SyncKeySingle("sessions", s.cfg.OpenClawConfigDir); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
	}

	data, updatedAt, err := process.GetCachedData("sessions")
	if err != nil {
		// 如果缓存没有，尝试同步一次
		if err := process.SyncKeySingle("sessions", s.cfg.OpenClawConfigDir); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		data, updatedAt, _ = process.GetCachedData("sessions")
	}

	s.Success(c, gin.H{
		"data":       data,
		"updated_at": updatedAt,
	})
}
