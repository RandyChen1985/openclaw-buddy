package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

// APIResponse 统一业务响应格式
type APIResponse struct {
	Code    int         `json:"code"`
	Message string      `json:"message"`
	Data    interface{} `json:"data,omitempty"`
}

// Success 返回标准成功响应
func (s *Server) Success(c *gin.Context, data interface{}) {
	c.JSON(http.StatusOK, APIResponse{
		Code:    200,
		Message: "success",
		Data:    data,
	})
}

// Error 返回标准错误响应
func (s *Server) Error(c *gin.Context, httpStatus int, msg string) {
	c.JSON(httpStatus, APIResponse{
		Code:    httpStatus,
		Message: msg,
	})
}

func (s *Server) getDashboardURL(c *gin.Context) {
	url, err := process.GetDashboardURL(s.cfg.ExternalDashboardURL)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"url": url})
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

func (s *Server) getOpenClawBotsModels(c *gin.Context) {
	key := "bots_models"
	if c.Query("refresh") == "true" {
		if err := process.SyncKeySingle(key, s.cfg.OpenClawConfigDir); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
	}

	data, updatedAt, err := process.GetCachedData(key)
	if err != nil {
		res, err := process.GetOpenClawBotsModels(s.cfg.OpenClawConfigDir)
		if err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		s.Success(c, gin.H{"data": res, "updated_at": "实时"})
		return
	}
	s.Success(c, gin.H{"data": data, "updated_at": updatedAt})
}

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

	if err := process.ApproveDevice(req.RequestId); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	s.Success(c, gin.H{"message": "设备批准成功"})
}

func (s *Server) getOpenClawStatus(c *gin.Context) {
	status, err := process.GetStructuredStatus(s.cfg.HealthPort)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	status.InstalledAt = utils.GetSetting("first_run_at", "未知")
	s.Success(c, status)
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

	c.JSON(http.StatusAccepted, APIResponse{
		Code:    202,
		Message: "Command accepted and running in background",
		Data: gin.H{
			"taskID":  taskID,
			"command": "openclaw " + strings.Join(args, " "),
		},
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

	c.JSON(http.StatusAccepted, APIResponse{
		Code:    202,
		Message: "Stop command initiated with force fallback",
		Data:    gin.H{"taskID": taskID},
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

	c.JSON(http.StatusAccepted, APIResponse{
		Code:    202,
		Message: "Restart command initiated (Stop + Start)",
		Data:    gin.H{"taskID": taskID},
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

	s.Success(c, stats)
}

func (s *Server) getSelfHealingSetting(c *gin.Context) {
	enabled := utils.GetSetting("self_healing_enabled", "false")
	s.Success(c, gin.H{"enabled": enabled == "true"})
}

func (s *Server) updateSelfHealingSetting(c *gin.Context) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "Invalid request")
		return
	}

	val := "false"
	if req.Enabled {
		val = "true"
	}

	if err := utils.SetSetting("self_healing_enabled", val); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	s.Success(c, gin.H{"enabled": req.Enabled})
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

	s.Success(c, events)
}

func (s *Server) getHealReports(c *gin.Context) {
	files, err := os.ReadDir(s.cfg.ReportDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "无法读取报表目录: "+err.Error())
		return
	}

	reports := []map[string]interface{}{}
	for _, f := range files {
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".md") {
			info, _ := f.Info()
			reports = append(reports, map[string]interface{}{
				"name": f.Name(),
				"size": info.Size(),
				"time": info.ModTime().Format("2006-01-02 15:04:05"),
			})
		}
	}

	// 按时间倒序
	sort.Slice(reports, func(i, j int) bool {
		return reports[i]["time"].(string) > reports[j]["time"].(string)
	})

	s.Success(c, reports)
}

func (s *Server) getHealReportDetail(c *gin.Context) {
	name := c.Param("name")
	if name == "" || strings.Contains(name, "..") {
		s.Error(c, http.StatusBadRequest, "无效的报表名称")
		return
	}

	path := filepath.Join(s.cfg.ReportDir, name)
	content, err := os.ReadFile(path)
	if err != nil {
		s.Error(c, http.StatusNotFound, "未找到该报表")
		return
	}

	s.Success(c, gin.H{
		"name":    name,
		"content": string(content),
	})
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

	c.JSON(http.StatusAccepted, APIResponse{
		Code:    202,
		Message: "Installation started",
		Data:    gin.H{"taskID": taskID},
	})
}

func (s *Server) getTasksStatus(c *gin.Context) {
	s.Success(c, process.GetAllTasks())
}

func (s *Server) checkWeChatPlugin(c *gin.Context) {
	status, err := process.GetWeChatPluginStatus()
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, status)
}

