package api

import (
	"net/http"
	"openclaw-buddy/internal/process"
	"github.com/gin-gonic/gin"
)

type ShareSkillRequest struct {
	SkillName string   `json:"skill_name" binding:"required"`
	FromBotID string   `json:"from_bot_id" binding:"required"`
	ToBotIDs  []string `json:"to_bot_ids" binding:"required"`
}

func (s *Server) shareSkill(c *gin.Context) {
	var req ShareSkillRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	if len(req.ToBotIDs) == 0 {
		s.Error(c, http.StatusBadRequest, "target bots list cannot be empty")
		return
	}

	if err := process.SharePrivateSkill(s.cfg.OpenClawConfigDir, req.SkillName, req.FromBotID, req.ToBotIDs); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	s.Success(c, gin.H{"status": "success", "message": "skill shared successfully"})
}
