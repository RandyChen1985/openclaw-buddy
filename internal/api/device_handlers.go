package api

import (
	"log"
	"net/http"

	"openclaw-buddy/internal/process"

	"github.com/gin-gonic/gin"
)

func (s *Server) getOpenClawDevices(c *gin.Context) {
	key := "devices"
	if c.Query("refresh") == "true" {
		if err := process.SyncKeySingle(key, s.cfg.OpenClawConfigDir); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
	}

	data, updatedAt, err := process.GetCachedData(key)
	if err != nil {
		devices, err := process.GetOpenClawDevices()
		if err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		s.Success(c, gin.H{"data": devices, "updated_at": "实时"})
		return
	}
	s.Success(c, gin.H{"data": data, "updated_at": updatedAt})
}

func (s *Server) approveDevice(c *gin.Context) {
	var req struct {
		RequestId string `json:"requestId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "requestId 不能为空")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【批准设备接入】 (RequestID: %s)", req.RequestId)
	if err := process.ApproveDevice(req.RequestId); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	s.Success(c, gin.H{"message": "设备批准成功"})
}