func (s *Server) addOpenClawBot(c *gin.Context) {
	var req struct {
		ID        string `json:"id" binding:"required"`
		Model     string `json:"model" binding:"required"`
		Workspace string `json:"workspace"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "参数错误，请检查 ID 和模型是否选填")
		return
	}

	// 校验 ID: 必须是数字、字母或下划线 (建议 xxx_bot)
	if matched, _ := regexp.MatchString(`^[a-zA-Z0-9_]+$`, req.ID); !matched {
		s.Error(c, http.StatusBadRequest, "机器人 ID 只能包含数字、英文或下划线")
		return
	}

	// 执行添加
	if err := process.AddOpenClawBot(req.ID, req.Model, req.Workspace); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	// 成功后强制同步缓存
	if err := process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir); err != nil {
		fmt.Printf("Warning: Failed to sync cache after adding bot: %v\n", err)
	}

	s.Success(c, gin.H{"status": "success", "message": "小龙虾机器人创建成功"})
}

func (s *Server) setOpenClawBotIdentity(c *gin.Context) {
	var req struct {
		ID   string `json:"id" binding:"required"`
		Name string `json:"name" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "参数错误，请检查 ID 和名称是否正确")
		return
	}

	if err := process.SetOpenClawBotIdentity(req.ID, req.Name); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	// 成功后强制同步缓存
	process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)

	s.Success(c, gin.H{"status": "success", "message": "名称修改成功"})
}

func (s *Server) setOpenClawBotModel(c *gin.Context) {
	var req struct {
		ID    string `json:"id" binding:"required"`
		Model string `json:"model" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "参数错误，请检查机器人 ID 和模型 ID 是否正确")
		return
	}

	if err := process.SetOpenClawBotModel(s.cfg.OpenClawConfigDir, req.ID, req.Model); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	// 成功后强制同步缓存
	process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)

	s.Success(c, gin.H{"status": "success", "message": "机器人默认模型修改成功"})
}

func (s *Server) deleteOpenClawBot(c *gin.Context) {
	var req struct {
		ID string `json:"id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "无效的机器人 ID")
		return
	}

	// 安全校验：至少保留一个机器人
	botsData, err := process.GetOpenClawBotsModels(s.cfg.OpenClawConfigDir)
	if err == nil && len(botsData.Bots) <= 1 {
		s.Error(c, http.StatusForbidden, "系统要求至少保留一个机器人，无法移除最后一只小龙虾")
		return
	}

	if err := process.DeleteOpenClawBot(req.ID); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	// 成功后强制同步缓存
	process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)

	s.Success(c, gin.H{"status": "success", "message": "机器人已彻底移除"})
}

