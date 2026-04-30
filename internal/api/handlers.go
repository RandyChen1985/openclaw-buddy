package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strings"
	"time"
	"openclaw-buddy/internal/config"
	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/utils"
	"openclaw-buddy/internal/scheduler"
	"openclaw-buddy/internal/analyzer"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"

	"github.com/gin-gonic/gin"
	"context"
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

func (s *Server) handleGetTicket(c *gin.Context) {
	ticket := s.tickets.Generate()
	s.Success(c, gin.H{"ticket": ticket, "expires_in": 60})
}

func (s *Server) getDashboardURL(c *gin.Context) {
	// 传入 Request Context，实现前端请求中止时的后端子进程级联取消
	url, err := process.GetDashboardURL(c.Request.Context(), s.cfg.ExternalDashboardURL)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"url": url})
}

func (s *Server) proxyLobsterDashboard(c *gin.Context) {
	// 额外防线：即使已鉴权，也禁止跨站 Origin 直接调用代理（防止被第三方站点利用）
	if !s.isOriginAllowed(c.Request, c.GetHeader("Origin")) {
		s.Error(c, http.StatusForbidden, "Forbidden origin")
		return
	}

	targetPort := s.cfg.HealthPort
	targetURL, _ := url.Parse(fmt.Sprintf("http://127.0.0.1:%d", targetPort))

	proxy := httputil.NewSingleHostReverseProxy(targetURL)

	// 修改响应头以允许嵌入
	proxy.ModifyResponse = func(res *http.Response) error {
		// 不再无条件移除 CSP（风险较高），仅移除会强制禁止 iframe 的 XFO
		res.Header.Del("X-Frame-Options")
		return nil
	}

	// 统一处理路径：动态剥离前缀 (WebRoot + /v1/proxy)
	prefix := s.cfg.WebRoot
	if prefix == "/" {
		prefix = ""
	}
	fullPrefix := prefix + "/v1/proxy"
	
	c.Request.URL.Path = strings.TrimPrefix(c.Request.URL.Path, fullPrefix)
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

	log.Printf("🎮 [控制] 用户请求: 【批准设备接入】 (RequestID: %s)", req.RequestId)
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

// getGatewayToken 返回 OpenClaw Gateway 的认证 Token，供前端 V3 WebSocket 握手使用
func (s *Server) getGatewayToken(c *gin.Context) {
	gw, err := process.GetOpenClawGatewayConfig(s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "failed to read gateway config: "+err.Error())
		return
	}
	s.Success(c, gin.H{"token": gw.Auth.Token})
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

func (s *Server) runAsyncTask(c *gin.Context, task *process.Task, run func() (string, error)) {
	// 默认使用普通优先级，除非明确指定（如网关操作）
	s.runAsyncTaskWithPriority(c, task, scheduler.PriorityNormal, run)
}

func (s *Server) runAsyncTaskWithPriority(c *gin.Context, task *process.Task, priority scheduler.Priority, run func() (string, error)) {
	// 在串行模式下，RegisterTask 仅负责登记任务开始
	if err := process.RegisterTask(task); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	// 提交到调度器排队执行
	scheduler.GetScheduler().Submit(scheduler.TaskRequest{
		Task:     task,
		Execute:  func(_ context.Context) (string, error) { return run() },
		Priority: priority,
	})

	c.JSON(http.StatusAccepted, APIResponse{
		Code:    202,
		Message: "Task accepted and queued",
		Data: gin.H{
			"taskID": task.ID,
		},
	})
}

func (s *Server) startGateway(c *gin.Context) {
	log.Printf("🎮 [控制] 用户请求: 【启动网关】")
	utils.RecordSystemEvent("CONTROL", "用户手动请求【启动网关】")
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.start_gateway",
		Module: "gateway",
		Action: "start",
	}
	s.runAsyncTaskWithPriority(c, task, scheduler.PriorityHigh, func() (string, error) {
		res, err := process.RunCommandWithTimeout(60*time.Second, "openclaw", "gateway", "start")
		if err != nil {
			return "", err
		}
		return res.Output, nil
	})
}

func (s *Server) stopGateway(c *gin.Context) {
	log.Printf("🎮 [控制] 用户请求: 【停止网关】")
	utils.RecordSystemEvent("CONTROL", "用户手动请求【停止网关】")
	task := &process.Task{
		ID:      fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:    "tasks.stop_gateway",
		Module:  "gateway",
		Action:  "stop",
		Command: "openclaw gateway stop",
	}
	s.runAsyncTaskWithPriority(c, task, scheduler.PriorityHigh, func() (string, error) {
		err := process.StopGateway(s.cfg.HealthPort)
		if err != nil {
			return "", err
		}
		return "tasks.results.stopped", nil
	})
}

func (s *Server) restartGateway(c *gin.Context) {
	log.Printf("🎮 [控制] 用户请求: 【重启网关】")
	utils.RecordSystemEvent("CONTROL", "用户手动请求【重启网关】")
	task := &process.Task{
		ID:      fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:    "tasks.restart_gateway",
		Module:  "gateway",
		Action:  "restart",
		Command: "openclaw gateway restart",
	}
	s.runAsyncTaskWithPriority(c, task, scheduler.PriorityHigh, func() (string, error) {
		err := process.RestartGateway(s.cfg.HealthPort)
		if err != nil {
			return "", err
		}
		return "tasks.results.restarted", nil
	})
}

