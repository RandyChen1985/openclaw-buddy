package api

import (
	"fmt"
	"net/http"
	"time"

	"openclaw-buddy/internal/process"

	"github.com/gin-gonic/gin"
)

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
