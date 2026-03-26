package api

import (
	"net/http"
	"strings"
	"time"
	"yovole-openclaw-monitor/internal/process"
	"yovole-openclaw-monitor/internal/utils"

	"github.com/gin-gonic/gin"
)

func (s *Server) getOpenClawStatus(c *gin.Context) {
	status, err := process.GetStructuredStatus()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, status)
}

func (s *Server) getWeChatQRCode(c *gin.Context) {
	force := c.Query("force") == "true"
	qrcode, err := process.GetWeChatQRCode(force)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if qrcode == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "QR code not found in CLI output"})
		return
	}
	c.JSON(http.StatusOK, qrcode)
}

func (s *Server) startGateway(c *gin.Context) {
	s.runAsyncCommand(c, "gateway", "start")
}

func (s *Server) stopGateway(c *gin.Context) {
	s.runAsyncCommand(c, "gateway", "stop")
}

func (s *Server) restartGateway(c *gin.Context) {
	s.runAsyncCommand(c, "gateway", "restart")
}

func (s *Server) runAsyncCommand(c *gin.Context, args ...string) {
	go func() {
		_, _ = process.RunCommandWithTimeout(30*time.Second, "openclaw", args...)
	}()
	c.JSON(http.StatusAccepted, gin.H{
		"message": "Command accepted and running in background",
		"command": "openclaw " + strings.Join(args, " "),
	})
}

func (s *Server) getHealthStats(c *gin.Context) {
	rows, err := utils.DB.Query(`
		SELECT timestamp, status, response_time_ms 
		FROM health_checks 
		WHERE timestamp >= datetime('now', '-24 hours')
		ORDER BY timestamp ASC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type HealthStat struct {
		Timestamp      string `json:"timestamp"`
		Status         string `json:"status"`
		ResponseTimeMS int    `json:"response_time_ms"`
	}

	stats := []HealthStat{}
	for rows.Next() {
		var st HealthStat
		if err := rows.Scan(&st.Timestamp, &st.Status, &st.ResponseTimeMS); err != nil {
			continue
		}
		stats = append(stats, st)
	}

	c.JSON(http.StatusOK, stats)
}