func (s *Server) getHealthStats(c *gin.Context) {
	rows, err := utils.DB.Query(`
		SELECT timestamp, status, response_time_ms, cpu_usage, mem_usage
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
		Timestamp      string  `json:"timestamp"`
		Status         string  `json:"status"`
		ResponseTimeMS int     `json:"response_time_ms"`
		CPUUsage       float64 `json:"cpu_usage"`
		MemoryUsage    float64 `json:"memory_usage"`
	}

	stats := []HealthStat{}
	for rows.Next() {
		var st HealthStat
		var cpu, mem utils.NullFloat64
		if err := rows.Scan(&st.Timestamp, &st.Status, &st.ResponseTimeMS, &cpu, &mem); err != nil {
			continue
		}
		st.CPUUsage = cpu.Float64
		st.MemoryUsage = mem.Float64
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

	log.Printf("🎮 [控制] 用户请求: 【切换自愈功能】 (Enabled: %v)", req.Enabled)
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
		SELECT id, timestamp, reason, method, result, report_path, verify_retries, verify_duration_ms, verify_error
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
		VerifyRetries    int   `json:"verify_retries"`
		VerifyDurationMS int64 `json:"verify_duration_ms"`
		VerifyError      string `json:"verify_error"`
	}

	events := []HealEvent{}
	for rows.Next() {
		var ev HealEvent
		if err := rows.Scan(&ev.ID, &ev.Timestamp, &ev.Reason, &ev.Method, &ev.Result, &ev.ReportPath, &ev.VerifyRetries, &ev.VerifyDurationMS, &ev.VerifyError); err != nil {
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

func (s *Server) getHealBackups(c *gin.Context) {
	files, err := os.ReadDir(s.cfg.BackupDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "无法读取备份目录: "+err.Error())
		return
	}

	backups := []map[string]interface{}{}
	for _, f := range files {
		// 备份文件以 .bak 结尾
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".bak") {
			info, _ := f.Info()
			backups = append(backups, map[string]interface{}{
				"name": f.Name(),
				"size": info.Size(),
				"time": info.ModTime().Format("2006-01-02 15:04:05"),
			})
		}
	}

	// 按时间倒序
	sort.Slice(backups, func(i, j int) bool {
		return backups[i]["time"].(string) > backups[j]["time"].(string)
	})

	s.Success(c, backups)
}

func (s *Server) getHealBackupDetail(c *gin.Context) {
	name := c.Param("name")
	if name == "" || strings.Contains(name, "..") {
		s.Error(c, http.StatusBadRequest, "无效的备份名称")
		return
	}

	path := filepath.Join(s.cfg.BackupDir, name)
	content, err := os.ReadFile(path)
	if err != nil {
		s.Error(c, http.StatusNotFound, "未找到该备份文件")
		return
	}

	s.Success(c, gin.H{
		"name":    name,
		"content": string(content),
	})
}

func (s *Server) getHealBackupDiff(c *gin.Context) {
	name := c.Param("name")
	if name == "" || strings.Contains(name, "..") {
		s.Error(c, http.StatusBadRequest, "无效的备份名称")
		return
	}

	backupPath := filepath.Join(s.cfg.BackupDir, name)
	currentConfigPath := filepath.Join(s.cfg.OpenClawConfigDir, "openclaw.json")

	// 使用 analyzer 中的通用对比逻辑
	diff, err := analyzer.GetDiff(backupPath, currentConfigPath)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "生成对比失败: "+err.Error())
		return
	}

	s.Success(c, gin.H{
		"name": name,
		"diff": diff,
	})
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

func (s *Server) getTasksStatus(c *gin.Context) {
	s.Success(c, process.GetAllTasks())
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

	log.Printf("🎮 [控制] 用户请求: 【添加机器人】 (ID: %s, Model: %s)", req.ID, req.Model)
	utils.RecordSystemEvent("CONTROL", fmt.Sprintf("用户手动请求 【添加机器人】 (ID: %s, 模型: %s)", req.ID, req.Model))
	// 校验 ID: 必须是数字、字母或下划线 (建议 xxx_bot)
	if matched, _ := regexp.MatchString(`^[a-zA-Z0-9_]+$`, req.ID); !matched {
		s.Error(c, http.StatusBadRequest, "机器人 ID 只能包含数字、英文或下划线")
		return
	}

	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.add_bot:" + req.ID,
		Module: "bots",
		Action: "add",
		Target: req.ID,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.AddOpenClawBot(req.ID, req.Model, req.Workspace); err != nil {
			return "", err
		}
		// 成功后强制同步缓存
		_ = process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)
		return "tasks.results.created", nil
	})
}

func (s *Server) updateOpenClawBot(c *gin.Context) {
	var req struct {
		ID    string  `json:"id" binding:"required"`
		Name  *string `json:"name"`
		Model *string `json:"model"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "参数错误")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【更新机器人配置】 (ID: %s)", req.ID)
	utils.RecordSystemEvent("CONTROL", fmt.Sprintf("用户手动请求 【更新机器人配置】 (ID: %s)", req.ID))

	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.update_bot:" + req.ID,
		Module: "bots",
		Action: "update",
		Target: req.ID,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.UpdateOpenClawBotConfig(s.cfg.OpenClawConfigDir, req.ID, req.Name, req.Model); err != nil {
			return "", err
		}
		// 成功后强制同步缓存
		_ = process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)
		return "tasks.results.updated", nil
	})
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

	log.Printf("🎮 [控制] 用户请求: 【修改机器人名称】 (ID: %s, Name: %s)", req.ID, req.Name)
	utils.RecordSystemEvent("CONTROL", fmt.Sprintf("用户手动请求 【修改机器人名称】 (ID: %s -> %s)", req.ID, req.Name))
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.set_identity:" + req.ID,
		Module: "bots",
		Action: "set-identity",
		Target: req.ID,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.UpdateOpenClawBotConfig(s.cfg.OpenClawConfigDir, req.ID, &req.Name, nil); err != nil {
			return "", err
		}
		// 成功后强制同步缓存
		_ = process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)
		return "tasks.results.identity_updated", nil
	})
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

	log.Printf("🎮 [控制] 用户请求: 【切换机器人模型】 (ID: %s, Model: %s)", req.ID, req.Model)
	utils.RecordSystemEvent("CONTROL", fmt.Sprintf("用户手动请求 【切换机器人模型】 (机器人: %s, 模型: %s)", req.ID, req.Model))
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.set_model:" + req.ID,
		Module: "bots",
		Action: "set-model",
		Target: req.ID,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.SetOpenClawBotModel(s.cfg.OpenClawConfigDir, req.ID, req.Model); err != nil {
			return "", err
		}
		// 成功后强制同步缓存
		_ = process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)
		return "tasks.results.model_updated", nil
	})
}

func (s *Server) deleteOpenClawBot(c *gin.Context) {
	var req struct {
		ID string `json:"id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "无效的机器人 ID")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【删除机器人】 (ID: %s)", req.ID)
	utils.RecordSystemEvent("CONTROL", fmt.Sprintf("用户手动请求 【删除机器人】 (ID: %s)", req.ID))
	// 安全校验：至少保留一个机器人 (同步检查，防止产生无效任务)
	botsData, err := process.GetOpenClawBotsModels(s.cfg.OpenClawConfigDir)
	if err == nil && len(botsData.Bots) <= 1 {
		s.Error(c, http.StatusForbidden, "系统要求至少保留一个机器人，无法移除最后一只小龙虾")
		return
	}

	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.delete_bot:" + req.ID,
		Module: "bots",
		Action: "delete",
		Target: req.ID,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.DeleteOpenClawBot(req.ID); err != nil {
			return "", err
		}
		// 成功后强制同步缓存
		_ = process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)
		return "tasks.results.removed", nil
	})
}

func (s *Server) setDefaultModel(c *gin.Context) {
	var req struct {
		ModelID string `json:"modelId" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "无效的模型 ID")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【设置全局默认模型】 (ModelID: %s)", req.ModelID)
	utils.RecordSystemEvent("CONTROL", fmt.Sprintf("用户手动请求 【设置全局默认模型】 (模型: %s)", req.ModelID))
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.set_default_model:" + req.ModelID,
		Module: "bots",
		Action: "set-default-model",
		Target: req.ModelID,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.SetOpenClawDefaultModel(req.ModelID); err != nil {
			return "", err
		}
		// 同步缓存
		_ = process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)
		return "tasks.results.default_model_updated", nil
	})
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

	// 4. 执行请求 (增加 6 分钟显式超时保护)
	startTime := time.Now()
	
	// 设置带超时的上下文，防止后端网关长时间挂起占用资源
	ctx, cancel := context.WithTimeout(c.Request.Context(), 6*time.Minute)
	defer cancel()
	
	req = req.WithContext(ctx)
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
	
	// 5. 处理流式响应 (WAF 穿透增强)
	if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") || isStream {
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache, no-transform") // 核心：禁止中间缓存和压缩
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no") // 核心：专门针对 Nginx/WAF 的非缓冲指令
		
		c.Stream(func(w io.Writer) bool {
			// 使用带 Flush 功能的 Writer 确保实时性
			reader := resp.Body
			buffer := make([]byte, 1024)
			for {
				n, err := reader.Read(buffer)
				if n > 0 {
					_, writeErr := w.Write(buffer[:n])
					if writeErr != nil {
						return false // 客户端断开，退出流
					}
					// Gin 的 c.Stream 会在每次循环后自动调用 Flush，
					// 但为了极端情况下的平滑度，手动 Read 确保了更细粒度的控制。
					return true 
				}
				if err != nil {
					return false // 读取结束或出错
				}
			}
		})
		return
	}

	// 6. 处理非流式响应
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
	log.Printf("🎮 [控制] 用户请求: 【一键开启聊天功能】")
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

	log.Printf("🎮 [控制] 用户请求: 【新增快捷指令】 (Label: %s)", req.Label)
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
	log.Printf("🎮 [控制] 用户请求: 【删除快捷指令】 (ID: %s)", id)
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

	log.Printf("🎮 [控制] 用户请求: 【卸载技能/插件】 (Name: %s)", name)
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.uninstall_plugin:" + name,
		Module: "skills",
		Action: "delete-skill",
		Target: name,
	}
	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.UninstallOpenClawSkill(name); err != nil {
			return "", err
		}
		// 自动清理缓存，让下一次获取触发同步
		process.SyncKeySingle("skills", s.cfg.OpenClawConfigDir)
		return "tasks.results.uninstalled", nil
	})
}

