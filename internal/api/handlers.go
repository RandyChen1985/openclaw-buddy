package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"regexp"
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

func (s *Server) addOpenClawBot(c *gin.Context) {
	var req struct {
		ID        string `json:"id" binding:"required"`
		Model     string `json:"model" binding:"required"`
		Workspace string `json:"workspace"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误，请检查 ID 和模型是否选填"})
		return
	}

	// 校验 ID: 必须是数字、字母或下划线 (建议 xxx_bot)
	if matched, _ := regexp.MatchString(`^[a-zA-Z0-9_]+$`, req.ID); !matched {
		c.JSON(http.StatusBadRequest, gin.H{"error": "机器人 ID 只能包含数字、英文或下划线"})
		return
	}

	// 执行添加
	if err := process.AddOpenClawBot(req.ID, req.Model, req.Workspace); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 成功后强制同步缓存
	if err := process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir); err != nil {
		fmt.Printf("Warning: Failed to sync cache after adding bot: %v\n", err)
	}

	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "小龙虾机器人创建成功"})
}

func (s *Server) setOpenClawBotIdentity(c *gin.Context) {
	var req struct {
		ID   string `json:"id" binding:"required"`
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "参数错误，请检查 ID 和名称是否正确"})
		return
	}

	if err := process.SetOpenClawBotIdentity(req.ID, req.Name); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 成功后强制同步缓存
	process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)

	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "名称修改成功"})
}

func (s *Server) deleteOpenClawBot(c *gin.Context) {
	var req struct {
		ID string `json:"id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的机器人 ID"})
		return
	}

	// 安全校验：至少保留一个机器人
	botsData, err := process.GetOpenClawBotsModels(s.cfg.OpenClawConfigDir)
	if err == nil && len(botsData.Bots) <= 1 {
		c.JSON(http.StatusForbidden, gin.H{"error": "系统要求至少保留一个机器人，无法移除最后一只小龙虾"})
		return
	}

	if err := process.DeleteOpenClawBot(req.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 成功后强制同步缓存
	process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)

	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "机器人已彻底移除"})
}

func (s *Server) setDefaultModel(c *gin.Context) {
	var req struct {
		ModelID string `json:"modelId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的模型 ID"})
		return
	}

	if err := process.SetOpenClawDefaultModel(req.ModelID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 同步缓存
	process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)

	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "全局默认模型已更新"})
}

func (s *Server) chatProxy(c *gin.Context) {
	// 1. 获取网关配置
	gw, err := process.GetOpenClawGatewayConfig(s.cfg.OpenClawConfigDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "无法读取 OpenClaw 网关配置: " + err.Error()})
		return
	}

	// 2. 准备请求到本地网关
	url := fmt.Sprintf("http://127.0.0.1:%d/v1/chat/completions", gw.Port)

	// 读取原始请求体
	var body map[string]interface{}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求体"})
		return
	}
	body["user"] = "lobster" // 固定写这个用户

	jsonBody, _ := json.Marshal(body)
	req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonBody))
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "创建请求失败"})
		return
	}

	// 3. 设置头部
	req.Header.Set("Authorization", "Bearer "+gw.Auth.Token)
	req.Header.Set("Content-Type", "application/json")
	if stream, ok := body["stream"].(bool); ok && stream {
		req.Header.Set("Accept", "text/event-stream")
	}

	// 4. 执行请求
	startTime := time.Now()
	client := &http.Client{}
	resp, err := client.Do(req)
	duration := time.Since(startTime).Milliseconds()

	// 准备日志基础数据
	model, _ := body["model"].(string)
	msgs, _ := body["messages"].([]interface{})
	msgCount := len(msgs)
	isStream, _ := body["stream"].(bool)
	nowStr := time.Now().Format("2006/01/02 15:04:05")

	if err != nil {
		fmt.Printf("%s ❌ [Chat] Error: Model=%s, Duration=%dms, Error=%v\n", nowStr, model, duration, err)
		c.JSON(http.StatusBadGateway, gin.H{"error": "无法连接到 OpenClaw 网关: " + err.Error()})
		return
	}
	defer resp.Body.Close()

	fmt.Printf("%s ✅ [Chat] Request: Model=%s, Msgs=%d, Stream=%v, Latency=%dms, Status=%d\n", 
		nowStr, model, msgCount, isStream, duration, resp.StatusCode)
	// 处理流式响应
	if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") {
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache")
		c.Header("Connection", "keep-alive")
		c.Header("Transfer-Encoding", "chunked")
		c.Stream(func(w io.Writer) bool {
			_, err := io.Copy(w, resp.Body)
			return err == nil
		})
		return
	}

	// 非流式响应
	for k, vv := range resp.Header {
		for _, v := range vv {
			c.Header(k, v)
		}
	}
	c.Status(resp.StatusCode)
	io.Copy(c.Writer, resp.Body)
}

func (s *Server) getChatStatus(c *gin.Context) {
	gw, err := process.GetOpenClawGatewayConfig(s.cfg.OpenClawConfigDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"enabled": gw.HTTP.Endpoints.ChatCompletions.Enabled})
}

func (s *Server) enableChat(c *gin.Context) {
	err := process.EnableChatCompletions(s.cfg.OpenClawConfigDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "success", "message": "聊天功能已在配置中开启，请重启网关以生效"})
}
