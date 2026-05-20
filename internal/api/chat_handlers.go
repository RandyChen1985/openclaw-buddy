package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	"image/jpeg"
	_ "image/png"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

func (s *Server) chatProxy(c *gin.Context) {
	// 1. 获取网关配置
	gw, err := process.GetOpenClawGatewayConfig(s.cfg.OpenClawConfigDir)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "无法读取 OpenClaw 网关配置: " + err.Error()})
		return
	}

	// 4. 执行请求 (增加 6 分钟显式超时保护)
	startTime := time.Now()
	
	targets := s.getGatewayHosts(gw)
	var resp *http.Response
	var finalURL string
	var lastErr error
	// 保留成功请求的 cancel，在 body 读取完毕后再调用，防止提前取消导致流式 body 被截断
	var successCancel context.CancelFunc

	// 读取原始请求体 (提前读取，避免在循环中重复读取消耗 Body)
	var body map[string]interface{}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "无效的请求体"})
		return
	}
	jsonBody, _ := json.Marshal(body)

	port := gw.Port
	if port <= 0 {
		port = s.cfg.HealthPort
		log.Printf("⚠️ [Chat-Proxy] 网关配置中端口为 0，使用 HEALTH_PORT (%d) 兜底", port)
	}

	for _, target := range targets {
		targetURL := fmt.Sprintf("http://%s:%d/v1/chat/completions", target, port)
		req, err := http.NewRequest("POST", targetURL, bytes.NewBuffer(jsonBody))
		if err != nil {
			lastErr = err
			continue
		}

		// 设置头部
		req.Header.Set("Authorization", "Bearer "+gw.Auth.Token)
		req.Header.Set("Content-Type", "application/json")
		if stream, ok := body["stream"].(bool); ok && stream {
			req.Header.Set("Accept", "text/event-stream")
		}

		// 设置带超时的上下文
		// 注意：不能在 client.Do() 后立即 cancel()，否则流式 body 会被立刻关闭；
		// 失败时立即 cancel 释放资源，成功时推迟到 body 读取完毕后再 cancel。
		ctx, cancel := context.WithTimeout(c.Request.Context(), 6*time.Minute)
		client := &http.Client{}
		r, err := client.Do(req.WithContext(ctx))
		if err != nil {
			cancel() // 请求失败，立即释放
			lastErr = err
			log.Printf("⚠️ [Chat-Proxy] 尝试连接网关失败 (%s): %v", targetURL, err)
			continue
		}
		resp = r
		finalURL = targetURL
		successCancel = cancel
		break
	}
	if successCancel != nil {
		defer successCancel() // body 读取完毕（函数返回）后再释放上下文
	}

	duration := time.Since(startTime).Milliseconds()
	model, _ := body["model"].(string)
	msgs, _ := body["messages"].([]interface{})
	msgCount := len(msgs)
	isStream, _ := body["stream"].(bool)
	nowStr := time.Now().Format("2006/01/02 15:04:05")

	if resp == nil {
		fmt.Printf("%s ❌ [Chat] Error: Model=%s, Duration=%dms, Error=%v\n", nowStr, model, duration, lastErr)
		c.JSON(http.StatusBadGateway, gin.H{"error": "无法连接到 OpenClaw 网关: " + lastErr.Error()})
		return
	}
	defer resp.Body.Close()

	fmt.Printf("%s ✅ [Chat] Request: Model=%s, URL=%s, Msgs=%d, Stream=%v, Latency=%dms, Status=%d\n",
		nowStr, model, finalURL, msgCount, isStream, duration, resp.StatusCode)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		for k, vv := range resp.Header {
			for _, v := range vv {
				c.Header(k, v)
			}
		}
		c.Status(resp.StatusCode)
		io.Copy(c.Writer, resp.Body)
		return
	}

	// 5. 处理流式响应 (WAF 穿透增强)
	if strings.HasPrefix(resp.Header.Get("Content-Type"), "text/event-stream") || isStream {
		c.Header("Content-Type", "text/event-stream")
		c.Header("Cache-Control", "no-cache, no-transform")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no") // 专门针对 Nginx/WAF 的非缓冲指令

		flusher, canFlush := c.Writer.(http.Flusher)
		buf := make([]byte, 4096)
		for {
			n, readErr := resp.Body.Read(buf)
			if n > 0 {
				if _, writeErr := c.Writer.Write(buf[:n]); writeErr != nil {
					break // 客户端已断开
				}
				if canFlush {
					flusher.Flush()
				}
			}
			if readErr != nil {
				break // EOF 或上游错误，正常结束
			}
		}
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
		if i > 5 {
			break
		} // 只取前 6 条以节省 token
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
		content := strings.TrimSpace(chatRes.Choices[0].Message.Content)
		// 移除常见的前缀和包裹符号
		content = strings.Trim(content, "\"'「」")
		prefixes := []string{"标题：", "标题:", "总结：", "总结:", "Title:", "Summary:", "会话标题：", "Session Title:"}
		for _, p := range prefixes {
			if strings.HasPrefix(content, p) {
				content = strings.TrimSpace(strings.TrimPrefix(content, p))
				break
			}
		}
		// 再次去除引号，防止前缀内部也带有引号
		content = strings.Trim(content, "\"'「」")
		if content != "" {
			title = content
		}
	}

	s.Success(c, gin.H{"title": title})
}