func (s *Server) reloadSkills(c *gin.Context) {
	log.Printf("🎮 [控制] 用户请求: 【重载规则与技能引擎】")
	if err := process.ReloadOpenClawSkills(); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	// 重新加载后清理缓存，确保列表是最新的
	process.SyncKeySingle("skills", s.cfg.OpenClawConfigDir)
	process.SyncKeySingle("plugins", s.cfg.OpenClawConfigDir)

	s.Success(c, gin.H{"status": "success", "message": "规则与技能已重新加载"})
}

func (s *Server) handleGetConfig(c *gin.Context) {
	configPath := filepath.Join(s.cfg.OpenClawConfigDir, "openclaw.json")
	content, err := os.ReadFile(configPath)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "Failed to read openclaw.json: "+err.Error())
		return
	}
	s.Success(c, gin.H{"content": string(content)})
}

func (s *Server) handleUpdateConfig(c *gin.Context) {
	var req struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "Invalid request body")
		return
	}

	configPath := filepath.Join(s.cfg.OpenClawConfigDir, "openclaw.json")
	backupPath := configPath + ".bak.tmp"

	// 1. 备份当前配置
	oldContent, err := os.ReadFile(configPath)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "Failed to backup current config: "+err.Error())
		return
	}
	if err := os.WriteFile(backupPath, oldContent, 0644); err != nil {
		s.Error(c, http.StatusInternalServerError, "Failed to write backup: "+err.Error())
		return
	}
	defer os.Remove(backupPath)

	// 2. 写入新配置
	if err := os.WriteFile(configPath, []byte(req.Content), 0644); err != nil {
		s.Error(c, http.StatusInternalServerError, "Failed to update config: "+err.Error())
		return
	}

	// 3. 校验新配置 (深度 Check)
	isValid, problem, _ := process.CheckConfig(s.cfg.OpenClawConfigDir)
	if !isValid {
		// 校验失败，回滚
		_ = os.WriteFile(configPath, oldContent, 0644)
		s.Error(c, http.StatusBadRequest, "Configuration validation failed: "+problem)
		return
	}

	// 校验成功
	utils.RecordSystemEvent("CONFIG", "用户通过 Web 控制台手动更新了核心配置 openclaw.json")
	s.Success(c, nil)
}

func (s *Server) handleValidateConfig(c *gin.Context) {
	var req struct {
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "Invalid request body")
		return
	}

	// 1. 创建临时目录进行隔离校验 (避免污染真实运行路径)
	tmpDir, err := os.MkdirTemp("", "openclaw-config-val-*")
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "Failed to create temp dir: "+err.Error())
		return
	}
	defer os.RemoveAll(tmpDir)

	// 补丁：为了让校验器支持“深度校验”(如识别渠道插件)，需要把真实配置目录的内容软链接过来
	// 但排除掉 openclaw.json 本身，我们将使用待校验的内容
	if s.cfg.OpenClawConfigDir != "" {
		absSrc, _ := filepath.Abs(s.cfg.OpenClawConfigDir)
		entries, _ := os.ReadDir(absSrc)
		for _, entry := range entries {
			name := entry.Name()
			if name == "openclaw.json" {
				continue
			}
			srcPath := filepath.Join(absSrc, name)
			dstPath := filepath.Join(tmpDir, name)
			// 创建软链接，让临时目录拥有完整的上下文环境
			_ = os.Symlink(srcPath, dstPath)
		}
	}

	// 2. 写入待校验的配置
	tmpConfigPath := filepath.Join(tmpDir, "openclaw.json")
	if err := os.WriteFile(tmpConfigPath, []byte(req.Content), 0644); err != nil {
		s.Error(c, http.StatusInternalServerError, "Failed to write temp config: "+err.Error())
		return
	}

	// 3. 调用底座校验
	isValid, problem, _ := process.CheckConfig(tmpDir)
	if !isValid {
		s.Error(c, http.StatusBadRequest, "Configuration validation failed: "+problem)
		return
	}

	s.Success(c, gin.H{"message": "Configuration is valid"})
}

func (s *Server) handleRunDoctor(c *gin.Context) {
	output, err := process.RunDoctorFixWithOutput()
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "Doctor fix failed: "+err.Error()+"\n\nOutput:\n"+output)
		return
	}
	utils.RecordSystemEvent("HEAL", "用户手动执行了一键体检修复 (Doctor Fix)")
	s.Success(c, gin.H{"output": output})
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

func (s *Server) getSecurityStatus(c *gin.Context) {
	refresh := c.Query("refresh") == "true"
	if refresh {
		if err := process.SyncKeySingle("security_status", s.cfg.OpenClawConfigDir); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
	}

	data, updatedAt, err := process.GetCachedData("security_status")
	if err != nil {
		// 如果缓存没有，尝试实时同步一次
		if err := process.SyncKeySingle("security_status", s.cfg.OpenClawConfigDir); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		data, updatedAt, _ = process.GetCachedData("security_status")
	}

	// 将缓存的 map 转换为结构体或直接返回
	s.Success(c, gin.H{
		"data":       data,
		"updated_at": updatedAt,
	})
}

func (s *Server) triggerSecurityTask(c *gin.Context) {
	var req struct {
		Action   string `json:"action" binding:"required"`
		Target   string `json:"target"` // Agent ID or Preset Name
		Pattern  string `json:"pattern"`
		Ask      string `json:"ask"`
		Security string `json:"security"`
		Content  string `json:"content"` // For full set-approvals
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "Invalid request")
		return
	}

	var taskName string
	var taskAction string
	var runFunc func() (string, error)

	switch req.Action {
	case "apply-preset":
		taskName = "tasks.apply_security_preset:" + req.Target
		taskAction = "apply_security_preset"
		runFunc = func() (string, error) {
			if err := process.ApplyExecPreset(req.Target); err != nil {
				return "", err
			}
			return "tasks.results.preset_applied", nil
		}
	case "set-policy":
		taskName = "tasks.update_security_policy"
		taskAction = "update_security_policy"
		runFunc = func() (string, error) {
			if err := process.SetExecPolicy(req.Ask, req.Security); err != nil {
				return "", err
			}
			return "tasks.results.policy_updated", nil
		}
	case "add-allowlist":
		taskName = "tasks.update_allowlist:" + req.Target
		taskAction = "update_allowlist"
		runFunc = func() (string, error) {
			if err := process.AddAllowlistPattern(req.Target, req.Pattern); err != nil {
				return "", err
			}
			return "tasks.results.allowlist_updated", nil
		}
	case "remove-allowlist":
		taskName = "tasks.update_allowlist:" + req.Target
		taskAction = "update_allowlist"
		runFunc = func() (string, error) {
			if err := process.RemoveAllowlistPattern(req.Target, req.Pattern); err != nil {
				return "", err
			}
			return "tasks.results.allowlist_updated", nil
		}
	case "set-approvals":
		taskName = "tasks.set_approvals"
		taskAction = "set_approvals"
		runFunc = func() (string, error) {
			if err := process.SetApprovals(req.Content); err != nil {
				return "", err
			}
			return "tasks.results.approvals_set", nil
		}
	default:
		s.Error(c, http.StatusBadRequest, "Unsupported action: "+req.Action)
		return
	}

	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   taskName,
		Module: "security",
		Action: taskAction,
		Target: req.Target,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		res, err := runFunc()
		if err == nil {
			// 操作成功后立即触发同步，确保缓存与物理状态对齐
			_ = process.SyncKeySingle("security_status", s.cfg.OpenClawConfigDir)
		}
		return res, err
	})
}

