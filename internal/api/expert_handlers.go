package api

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/scheduler"
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

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