// completeModelChat 使用模型军团配置的 provider/model 直连提供商（与 summarize 相同），供模型试聊等场景。
// 不走 OpenClaw 网关 chat/completions（网关 model 仅支持 openclaw 或 openclaw/<agentId>）。
func (s *Server) completeModelChat(c *gin.Context) {
	var req struct {
		Messages []map[string]interface{} `json:"messages" binding:"required"`
		ModelID  string                   `json:"modelID" binding:"required"`
		Stream   bool                     `json:"stream"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "参数错误: "+err.Error())
		return
	}

	modelID := strings.TrimSpace(req.ModelID)
	if modelID == "" {
		s.Error(c, http.StatusBadRequest, "modelID 不能为空")
		return
	}

	providers, err := process.GetOpenClawModelsConfig(s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "无法加载模型配置: "+err.Error())
		return
	}

	providerName := ""
	actualModelID := modelID
	if strings.Contains(modelID, "/") {
		parts := strings.SplitN(modelID, "/", 2)
		providerName = parts[0]
		actualModelID = parts[1]
	} else {
		for name, p := range providers {
			if pm, ok := p.(map[string]interface{}); ok {
				if models, ok := pm["models"].([]interface{}); ok {
					for _, m := range models {
						if mo, ok := m.(map[string]interface{}); ok {
							if id, _ := mo["id"].(string); id == modelID {
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

	var rawProv map[string]interface{}
	var found bool
	if p, ok := providers[providerName].(map[string]interface{}); ok {
		rawProv = p
		found = true
	} else {
		for name, p := range providers {
			if strings.EqualFold(name, providerName) {
				if dp, ok := p.(map[string]interface{}); ok {
					rawProv = dp
					found = true
					providerName = name
					break
				}
			}
		}
	}
	if !found {
		s.Error(c, http.StatusNotFound, "找不到对应提供商配置: "+providerName)
		return
	}

	baseUrl, _ := rawProv["baseUrl"].(string)
	apiKey, _ := rawProv["apiKey"].(string)
	if strings.TrimSpace(baseUrl) == "" {
		s.Error(c, http.StatusInternalServerError, "提供商 baseUrl 未配置")
		return
	}

	chatMessages := make([]map[string]string, 0, len(req.Messages))
	for _, m := range req.Messages {
		role, _ := m["role"].(string)
		role = strings.TrimSpace(role)
		if role != "user" && role != "assistant" && role != "system" {
			continue
		}
		content := ""
		switch v := m["content"].(type) {
		case string:
			content = strings.TrimSpace(v)
		default:
			if b, err := json.Marshal(v); err == nil {
				content = strings.TrimSpace(string(b))
			}
		}
		if content == "" {
			continue
		}
		chatMessages = append(chatMessages, map[string]string{"role": role, "content": content})
	}
	if len(chatMessages) == 0 {
		s.Error(c, http.StatusBadRequest, "无有效消息")
		return
	}

	stream := req.Stream
	chatReqBody := map[string]interface{}{
		"model":    actualModelID,
		"messages": chatMessages,
		"stream":   stream,
	}
	jsonBody, _ := json.Marshal(chatReqBody)
	targetUrl := strings.TrimSuffix(baseUrl, "/") + "/chat/completions"
	log.Printf("🤖 [ModelChat] Requesting AI Provider: %s (Model: %s, Stream: %v)", targetUrl, modelID, stream)

	httpReq, err := http.NewRequest("POST", targetUrl, bytes.NewBuffer(jsonBody))
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "创建请求失败: "+err.Error())
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")
	if stream {
		httpReq.Header.Set("Accept", "text/event-stream")
	}
	if apiKey != "" {
		httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	}

	client := &http.Client{Timeout: 6 * time.Minute}
	resp, err := client.Do(httpReq)
	if err != nil {
		s.Error(c, http.StatusBadGateway, "请求 AI 提供商失败: "+err.Error())
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		log.Printf("❌ [ModelChat] AI Provider Error (%d): %s", resp.StatusCode, string(body))
		s.Error(c, resp.StatusCode, "AI提供商响应异常: "+string(body))
		return
	}

	if stream {
		for k, vv := range resp.Header {
			if k == "Content-Length" {
				continue
			}
			for _, v := range vv {
				c.Header(k, v)
			}
		}
		if c.Writer.Header().Get("Content-Type") == "" {
			c.Header("Content-Type", "text/event-stream")
		}
		c.Header("Cache-Control", "no-cache, no-transform")
		c.Header("Connection", "keep-alive")
		c.Header("X-Accel-Buffering", "no")
		c.Status(http.StatusOK)

		flusher, canFlush := c.Writer.(http.Flusher)
		buf := make([]byte, 4096)
		for {
			n, readErr := resp.Body.Read(buf)
			if n > 0 {
				if _, writeErr := c.Writer.Write(buf[:n]); writeErr != nil {
					break
				}
				if canFlush {
					flusher.Flush()
				}
			}
			if readErr != nil {
				break
			}
		}
		return
	}

	body, _ := io.ReadAll(resp.Body)
	var chatRes struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(body, &chatRes); err != nil {
		s.Error(c, http.StatusInternalServerError, "解析 AI 响应失败: "+err.Error())
		return
	}

	content := ""
	if len(chatRes.Choices) > 0 {
		content = strings.TrimSpace(chatRes.Choices[0].Message.Content)
	}
	s.Success(c, gin.H{"content": content})
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
	if webRoot == "/" {
		webRoot = ""
	}

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
		if ext == t {
			return true
		}
	}
	return false
}

// 简单的缩略图生成逻辑 (使用原生 image 库)
func generateThumbnail(srcPath, dstPath string) error {
	file, err := os.Open(srcPath)
	if err != nil {
		return err
	}
	defer file.Close()

	img, _, err := image.Decode(file)
	if err != nil {
		return err
	}

	// 计算缩放比例 (宽度固定 200px)
	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()

	// 如果原图宽度已经小于等于 200px，直接复制一份作为缩略图
	if width <= 200 {
		return utils.CopyFile(srcPath, dstPath)
	}

	newWidth := 200
	if width < 200 {
		newWidth = width
	} // 如果原图就很小，保持原宽

	newHeight := (height * newWidth) / width

	newImg := image.NewRGBA(image.Rect(0, 0, newWidth, newHeight))
	// 简单的重采样 (Nearest Neighbor)
	for y := 0; y < newHeight; y++ {
		for x := 0; x < newWidth; x++ {
			newImg.Set(x, y, img.At(x*width/newWidth, y*height/newHeight))
		}
	}

	out, err := os.Create(dstPath)
	if err != nil {
		return err
	}
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

func getMapKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
