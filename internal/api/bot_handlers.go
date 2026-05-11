package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

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
		s.Success(c, gin.H{"data": s.filterBotsModelsForPrincipal(c, res), "updated_at": "实时"})
		return
	}
	s.Success(c, gin.H{"data": s.filterBotsModelsForPrincipal(c, data), "updated_at": updatedAt})
}

func (s *Server) filterBotsModelsForPrincipal(c *gin.Context, data any) any {
	p := GetPrincipal(c)
	if p == nil || p.HasPermission(permBots) {
		return data
	}
	if p.User == nil {
		return data
	}

	allowedIDs, err := utils.GetUserBotIDs(p.User.ID)
	if err != nil {
		return data
	}
	allowed := make(map[string]bool, len(allowedIDs))
	for _, id := range allowedIDs {
		id = strings.TrimSpace(id)
		if id != "" {
			allowed[id] = true
		}
	}

	var res process.OpenClawBotsModelsResponse
	raw, err := json.Marshal(data)
	if err != nil || json.Unmarshal(raw, &res) != nil {
		return data
	}

	modelIDs := map[string]bool{}
	filteredBots := make([]process.OpenClawBot, 0, len(res.Bots))
	for _, bot := range res.Bots {
		if !allowed[bot.ID] {
			continue
		}
		filteredBots = append(filteredBots, bot)
		if bot.Model != "" {
			modelIDs[bot.Model] = true
		}
	}

	filteredModels := make([]process.OpenClawModel, 0, len(res.Models))
	for _, model := range res.Models {
		if modelIDs[model.ID] {
			filteredModels = append(filteredModels, model)
		}
	}
	res.Bots = filteredBots
	res.Models = filteredModels
	return res
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