// Skill File Management Handlers

func (s *Server) getSkillFilesList(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		s.Error(c, http.StatusBadRequest, "path is required")
		return
	}

	files, err := process.ListSkillResources(path)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"files": files})
}

func (s *Server) getSkillFileContent(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		s.Error(c, http.StatusBadRequest, "path is required")
		return
	}

	content, err := process.ReadSkillResource(path)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"content": content})
}

func (s *Server) saveSkillFileContent(c *gin.Context) {
	var req struct {
		Path    string `json:"path" binding:"required"`
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "path and content are required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【保存技能资源文件】 (Path: %s)", req.Path)
	err := process.SaveSkillResource(req.Path, req.Content)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success"})
}

// Generic File Explorer Handlers

func (s *Server) getExplorerFilesList(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		s.Error(c, http.StatusBadRequest, "path is required")
		return
	}

	files, err := process.ListExplorerFiles(path, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"files": files})
}

func (s *Server) getExplorerFileContent(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		s.Error(c, http.StatusBadRequest, "path is required")
		return
	}

	content, err := process.ReadExplorerFile(path, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"content": content})
}

func (s *Server) saveExplorerFileContent(c *gin.Context) {
	var req struct {
		Path    string `json:"path" binding:"required"`
		Content string `json:"content" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "path and content are required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【保存资源文件】 (Path: %s)", req.Path)
	err := process.WriteExplorerFile(req.Path, req.Content, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success"})
}

func (s *Server) renameExplorerFile(c *gin.Context) {
	var req struct {
		OldPath string `json:"oldPath" binding:"required"`
		NewPath string `json:"newPath" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "oldPath and newPath are required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【重命名/移动文件】 (%s -> %s)", req.OldPath, req.NewPath)
	err := process.RenameExplorerFile(req.OldPath, req.NewPath, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success"})
}

func (s *Server) searchExplorerFiles(c *gin.Context) {
	rootPath := c.Query("path")
	query := c.Query("query")
	if rootPath == "" || query == "" {
		s.Error(c, http.StatusBadRequest, "path and query are required")
		return
	}

	files, err := process.SearchExplorerFiles(rootPath, query, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"files": files})
}