func (s *Server) setDefaultModel(c *gin.Context) {
	var req struct {
		ModelID string `json:"modelId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "无效的模型 ID")
		return
	}

	if err := process.SetOpenClawDefaultModel(req.ModelID); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	// 同步缓存
	process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)

	s.Success(c, gin.H{"status": "success", "message": "全局默认模型已更新"})
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
	// body["user"] = "lobster" // 固定写这个用户



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
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"enabled": gw.HTTP.Endpoints.ChatCompletions.Enabled})
}

func (s *Server) enableChat(c *gin.Context) {
	err := process.EnableChatCompletions(s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success", "message": "聊天功能已在配置中开启，请重启网关以生效"})
}

func (s *Server) getQuickCommands(c *gin.Context) {
	rows, err := utils.DB.Query("SELECT id, label, prompt, icon, is_system FROM quick_commands ORDER BY created_at ASC")
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	commands := []gin.H{}
	for rows.Next() {
		var id, isSystem int
		var label, prompt, icon string
		if err := rows.Scan(&id, &label, &prompt, &icon, &isSystem); err != nil {
			continue
		}
		commands = append(commands, gin.H{
			"id":        id,
			"label":     label,
			"prompt":    prompt,
			"icon":      icon,
			"is_system": isSystem == 1,
		})
	}
	s.Success(c, commands)
}

func (s *Server) addQuickCommand(c *gin.Context) {
	var req struct {
		Label  string `json:"label" binding:"required"`
		Prompt string `json:"prompt" binding:"required"`
		Icon   string `json:"icon"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	res, err := utils.DB.Exec("INSERT INTO quick_commands (label, prompt, icon) VALUES (?, ?, ?)",
		req.Label, req.Prompt, req.Icon)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	id, _ := res.LastInsertId()
	s.Success(c, gin.H{"id": id, "status": "success"})
}

func (s *Server) deleteQuickCommand(c *gin.Context) {
	id := c.Param("id")
	// 检查是否为系统内置
	var isSystem int
	err := utils.DB.QueryRow("SELECT is_system FROM quick_commands WHERE id = ?", id).Scan(&isSystem)
	if err == nil && isSystem == 1 {
		s.Error(c, http.StatusForbidden, "内置指令不允许删除")
		return
	}

	_, err = utils.DB.Exec("DELETE FROM quick_commands WHERE id = ?", id)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success"})
}

func (s *Server) getOpenClawSkills(c *gin.Context) {
	refresh := c.Query("refresh") == "true"
	if refresh {
		if err := process.SyncKeySingle("skills", s.cfg.OpenClawConfigDir); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
	}

	data, updatedAt, err := process.GetCachedData("skills")
	if err != nil {
		// 如果缓存没有，尝试同步一次
		if err := process.SyncKeySingle("skills", s.cfg.OpenClawConfigDir); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		data, updatedAt, _ = process.GetCachedData("skills")
	}

	s.Success(c, gin.H{
		"data":       data,
		"updated_at": updatedAt,
	})
}

func (s *Server) uninstallSkill(c *gin.Context) {
	name := c.Param("name")
	if name == "" {
		s.Error(c, http.StatusBadRequest, "skill name is required")
		return
	}

	if err := process.UninstallOpenClawSkill(name); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	// 自动清理缓存，让下一次获取触发同步
	process.SyncKeySingle("skills", s.cfg.OpenClawConfigDir)

	s.Success(c, gin.H{"status": "success", "message": "技能卸载成功"})
}

func (s *Server) reloadSkills(c *gin.Context) {
	if err := process.ReloadOpenClawSkills(); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	// 重新加载后清理缓存，确保列表是最新的
	process.SyncKeySingle("skills", s.cfg.OpenClawConfigDir)

	s.Success(c, gin.H{"status": "success", "message": "规则与技能已重新加载"})
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

func (s *Server) getOpenClawModelsConfig(c *gin.Context) {
	providers, err := process.GetOpenClawModelsConfig(s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, providers)
}

func (s *Server) addOpenClawProvider(c *gin.Context) {
	var req struct {
		Name   string                 `json:"name" binding:"required"`
		Config map[string]interface{} `json:"config" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "参数错误，请提供名称和配置信息")
		return
	}

	if err := process.AddOpenClawProvider(s.cfg.OpenClawConfigDir, req.Name, req.Config); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	s.Success(c, gin.H{"status": "success", "message": "提供商已成功添加/更新"})
}

func (s *Server) addOpenClawModelToProvider(c *gin.Context) {
	// 读取原始 body 用于调试
	bodyBytes, _ := io.ReadAll(c.Request.Body)
	c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes)) // 写回 body 供后续绑定使用

	var req struct {
		ProviderName string                 `json:"provider_name"`
		ModelConfig  map[string]interface{} `json:"model_config"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		fmt.Printf("❌ [ModelAdd] JSON Bind Error: %v | Body: %s\n", err, string(bodyBytes))
		s.Error(c, http.StatusBadRequest, "JSON 格式错误: "+err.Error())
		return
	}

	// 手动校验
	if req.ProviderName == "" || req.ModelConfig == nil {
		fmt.Printf("❌ [ModelAdd] Missing Fields | Provider: '%s', ConfigExist: %v | Body: %s\n",
			req.ProviderName, req.ModelConfig != nil, string(bodyBytes))
		s.Error(c, http.StatusBadRequest, "参数缺失：请确保选择了提供商并填写了模型配置")
		return
	}

	if err := process.AddOpenClawModelToProvider(s.cfg.OpenClawConfigDir, req.ProviderName, req.ModelConfig); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	// 成功后强制同步 bots_models 缓存，让前端能刷出新模型
	process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)

	s.Success(c, gin.H{"status": "success", "message": "模型已成功添加至提供商"})
}

func (s *Server) deleteOpenClawModelFromProvider(c *gin.Context) {
	var req struct {
		ProviderName string `json:"provider_name" binding:"required"`
		ModelID      string `json:"model_id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "参数错误，请提供提供商名称和模型ID")
		return
	}

	if err := process.DeleteOpenClawModelFromProvider(s.cfg.OpenClawConfigDir, req.ProviderName, req.ModelID); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	// 成功后强制同步 bots_models 缓存
	process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)

	s.Success(c, gin.H{"status": "success", "message": "模型已成功从提供商移除"})
}

func (s *Server) testOpenClawModelDirect(c *gin.Context) {
	var req struct {
		ProviderName string `json:"providerName" binding:"required"`
		ModelID      string `json:"modelId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "参数错误")
		return
	}

	// 1. 获取模型配置
	providers, err := process.GetOpenClawModelsConfig(s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "无法加载模型配置: "+err.Error())
		return
	}

	rawProv, ok := providers[req.ProviderName].(map[string]interface{})
	if !ok {
		s.Error(c, http.StatusNotFound, "找不到提供商: "+req.ProviderName)
		return
	}

	baseUrl, _ := rawProv["baseUrl"].(string)
	apiKey, _ := rawProv["apiKey"].(string)

	if baseUrl == "" {
		s.Error(c, http.StatusBadRequest, "提供商未配置 baseUrl")
		return
	}

	// 2. 准备请求
	testUrl := strings.TrimSuffix(baseUrl, "/")
	if !strings.HasSuffix(testUrl, "/chat/completions") {
		testUrl += "/chat/completions"
	}

	testBody := map[string]interface{}{
		"model":    req.ModelID,
		"messages": []map[string]string{{"role": "user", "content": "hello"}},
		"stream":   true,
	}
	jsonBody, _ := json.Marshal(testBody)

	httpReq, err := http.NewRequest("POST", testUrl, bytes.NewBuffer(jsonBody))
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "创建测试请求失败: "+err.Error())
		return
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}

	// 3. 执行测试计时
	startTime := time.Now()
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		s.Error(c, http.StatusBadGateway, "直连提供商失败: "+err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		s.Error(c, resp.StatusCode, fmt.Sprintf("AI提供商响应异常 (%d): %s", resp.StatusCode, string(body)))
		return
	}

	// 监听首个字节
	buf := make([]byte, 1)
	_, err = resp.Body.Read(buf)
	duration := time.Since(startTime).Milliseconds()

	// 即使因为流未结束报错 EOF，也说明握手成功且有响应
	if err != nil && err != io.EOF {
		fmt.Printf("⚠️  [TestDirect] Stream read error: %v\n", err)
	}

	s.Success(c, gin.H{
		"latency": duration,
		"status":  "success",
	})
}
