package api

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

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