func (s *Server) deleteExplorerFile(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		s.Error(c, http.StatusBadRequest, "path is required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【删除资源文件】 (Path: %s)", path)
	err := process.DeleteExplorerFile(path, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success"})
}

func (s *Server) uploadExplorerFile(c *gin.Context) {
	dirPath := c.PostForm("path")
	if dirPath == "" {
		s.Error(c, http.StatusBadRequest, "path is required")
		return
	}

	file, header, err := c.Request.FormFile("file")
	if err != nil {
		s.Error(c, http.StatusBadRequest, "file is required")
		return
	}
	defer file.Close()

	data := make([]byte, header.Size)
	if _, err := file.Read(data); err != nil {
		s.Error(c, http.StatusInternalServerError, "failed to read file: "+err.Error())
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【上传文件】 (Dir: %s, File: %s)", dirPath, header.Filename)
	destPath, err := process.UploadExplorerFile(dirPath, header.Filename, data, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success", "path": destPath})
}

func (s *Server) downloadExplorerFile(c *gin.Context) {
	path := c.Query("path")
	if path == "" {
		s.Error(c, http.StatusBadRequest, "path is required")
		return
	}

	data, filename, err := process.ReadExplorerFileBytes(path, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	if filename == "" {
		filename = filepath.Base(path)
	}
	if filename == "" || filename == "." {
		filename = "download"
	}

	// 使用 URL 编码文件名以支持中文字符
	escapedFilename := url.PathEscape(filename)
	c.Header("Content-Disposition", fmt.Sprintf("attachment; filename=\"%s\"; filename*=UTF-8''%s", escapedFilename, escapedFilename))
	c.Header("Content-Type", "application/octet-stream")
	c.Header("Content-Length", fmt.Sprintf("%d", len(data)))
	c.Data(http.StatusOK, "application/octet-stream", data)
}

func (s *Server) createExplorerFile(c *gin.Context) {
	var req struct {
		Path     string `json:"path" binding:"required"`
		Filename string `json:"filename" binding:"required"`
		Content  string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "path and filename are required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【新建文件】 (Dir: %s, Name: %s)", req.Path, req.Filename)
	destPath, err := process.CreateExplorerFile(req.Path, req.Filename, req.Content, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success", "path": destPath})
}

func (s *Server) createExplorerDir(c *gin.Context) {
	var req struct {
		Path    string `json:"path" binding:"required"`
		Dirname string `json:"dirname" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "path and dirname are required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【新建文件夹】 (Dir: %s, Name: %s)", req.Path, req.Dirname)
	destPath, err := process.CreateExplorerDir(req.Path, req.Dirname, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success", "path": destPath})
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

	log.Printf("🎮 [控制] 用户请求: 【添加/更新模型提供商】 (Provider: %s)", req.Name)
	
	// 动态检测是【添加】还是【更新】，以优化任务中心日志语义
	taskName := fmt.Sprintf("添加渠道: %s", req.Name)
	if providers, err := process.GetOpenClawModelsConfig(s.cfg.OpenClawConfigDir); err == nil {
		if _, exists := providers[req.Name]; exists {
			taskName = fmt.Sprintf("更新渠道: %s", req.Name)
		}
	}

	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   taskName,
		Module: "bots",
		Action: "add-provider",
		Target: req.Name,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.AddOpenClawProvider(s.cfg.OpenClawConfigDir, req.Name, req.Config); err != nil {
			return "", err
		}
		// 自动刷新模型列表缓存
		_ = process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)
		return "tasks.results.provider_synced", nil
	})
}

func (s *Server) addOpenClawModelToProvider(c *gin.Context) {
	// 读取原始 body 用于调试
	bodyBytes, _ := io.ReadAll(c.Request.Body)
	c.Request.Body = io.NopCloser(bytes.NewBuffer(bodyBytes))

	var req struct {
		ProviderName string                 `json:"providerName" binding:"required"`
		ModelConfig  map[string]interface{} `json:"modelConfig" binding:"required"`
	}
	
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "参数错误，请提供提供商名称和模型配置")
		return
	}

	modelID, _ := req.ModelConfig["id"].(string)
	log.Printf("🎮 [控制] 用户请求: 【向渠道追加/更新模型】 (Provider: %s, ModelID: %s)", req.ProviderName, modelID)
	
	// 动态检测是【追加】还是【更新】
	taskName := fmt.Sprintf("渠道 %s 追加模型: %s", req.ProviderName, modelID)
	if providers, err := process.GetOpenClawModelsConfig(s.cfg.OpenClawConfigDir); err == nil {
		if provider, ok := providers[req.ProviderName].(map[string]interface{}); ok {
			if models, ok := provider["models"].([]interface{}); ok {
				for _, m := range models {
					if modelObj, ok := m.(map[string]interface{}); ok {
						if id, ok := modelObj["id"].(string); ok && id == modelID {
							taskName = fmt.Sprintf("更新渠道 %s 的模型: %s", req.ProviderName, modelID)
							break
						}
					}
				}
			}
		}
	}

	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   taskName,
		Module: "bots",
		Action: "add-model",
		Target: req.ProviderName,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.AddOpenClawModelToProvider(s.cfg.OpenClawConfigDir, req.ProviderName, req.ModelConfig); err != nil {
			return "", err
		}
		// 成功后强制同步 bots_models 缓存
		_ = process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)
		return "tasks.results.model_appended", nil
	})
}

func (s *Server) deleteOpenClawModelFromProvider(c *gin.Context) {
	providerName := c.Param("provider")
	modelID := c.Param("id")
	
	if providerName == "" || modelID == "" {
		s.Error(c, http.StatusBadRequest, "参数错误，请提供提供商名称和模型ID")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【从渠道移除模型】 (Provider: %s, ModelID: %s)", providerName, modelID)
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   fmt.Sprintf("从渠道 %s 移除模型: %s", providerName, modelID),
		Module: "bots",
		Action: "delete-model",
		Target: fmt.Sprintf("%s/%s", providerName, modelID),
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.DeleteOpenClawModelFromProvider(s.cfg.OpenClawConfigDir, providerName, modelID); err != nil {
			return "", err
		}
		// 成功后强制同步 bots_models 缓存
		_ = process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)
		return "tasks.results.model_removed", nil
	})
}

func (s *Server) deleteOpenClawProvider(c *gin.Context) {
	name := c.Param("provider")
	if name == "" {
		s.Error(c, http.StatusBadRequest, "渠道名称是必填项")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【删除模型渠道】 (Provider: %s)", name)
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   fmt.Sprintf("删除渠道: %s", name),
		Module: "bots",
		Action: "delete-provider",
		Target: name,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.DeleteOpenClawProvider(s.cfg.OpenClawConfigDir, name); err != nil {
			return "", err
		}
		// 成功后强制同步 bots_models 缓存
		_ = process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)
		return "tasks.results.provider_removed", nil
	})
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
func (s *Server) getSystemVersion(c *gin.Context) {
	current := strings.TrimPrefix(config.Version, "v")

	// 如果请求带了 refresh=true，则立即触发一次物理对账
	if c.Query("refresh") == "true" && s.guardian != nil {
		log.Printf("🌐 [API] 收到手动版本刷新请求，正在联网对账...")
		s.guardian.CheckVersionUpdate()
	}

	latest := strings.TrimPrefix(utils.GetSetting("latest_version", current), "v")

	s.Success(c, gin.H{
		"current":              current,
		"latest":               latest,
		"release_url":          "https://github.com/RandyChen1985/openclaw-buddy/releases",
		"gui_disable_features": s.cfg.GUIDisableFeatures,
		"show_external_tools":  s.cfg.ShowExternalTools,
	})
}

func (s *Server) handleUpgrade(c *gin.Context) {
	var req struct {
		Version string `json:"version" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "版本号是必填项")
		return
	}

	log.Printf("📥 [系统] 用户请求全自动版本升级: v%s", req.Version)
	utils.RecordSystemEvent("CONTROL", fmt.Sprintf("发起系统升级请求: v%s", req.Version))

	task := &process.Task{
		ID:     fmt.Sprintf("upgrade-%d", time.Now().UnixNano()),
		Name:   "系统版本升级: v" + req.Version,
		Module: "system",
		Action: "upgrade",
		Target: req.Version,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		return process.DownloadAndUpgrade(req.Version, task.ID)
	})
}

func (s *Server) handleRestart(c *gin.Context) {
	log.Printf("📥 [系统] 用户请求全自动静默重启...")
	utils.RecordSystemEvent("CONTROL", "发起系统重启请求")

	// 异步执行重启，给响应留出时间
	err := process.SelfRestart()
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "重启失败: "+err.Error())
		return
	}

	s.Success(c, "服务正在重启，请在 5-10 秒后刷新页面")
}

func (s *Server) getSystemEvents(c *gin.Context) {
	rows, err := utils.DB.Query(`
		SELECT id, timestamp, event_type, message 
		FROM system_events 
		ORDER BY timestamp DESC 
		LIMIT 20
	`)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	type SystemEvent struct {
		ID        int    `json:"id"`
		Timestamp string `json:"timestamp"`
		Type      string `json:"event_type"`
		Message   string `json:"message"`
	}

	events := []SystemEvent{}
	for rows.Next() {
		var ev SystemEvent
		if err := rows.Scan(&ev.ID, &ev.Timestamp, &ev.Type, &ev.Message); err != nil {
			continue
		}
		events = append(events, ev)
	}
	s.Success(c, events)
}

func (s *Server) getTopBots(c *gin.Context) {
	// 1. 优先尝试从缓存获取 (10 分钟自动更新一次)
	data, _, err := process.GetCachedData("ranking")
	if err == nil && data != nil {
		s.Success(c, data)
		return
	}

	// 2. 降级逻辑：如果缓存失效或不存在，执行实时计算并异步存入缓存
	ranks, err := process.GetBotRanking(s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	
	// 异步更新缓存以供下次使用
	go process.SyncKeySingle("ranking", s.cfg.OpenClawConfigDir)
	
	s.Success(c, ranks)
}

func (s *Server) getServerInfo(c *gin.Context) {
	hostname, _ := os.Hostname()
	s.Success(c, gin.H{
		"hostname": hostname,
		"os":       runtime.GOOS,
		"arch":     runtime.GOARCH,
		"cpus":     runtime.NumCPU(),
	})
}

func (s *Server) getOpenClawVersion(c *gin.Context) {
	path, err := exec.LookPath("openclaw")
	if err != nil {
		s.Success(c, gin.H{
			"installed": false,
			"version":   "",
			"path":      "",
			"error":     "openclaw terminal command not found",
		})
		return
	}

	out, err := exec.Command(path, "--version").Output()
	if err != nil {
		// 尝试不带 -- 
		out, err = exec.Command(path, "version").Output()
	}

	version := "Unknown"
	if err == nil {
		version = strings.TrimSpace(string(out))
	}

	s.Success(c, gin.H{
		"installed": true,
		"version":   version,
		"path":      path,
	})
}

func (s *Server) getOpenClawPlugins(c *gin.Context) {
	refresh := c.Query("refresh") == "true"
	if refresh {
		if err := process.SyncKeySingle("plugins", s.cfg.OpenClawConfigDir); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
	}

	data, updatedAt, err := process.GetCachedData("plugins")
	if err != nil {
		// 如果缓存没有，尝试同步一次
		if err := process.SyncKeySingle("plugins", s.cfg.OpenClawConfigDir); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		data, updatedAt, _ = process.GetCachedData("plugins")
	}

	s.Success(c, gin.H{
		"data":       data,
		"updated_at": updatedAt,
	})
}

func (s *Server) getOpenClawCronJobs(c *gin.Context) {
	refresh := c.Query("refresh") == "true"
	if refresh {
		if err := process.SyncKeySingle("cron_jobs", s.cfg.OpenClawConfigDir); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
	}

	data, updatedAt, err := process.GetCachedData("cron_jobs")
	if err != nil {
		// 如果缓存没有，尝试同步一次
		if err := process.SyncKeySingle("cron_jobs", s.cfg.OpenClawConfigDir); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		data, updatedAt, _ = process.GetCachedData("cron_jobs")
	}

	s.Success(c, gin.H{
		"data":       data,
		"updated_at": updatedAt,
	})
}

func (s *Server) enableCronJob(c *gin.Context) {
	var req struct {
		ID string `json:"id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "cron job id is required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【启用定时任务】 (ID: %s)", req.ID)
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.enable_cron_job:" + req.ID,
		Module: "cron",
		Action: "enable",
		Target: req.ID,
	}
	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.EnableOpenClawCronJob(req.ID); err != nil {
			return "", err
		}
		_ = process.SyncKeySingle("cron_jobs", s.cfg.OpenClawConfigDir)
		return "tasks.results.enabled", nil
	})
}

func (s *Server) disableCronJob(c *gin.Context) {
	var req struct {
		ID string `json:"id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "cron job id is required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【禁用定时任务】 (ID: %s)", req.ID)
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.disable_cron_job:" + req.ID,
		Module: "cron",
		Action: "disable",
		Target: req.ID,
	}
	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.DisableOpenClawCronJob(req.ID); err != nil {
			return "", err
		}
		_ = process.SyncKeySingle("cron_jobs", s.cfg.OpenClawConfigDir)
		return "tasks.results.disabled", nil
	})
}

