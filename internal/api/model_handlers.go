package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"

	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

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
		Target: fmt.Sprintf("%s/%s", req.ProviderName, modelID),
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
	if providerName == "" {
		providerName = c.Query("provider")
	}
	if modelID == "" {
		modelID = c.Query("id")
	}

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
