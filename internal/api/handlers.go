package api

import (
	"fmt"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
	"time"
	"yovole-openclaw-monitor/internal/process"
	"yovole-openclaw-monitor/internal/utils"

	"github.com/gin-gonic/gin"
)

func (s *Server) getDashboardURL(c *gin.Context) {
	url, err := process.GetDashboardURL(s.cfg.ExternalDashboardURL)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"url": url})
}

func (s *Server) proxyLobsterDashboard(c *gin.Context) {
	targetPort := s.cfg.HealthPort
	targetURL, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", targetPort))

	proxy := httputil.NewSingleHostReverseProxy(targetURL)

	// 修改响应头以允许嵌入
	proxy.ModifyResponse = func(res *http.Response) error {
		res.Header.Del("Content-Security-Policy")
		res.Header.Del("X-Frame-Options")
		// 允许跨域
		res.Header.Set("Access-Control-Allow-Origin", "*")
		return nil
	}

	// 统一处理路径：剥离 /v1/proxy 前缀
	c.Request.URL.Path = strings.TrimPrefix(c.Request.URL.Path, "/v1/proxy")
	if c.Request.URL.Path == "" {
		c.Request.URL.Path = "/"
	}

	proxy.ServeHTTP(c.Writer, c.Request)
}

func (s *Server) getWeChatConfigStatus(c *gin.Context) {
	key := "chat_channels"
	if c.Query("refresh") == "true" {
		if err := process.SyncKeySingle(key, s.cfg.OpenClawConfigDir); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	data, updatedAt, err := process.GetCachedData(key)
	if err != nil {
		// 如果缓存不存在且没要求强制刷新，则实时获取一次
		channels, err := process.GetChatChannels()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": channels, "updated_at": "实时"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": data, "updated_at": updatedAt})
}

func (s *Server) getOpenClawBotsModels(c *gin.Context) {
	key := "bots_models"
	if c.Query("refresh") == "true" {
		if err := process.SyncKeySingle(key, s.cfg.OpenClawConfigDir); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	data, updatedAt, err := process.GetCachedData(key)
	if err != nil {
		res, err := process.GetOpenClawBotsModels(s.cfg.OpenClawConfigDir)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": res, "updated_at": "实时"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data, "updated_at": updatedAt})
}

func (s *Server) getOpenClawDevices(c *gin.Context) {
	key := "devices"
	if c.Query("refresh") == "true" {
		if err := process.SyncKeySingle(key, s.cfg.OpenClawConfigDir); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
	}

	data, updatedAt, err := process.GetCachedData(key)
	if err != nil {
		devices, err := process.GetOpenClawDevices()
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"data": devices, "updated_at": "实时"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": data, "updated_at": updatedAt})
}

func (s *Server) approveDevice(c *gin.Context) {
	var req struct {
		RequestId string `json:"requestId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "requestId 不能为空"})
		return
	}

	if err := process.ApproveDevice(req.RequestId); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "设备批准成功"})
}

func (s *Server) getOpenClawStatus(c *gin.Context) {
	status, err := process.GetStructuredStatus(s.cfg.HealthPort)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	status.InstalledAt = utils.GetSetting("first_run_at", "未知")
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

func (s *Server) runAsyncCommand(c *gin.Context, taskName string, args ...string) {
	taskID := fmt.Sprintf("task-%d", time.Now().UnixNano())
	process.RegisterTask(taskID, taskName)

	go func() {
		_, err := process.RunCommandWithTimeout(60*time.Second, "openclaw", args...)
		if err != nil {
			process.UpdateTaskStatus(taskID, process.TaskStatusFailed, err.Error())
		} else {
			process.UpdateTaskStatus(taskID, process.TaskStatusCompleted, "")
		}
	}()

	c.JSON(http.StatusAccepted, gin.H{
		"message": "Command accepted and running in background",
		"taskID":  taskID,
		"command": "openclaw " + strings.Join(args, " "),
	})
}

func (s *Server) startGateway(c *gin.Context) {
	s.runAsyncCommand(c, "启动网关", "gateway", "start")
}

func (s *Server) stopGateway(c *gin.Context) {
	taskID := fmt.Sprintf("task-%d", time.Now().UnixNano())
	process.RegisterTask(taskID, "停止网关")

	go func() {
		err := process.StopGateway(s.cfg.HealthPort)
		if err != nil {
			process.UpdateTaskStatus(taskID, process.TaskStatusFailed, err.Error())
		} else {
			process.UpdateTaskStatus(taskID, process.TaskStatusCompleted, "")
		}
	}()

	c.JSON(http.StatusAccepted, gin.H{
		"message": "Stop command initiated with force fallback",
		"taskID":  taskID,
	})
}

func (s *Server) restartGateway(c *gin.Context) {
	taskID := fmt.Sprintf("task-%d", time.Now().UnixNano())
	process.RegisterTask(taskID, "重启网关")

	go func() {
		err := process.RestartGateway(s.cfg.HealthPort)
		if err != nil {
			process.UpdateTaskStatus(taskID, process.TaskStatusFailed, err.Error())
		} else {
			process.UpdateTaskStatus(taskID, process.TaskStatusCompleted, "")
		}
	}()

	c.JSON(http.StatusAccepted, gin.H{
		"message": "Restart command initiated (Stop + Start)",
		"taskID":  taskID,
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

func (s *Server) getSelfHealingSetting(c *gin.Context) {
	enabled := utils.GetSetting("self_healing_enabled", "false")
	c.JSON(http.StatusOK, gin.H{"enabled": enabled == "true"})
}

func (s *Server) updateSelfHealingSetting(c *gin.Context) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	val := "false"
	if req.Enabled {
		val = "true"
	}

	if err := utils.SetSetting("self_healing_enabled", val); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"status": "success", "enabled": req.Enabled})
}

func (s *Server) getHealEvents(c *gin.Context) {
	rows, err := utils.DB.Query(`
		SELECT id, timestamp, reason, method, result, report_path 
		FROM heal_events 
		ORDER BY timestamp DESC 
		LIMIT 50
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type HealEvent struct {
		ID         int    `json:"id"`
		Timestamp  string `json:"timestamp"`
		Reason     string `json:"reason"`
		Method     string `json:"method"`
		Result     string `json:"result"`
		ReportPath string `json:"report_path"`
	}

	events := []HealEvent{}
	for rows.Next() {
		var ev HealEvent
		if err := rows.Scan(&ev.ID, &ev.Timestamp, &ev.Reason, &ev.Method, &ev.Result, &ev.ReportPath); err != nil {
			continue
		}
		events = append(events, ev)
	}

	c.JSON(http.StatusOK, events)
}

func (s *Server) installWeChatPlugin(c *gin.Context) {
	taskID := fmt.Sprintf("task-%d", time.Now().UnixNano())
	process.RegisterTask(taskID, "安装微信插件")

	go func() {
		err := process.InstallWeChatPlugin()
		if err != nil {
			process.UpdateTaskStatus(taskID, process.TaskStatusFailed, err.Error())
		} else {
			process.UpdateTaskStatus(taskID, process.TaskStatusCompleted, "")
		}
	}()

	c.JSON(http.StatusAccepted, gin.H{
		"message": "Installation started",
		"taskID":  taskID,
	})
}

func (s *Server) getTasksStatus(c *gin.Context) {
	c.JSON(http.StatusOK, process.GetAllTasks())
}

func (s *Server) checkWeChatPlugin(c *gin.Context) {
	status, err := process.GetWeChatPluginStatus()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, status)
}