func (s *Server) removeCronJob(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		s.Error(c, http.StatusBadRequest, "cron job id is required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【删除定时任务】 (ID: %s)", id)
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.remove_cron_job:" + id,
		Module: "cron",
		Action: "remove",
		Target: id,
	}
	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.RemoveOpenClawCronJob(id); err != nil {
			return "", err
		}
		_ = process.SyncKeySingle("cron_jobs", s.cfg.OpenClawConfigDir)
		return "tasks.results.removed", nil
	})
}

func (s *Server) reloadPlugins(c *gin.Context) {
	log.Printf("🎮 [控制] 用户请求: 【热重载插件引擎】")
	err := process.ReloadOpenClawPlugins()
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	// 重新加载后触发一次同步
	_ = process.SyncKeySingle("plugins", s.cfg.OpenClawConfigDir)
	s.Success(c, gin.H{"status": "success"})
}

func (s *Server) enablePlugin(c *gin.Context) {
	var req struct {
		ID string `json:"id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "plugin id is required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【启用指定插件】 (ID: %s)", req.ID)
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.enable_plugin:" + req.ID,
		Module: "plugins",
		Action: "enable",
		Target: req.ID,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.EnableOpenClawPlugin(req.ID); err != nil {
			return "", err
		}
		_ = process.SyncKeySingle("plugins", s.cfg.OpenClawConfigDir)
		return "tasks.results.enabled", nil
	})
}

func (s *Server) disablePlugin(c *gin.Context) {
	var req struct {
		ID string `json:"id" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "plugin id is required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【禁用指定插件】 (ID: %s)", req.ID)
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.disable_plugin:" + req.ID,
		Module: "plugins",
		Action: "disable",
		Target: req.ID,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.DisableOpenClawPlugin(req.ID); err != nil {
			return "", err
		}
		_ = process.SyncKeySingle("plugins", s.cfg.OpenClawConfigDir)
		return "tasks.results.disabled", nil
	})
}

func (s *Server) uninstallPlugin(c *gin.Context) {
	id := c.Param("id")
	if id == "" {
		s.Error(c, http.StatusBadRequest, "plugin id is required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【卸载指定插件】 (ID: %s)", id)
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.uninstall_plugin:" + id,
		Module: "plugins",
		Action: "uninstall",
		Target: id,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.UninstallOpenClawPlugin(id); err != nil {
			return "", err
		}
		_ = process.SyncKeySingle("plugins", s.cfg.OpenClawConfigDir)
		return "tasks.results.uninstalled", nil
	})
}

func (s *Server) updatePlugins(c *gin.Context) {
	log.Printf("🎮 [控制] 用户请求: 【一键更新全部插件】")
	utils.RecordSystemEvent("CONTROL", "用户手动请求【更新插件】")
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.update_plugins",
		Module: "plugins",
		Action: "update",
	}
	s.runAsyncTask(c, task, func() (string, error) {
		res, err := process.RunCommandWithTimeout(120*time.Second, "openclaw", "plugins", "update")
		if err != nil {
			return "", err
		}
		return res.Output, nil
	})
}

func (s *Server) getOpenClawExperts(c *gin.Context) {
	experts, err := process.GetOpenClawExperts()
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, experts)
}

func (s *Server) createBotFromExpert(c *gin.Context) {
	var req struct {
		ExpertID   string `json:"expertId" binding:"required"`
		BotID      string `json:"botId" binding:"required"`
		ModelID    string `json:"modelId" binding:"required"`
		Soul       string `json:"soul"`
		IdentityMD string `json:"identity_md"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("[ExpertClone] Binding error for bot %s: %v", req.BotID, err)
		s.Error(c, http.StatusBadRequest, "Invalid request parameters: "+err.Error())
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【从专家模板克隆机器人】 (Expert: %s, TargetID: %s)", req.ExpertID, req.BotID)
	utils.RecordSystemEvent("CONTROL", fmt.Sprintf("用户手动从专家模板克隆机器人 (专家: %s, 目标 ID: %s)", req.ExpertID, req.BotID))
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.clone_expert:" + req.BotID,
		Module: "bots",
		Action: "clone-expert",
		Target: req.BotID,
	}

	s.runAsyncTaskWithPriority(c, task, scheduler.PriorityHigh, func() (string, error) {
		if err := process.CreateBotFromExpert(req.ExpertID, req.BotID, req.ModelID, req.Soul, req.IdentityMD); err != nil {
			return "", err
		}

		// 同步缓存
		process.SyncKeySingle("bots_models", s.cfg.OpenClawConfigDir)

		// 克隆成功后自动重启网关
		log.Printf("🔄 [ExpertClone] 克隆成功，正在自动重启网关以激活新 Bot: %s", req.BotID)
		_ = process.RestartGateway(s.cfg.HealthPort)

		return "tasks.results.cloned_and_restarted", nil
	})
}

func (s *Server) getOpenClawBotFile(c *gin.Context) {
	botID := c.Query("id")
	fileType := c.Query("type")
	filename := c.Query("filename")
	workspace := c.Query("workspace")

	if botID == "" || fileType == "" {
		s.Error(c, http.StatusBadRequest, "Missing id or type")
		return
	}

	content, err := process.GetOpenClawBotFileContent(s.cfg.OpenClawConfigDir, botID, fileType, filename, workspace)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"content": content})
}

func (s *Server) updateOpenClawBotFile(c *gin.Context) {
	var req struct {
		ID        string `json:"id" binding:"required"`
		Type      string `json:"type" binding:"required"`
		Filename  string `json:"filename"`
		Content   string `json:"content" binding:"required"`
		Workspace string `json:"workspace"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "Invalid request parameters")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【更新机器人配置文件】 (ID: %s, Type: %s, Filename: %s)", req.ID, req.Type, req.Filename)
	err := process.SaveOpenClawBotFileContent(s.cfg.OpenClawConfigDir, req.ID, req.Type, req.Filename, req.Content, req.Workspace)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success"})
}

