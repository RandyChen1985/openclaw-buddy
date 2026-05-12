package api

import (
	"fmt"
	"log"
	"net/http"
	"time"

	"openclaw-buddy/internal/process"

	"github.com/gin-gonic/gin"
)

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
		Content string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "path is required")
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

func (s *Server) createSkillFile(c *gin.Context) {
	var req struct {
		Path     string `json:"path" binding:"required"`
		Filename string `json:"filename" binding:"required"`
		Content  string `json:"content"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "path and filename are required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【新建技能资源文件】 (Dir: %s, Name: %s)", req.Path, req.Filename)
	destPath, err := process.CreateSkillResourceFile(req.Path, req.Filename, req.Content)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success", "path": destPath})
}

func (s *Server) createSkillDir(c *gin.Context) {
	var req struct {
		Path    string `json:"path" binding:"required"`
		Dirname string `json:"dirname" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "path and dirname are required")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【新建技能资源文件夹】 (Dir: %s, Name: %s)", req.Path, req.Dirname)
	destPath, err := process.CreateSkillResourceDir(req.Path, req.Dirname)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success", "path": destPath})
}
