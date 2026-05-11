package api

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/scheduler"
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

func (s *Server) handleGetTicket(c *gin.Context) {
	p := GetPrincipal(c)
	if p == nil {
		s.Error(c, http.StatusUnauthorized, "Unauthorized")
		return
	}
	ticket := s.tickets.Generate(p)
	s.Success(c, gin.H{"ticket": ticket, "expires_in": 60})
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

func (s *Server) getTasksStatus(c *gin.Context) {
	s.Success(c, process.GetAllTasks())
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

func (s *Server) validateOpenClawConfigContent(content string) (bool, string, error) {
	tmpDir, err := os.MkdirTemp("", "openclaw-config-val-*")
	if err != nil {
		return false, "", fmt.Errorf("Failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	if s.cfg.OpenClawConfigDir != "" {
		absSrc, err := filepath.Abs(s.cfg.OpenClawConfigDir)
		if err != nil {
			return false, "", fmt.Errorf("Failed to resolve config dir: %w", err)
		}
		entries, err := os.ReadDir(absSrc)
		if err != nil {
			return false, "", fmt.Errorf("Failed to read config dir: %w", err)
		}
		for _, entry := range entries {
			name := entry.Name()
			if name == "openclaw.json" {
				continue
			}
			srcPath := filepath.Join(absSrc, name)
			dstPath := filepath.Join(tmpDir, name)
			if err := os.Symlink(srcPath, dstPath); err != nil && !os.IsExist(err) {
				return false, "", fmt.Errorf("Failed to prepare validation context: %w", err)
			}
		}
	}

	tmpConfigPath := filepath.Join(tmpDir, "openclaw.json")
	if err := os.WriteFile(tmpConfigPath, []byte(content), 0644); err != nil {
		return false, "", fmt.Errorf("Failed to write temp config: %w", err)
	}

	isValid, problem, err := process.CheckConfig(tmpDir)
	return isValid, problem, err
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

	// 1. 先在隔离目录校验新配置，避免把坏配置短暂写入真实 openclaw.json
	isValid, problem, err := s.validateOpenClawConfigContent(req.Content)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	if !isValid {
		s.Error(c, http.StatusBadRequest, "Configuration validation failed: "+problem)
		return
	}

	// 2. 校验通过后写入同目录临时文件，再原子替换真实配置
	mode := os.FileMode(0644)
	if info, err := os.Stat(configPath); err == nil {
		mode = info.Mode().Perm()
	}
	tmpPath := fmt.Sprintf("%s.tmp-%d", configPath, time.Now().UnixNano())
	if err := os.WriteFile(tmpPath, []byte(req.Content), mode); err != nil {
		s.Error(c, http.StatusInternalServerError, "Failed to write temp config: "+err.Error())
		return
	}
	if err := os.Rename(tmpPath, configPath); err != nil {
		_ = os.Remove(tmpPath)
		s.Error(c, http.StatusInternalServerError, "Failed to update config: "+err.Error())
		return
	}

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

	isValid, problem, err := s.validateOpenClawConfigContent(req.Content)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
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