func (s *Server) listOpenClawBotMemoryFiles(c *gin.Context) {
	botID := c.Query("id")
	workspace := c.Query("workspace")

	if botID == "" {
		s.Error(c, http.StatusBadRequest, "Missing bot id")
		return
	}

	files, err := process.ListOpenClawBotMemoryFiles(s.cfg.OpenClawConfigDir, botID, workspace)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"files": files})
}

func (s *Server) deleteOpenClawBotMemoryFile(c *gin.Context) {
	botID := c.Query("id")
	filename := c.Query("filename")
	workspace := c.Query("workspace")

	if botID == "" || filename == "" {
		s.Error(c, http.StatusBadRequest, "Missing id or filename")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【删除机器人记忆文件】 (ID: %s, Filename: %s)", botID, filename)
	err := process.DeleteOpenClawBotMemoryFile(s.cfg.OpenClawConfigDir, botID, filename, workspace)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success"})
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

func (s *Server) summarizeSession(c *gin.Context) {
	log.Printf("🔍 [Summarize] API Hit: %s %s", c.Request.Method, c.Request.URL.Path)
	var req struct {
		Messages []map[string]interface{} `json:"messages" binding:"required"`
		ModelID  string                   `json:"modelID"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		log.Printf("⚠️ [Summarize] JSON Bind Error: %v", err)
		s.Error(c, http.StatusBadRequest, "参数错误: "+err.Error())
		return
	}

	// 1. 获取模型和提供商配置
	providers, err := process.GetOpenClawModelsConfig(s.cfg.OpenClawConfigDir)
	if err != nil {
		log.Printf("❌ [Summarize] Failed to get models config: %v", err)
		s.Error(c, http.StatusInternalServerError, "无法加载模型配置: "+err.Error())
		return
	}

	// 优先级：请求传参 > 全局默认模型 > 第一个可用模型
	defaultModelID := req.ModelID
	if defaultModelID == "" {
		// 尝试获取全局默认模型 (原来的逻辑)
		data, err := os.ReadFile(filepath.Join(s.cfg.OpenClawConfigDir, "openclaw.json"))
		if err == nil {
			var fullCfg map[string]interface{}
			if err := json.Unmarshal(data, &fullCfg); err == nil {
				if gateway, ok := fullCfg["gateway"].(map[string]interface{}); ok {
					if chat, ok := gateway["chat"].(map[string]interface{}); ok {
						defaultModelID, _ = chat["defaultModel"].(string)
					}
				}
			}
		}
	}

	// 如果没有全局默认，使用第一个可用的
	if defaultModelID == "" {
		for _, p := range providers {
			if pm, ok := p.(map[string]interface{}); ok {
				if models, ok := pm["models"].([]interface{}); ok && len(models) > 0 {
					if m, ok := models[0].(map[string]interface{}); ok {
						defaultModelID, _ = m["id"].(string)
						break
					}
				}
			}
		}
	}

	if defaultModelID == "" {
		s.Error(c, http.StatusInternalServerError, "未找到可用的 AI 模型配置")
		return
	}

	// 2. 找到提供商并解析真正的模型 ID
	var providerName string
	actualModelID := defaultModelID
	if strings.Contains(defaultModelID, "/") {
		parts := strings.SplitN(defaultModelID, "/", 2)
		providerName = parts[0]
		actualModelID = parts[1]
	} else {
		// 遍历查找
		for name, p := range providers {
			if pm, ok := p.(map[string]interface{}); ok {
				if models, ok := pm["models"].([]interface{}); ok {
					for _, m := range models {
						if mo, ok := m.(map[string]interface{}); ok {
							if id, _ := mo["id"].(string); id == defaultModelID {
								providerName = name
								break
							}
						}
					}
				}
			}
			if providerName != "" {
				break
			}
		}
	}

	// 2. 确定具体的提供商配置（支持不区分大小写的匹配）
	var rawProv map[string]interface{}
	var found bool
	
	// 首先尝试精确匹配
	if p, ok := providers[providerName].(map[string]interface{}); ok {
		rawProv = p
		found = true
	} else {
		// 精确匹配失败，尝试不区分大小写匹配
		for name, p := range providers {
			if strings.EqualFold(name, providerName) {
				if dp, ok := p.(map[string]interface{}); ok {
					rawProv = dp
					found = true
					providerName = name // 修正为正确的 case
					break
				}
			}
		}
	}

	if !found {
		log.Printf("❌ [Summarize] AI Provider not found: %s. Available keys: %v", providerName, getMapKeys(providers))
		s.Error(c, http.StatusNotFound, "找不到对应提供商配置: "+providerName)
		return
	}

	baseUrl, _ := rawProv["baseUrl"].(string)
	apiKey, _ := rawProv["apiKey"].(string)

	// 3. 构造总结请求
	summarizePrompt := "请为以下对话总结一个 10 字以内的简短标题。只需输出标题文本，不要包含引号或任何解释说明性文字。"
	historyText := ""
	for i, msg := range req.Messages {
		if i > 5 { break } // 只取前 6 条以节省 token
		role, _ := msg["role"].(string)
		content, _ := msg["content"].(string)
		historyText += fmt.Sprintf("[%s]: %s\n", role, content)
	}

	chatReqBody := map[string]interface{}{
		"model": actualModelID, // 使用解析后的纯模型名
		"messages": []map[string]string{
			{"role": "system", "content": summarizePrompt},
			{"role": "user", "content": historyText},
		},
		"stream": false,
	}
	jsonBody, _ := json.Marshal(chatReqBody)

	targetUrl := strings.TrimSuffix(baseUrl, "/") + "/chat/completions"
	log.Printf("🤖 [Summarize] Requesting AI Provider: %s (Model: %s)", targetUrl, defaultModelID)
	
	httpReq, err := http.NewRequest("POST", targetUrl, bytes.NewBuffer(jsonBody))
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "创建请求失败: "+err.Error())
		return
	}

	httpReq.Header.Set("Content-Type", "application/json")
	if apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}

	client := &http.Client{Timeout: 60 * time.Second} // 延长至 60s
	resp, err := client.Do(httpReq)
	if err != nil {
		log.Printf("❌ [Summarize] AI Request Failed: %v", err)
		s.Error(c, http.StatusBadGateway, "请求 AI 提供商失败: "+err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("❌ [Summarize] AI Provider Error (%d): %s", resp.StatusCode, string(body))
		s.Error(c, resp.StatusCode, "AI提供商响应异常: "+string(body))
		return
	}

	var chatRes struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&chatRes); err != nil {
		s.Error(c, http.StatusInternalServerError, "解析 AI 响应失败: "+err.Error())
		return
	}

	title := "未命名会话"
	if len(chatRes.Choices) > 0 {
		title = strings.TrimSpace(chatRes.Choices[0].Message.Content)
		title = strings.Trim(title, "\"'\"") // 去掉引号
	}

	s.Success(c, gin.H{"title": title})
	}

func (s *Server) handleChatUpload(c *gin.Context) {
	// 0. 安全限制：50MB 大小限制
	const maxFileSize = 50 * 1024 * 1024
	c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxFileSize)

	botId := c.PostForm("botId") // 获取机器人 ID
	file, err := c.FormFile("file")
	if err != nil {
		s.Error(c, http.StatusBadRequest, "文件上传失败 (大小可能超过 50MB): "+err.Error())
		return
	}

	// 0.1 类型过滤：禁止危险文件类型直接执行
	ext := strings.ToLower(filepath.Ext(file.Filename))
	forbiddenExts := map[string]bool{
		".exe": true, ".bat": true, ".cmd": true, ".msi": true, ".com": true,
	}
	if forbiddenExts[ext] {
		s.Error(c, http.StatusForbidden, "禁止上传可执行文件: "+ext)
		return
	}

	// 1. 确定存储基准目录
	uploadDir := "./data/uploads" // 默认路径

	if botId != "" {
		start := time.Now()
		// 优化：不再调用沉重的 GetOpenClawBotsModels，改为轻量级读取 Workspace
		workspace, err := process.GetBotWorkspace(s.cfg.OpenClawConfigDir, botId)
		if err == nil && workspace != "" {
			uploadDir = filepath.Join(workspace, "uploads")
		}
		log.Printf("⏱️ [Upload] 查找机器人工作空间耗时: %v", time.Since(start))
	}

	// 2. 确保目录存在
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		s.Error(c, http.StatusInternalServerError, "创建存储目录失败: "+err.Error())
		return
	}

	// 3. 生成唯一文件名，防止冲突 & 路径注入
	// 仅保留基本 ASCII 字母、数字、点、下划线和短横线，防止中文乱码或特殊字符导致路径解析问题
	reg, _ := regexp.Compile(`[^a-zA-Z0-9._-]+`)
	cleanBaseName := reg.ReplaceAllString(file.Filename, "_")
	if cleanBaseName == "" || cleanBaseName == filepath.Ext(file.Filename) {
		cleanBaseName = "file" + filepath.Ext(file.Filename)
	}
	uniqueName := fmt.Sprintf("%d_%s", time.Now().UnixNano(), cleanBaseName)
	filePath := filepath.Join(uploadDir, uniqueName)

	if err := c.SaveUploadedFile(file, filePath); err != nil {
		s.Error(c, http.StatusInternalServerError, "保存文件失败: "+err.Error())
		return
	}

	// 3.1 临时测试：不生成缩略图，直接使用原图地址作为预览图地址
	thumbName := ""
	/* 暂时注释掉缩略图生成逻辑
	if strings.HasPrefix(c.Request.Header.Get("Content-Type"), "image/") || 
	   matchExt(ext, ".jpg", ".jpeg", ".png", ".webp", ".gif") {
		thumbName = uniqueName + ".thumb.jpg"
		err := generateThumbnail(filePath, filepath.Join(uploadDir, thumbName))
		if err != nil {
			log.Printf("⚠️ [Upload] 生成缩略图失败: %v", err)
			thumbName = "" 
		}
	}
	*/

	// 获取绝对路径，方便专家直接调用
	absPath, _ := filepath.Abs(filePath)

	// 4. 返回文件的访问 URL 和 实际物理路径
	var fullURL, thumbURL string
	escapedName := url.PathEscape(uniqueName)
	webRoot := s.cfg.WebRoot
	if webRoot == "/" { webRoot = "" }

	if botId != "" {
		fullURL = fmt.Sprintf("%s/v1/openclaw/chat/files/%s/%s", webRoot, botId, escapedName)
		if thumbName != "" {
			thumbURL = fmt.Sprintf("%s/v1/openclaw/chat/files/%s/%s", webRoot, botId, url.PathEscape(thumbName))
		}
	} else {
		fullURL = fmt.Sprintf("%s/v1/openclaw/chat/files/default/%s", webRoot, escapedName)
		if thumbName != "" {
			thumbURL = fmt.Sprintf("%s/v1/openclaw/chat/files/default/%s", webRoot, url.PathEscape(thumbName))
		}
	}

	s.Success(c, gin.H{
		"url":      fullURL,
		"thumbUrl": thumbURL, // 增加缩略图地址
		"path":     absPath,
		"filename": file.Filename,
		"size":     file.Size,
		"ext":      ext,
	})
}

// 辅助函数：匹配后缀
func matchExt(ext string, targets ...string) bool {
	for _, t := range targets {
		if ext == t { return true }
	}
	return false
}

// 简单的缩略图生成逻辑 (使用原生 image 库)
func generateThumbnail(srcPath, dstPath string) error {
	file, err := os.Open(srcPath)
	if err != nil { return err }
	defer file.Close()

	img, _, err := image.Decode(file)
	if err != nil { return err }

	// 计算缩放比例 (宽度固定 200px)
	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	
	// 如果原图宽度已经小于等于 200px，直接复制一份作为缩略图
	if width <= 200 {
		return utils.CopyFile(srcPath, dstPath)
	}
	
	newWidth := 200
	if width < 200 { newWidth = width } // 如果原图就很小，保持原宽
	
	newHeight := (height * newWidth) / width
	
	newImg := image.NewRGBA(image.Rect(0, 0, newWidth, newHeight))
	// 简单的重采样 (Nearest Neighbor)
	for y := 0; y < newHeight; y++ {
		for x := 0; x < newWidth; x++ {
			newImg.Set(x, y, img.At(x*width/newWidth, y*height/newHeight))
		}
	}

	out, err := os.Create(dstPath)
	if err != nil { return err }
	defer out.Close()

	// 统一存为 JPEG 提高加载速度，质量设为 75
	return jpeg.Encode(out, newImg, &jpeg.Options{Quality: 75})
}

// handleGetChatFile 动态读取聊天文件，支持多 workspace 隔离
func (s *Server) handleGetChatFile(c *gin.Context) {
	botId := c.Param("botId")
	filename := c.Param("filename")

	// 1. 确定物理路径
	uploadDir := "./data/uploads"
	if botId != "" && botId != "default" {
		// 优化：使用轻量级方法获取路径，避免加载沉重的模型能力对账
		workspace, err := process.GetBotWorkspace(s.cfg.OpenClawConfigDir, botId)
		if err == nil && workspace != "" {
			uploadDir = filepath.Join(workspace, "uploads")
		}
	}

	filePath := filepath.Join(uploadDir, filename)
	
	// 安全校验：防止路径穿越 (Path Traversal)
	absUploadDir, err := filepath.Abs(uploadDir)
	if err != nil {
		c.Status(http.StatusInternalServerError)
		return
	}
	cleanPath, err := filepath.Abs(filePath)
	if err != nil {
		c.Status(http.StatusForbidden)
		return
	}

	// ⚠️ strings.HasPrefix("/a/b2", "/a/b") 会误判为 true，因此必须用 filepath.Rel 做边界判断
	rel, err := filepath.Rel(absUploadDir, cleanPath)
	if err != nil {
		c.Status(http.StatusForbidden)
		return
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		c.Status(http.StatusForbidden)
		return
	}

	if _, err := os.Stat(cleanPath); os.IsNotExist(err) {
		c.Status(http.StatusNotFound)
		return
	}

	c.File(cleanPath)
}

func (s *Server) getUsageCost(c *gin.Context) {
	daysStr := c.DefaultQuery("days", "30")
	forceStr := c.DefaultQuery("force", "false")
	var days int
	fmt.Sscanf(daysStr, "%d", &days)
	force := forceStr == "true"

	data, err := process.GetUsageCost(days, force)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, data)
}
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

func getMapKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
