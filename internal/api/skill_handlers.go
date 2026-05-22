package api

import (
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
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
		if err := process.UninstallOpenClawSkill(s.cfg.OpenClawConfigDir, name); err != nil {
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

	files, err := process.ListSkillResources(path, s.cfg.OpenClawConfigDir)
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

	content, err := process.ReadSkillResource(path, s.cfg.OpenClawConfigDir)
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
	err := process.SaveSkillResource(req.Path, req.Content, s.cfg.OpenClawConfigDir)
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
	destPath, err := process.CreateSkillResourceFile(req.Path, req.Filename, req.Content, s.cfg.OpenClawConfigDir)
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
	destPath, err := process.CreateSkillResourceDir(req.Path, req.Dirname, s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{"status": "success", "path": destPath})
}

func (s *Server) resolveInstallTargetDir(scope string, botID string) (string, error) {
	sources := process.GetDynamicSkillDirSources(s.cfg.OpenClawConfigDir)
	if scope == "private" {
		for _, src := range sources {
			if !src.IsGlobal && src.BotID == botID {
				return src.Path, nil
			}
		}
		cfgDir := s.cfg.OpenClawConfigDir
		if cfgDir == "" {
			cfgDir = filepath.Join(os.Getenv("HOME"), ".openclaw")
		}
		suffix := "workspace"
		if botID != "" && botID != "main" {
			suffix = "workspace_" + botID
		}
		return filepath.Join(cfgDir, suffix, "skills"), nil
	}

	for _, src := range sources {
		if src.IsGlobal {
			if !strings.Contains(src.Path, "site-packages") && !strings.Contains(src.Path, "bundled") {
				return src.Path, nil
			}
		}
	}
	cfgDir := s.cfg.OpenClawConfigDir
	if cfgDir == "" {
		cfgDir = filepath.Join(os.Getenv("HOME"), ".openclaw")
	}
	return filepath.Join(cfgDir, "skills"), nil
}

func (s *Server) getSkillMarket(c *gin.Context) {
	status, skills, err := process.FetchSkillMarket(s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	s.Success(c, gin.H{
		"network_status": status,
		"data":           skills,
	})
}

func (s *Server) installSkill(c *gin.Context) {
	var req struct {
		Name       string `json:"name" binding:"required"`
		TarballURL string `json:"tarball_url" binding:"required"`
		Scope      string `json:"scope" binding:"required"`
		BotID      string `json:"bot_id"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, err.Error())
		return
	}

	targetDir, err := s.resolveInstallTargetDir(req.Scope, req.BotID)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		s.Error(c, http.StatusInternalServerError, fmt.Sprintf("failed to create target directory: %v", err))
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【在线安装技能/插件】 (Name: %s, URL: %s, Scope: %s)", req.Name, req.TarballURL, req.Scope)
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.install_skill:" + req.Name,
		Module: "skills",
		Action: "install-skill",
		Target: req.Name,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		if err := process.InstallSkillFromURL(req.TarballURL, targetDir, req.Name, task.ID, s.cfg.OpenClawConfigDir); err != nil {
			return "", err
		}
		process.SyncKeySingle("skills", s.cfg.OpenClawConfigDir)
		process.ReloadOpenClawSkills()
		return "tasks.results.installed", nil
	})
}

func (s *Server) uploadSkill(c *gin.Context) {
	name := c.PostForm("name")
	scope := c.PostForm("scope")
	botID := c.PostForm("bot_id")
	file, err := c.FormFile("file")

	if name == "" || scope == "" || file == nil {
		s.Error(c, http.StatusBadRequest, "name, scope and file are required")
		return
	}

	targetDir, err := s.resolveInstallTargetDir(scope, botID)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	if err := os.MkdirAll(targetDir, 0755); err != nil {
		s.Error(c, http.StatusInternalServerError, fmt.Sprintf("failed to create target directory: %v", err))
		return
	}

	srcFile, err := file.Open()
	if err != nil {
		s.Error(c, http.StatusInternalServerError, fmt.Sprintf("failed to open uploaded file: %v", err))
		return
	}
	defer srcFile.Close()

	tempFile, err := os.CreateTemp("", "uploaded_skill_*.tmp")
	if err != nil {
		s.Error(c, http.StatusInternalServerError, fmt.Sprintf("failed to create temporary upload file: %v", err))
		return
	}
	tempFilePath := tempFile.Name()

	if _, err := io.Copy(tempFile, srcFile); err != nil {
		tempFile.Close()
		os.Remove(tempFilePath)
		s.Error(c, http.StatusInternalServerError, fmt.Sprintf("failed to save uploaded file: %v", err))
		return
	}
	tempFile.Close()

	log.Printf("🎮 [控制] 用户请求: 【流式中转上传安装技能/插件】 (Name: %s, Scope: %s, Bot: %s)", name, scope, botID)
	task := &process.Task{
		ID:     fmt.Sprintf("task-%d", time.Now().UnixNano()),
		Name:   "tasks.upload_skill:" + name,
		Module: "skills",
		Action: "upload-skill",
		Target: name,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		defer os.Remove(tempFilePath)

		f, err := os.Open(tempFilePath)
		if err != nil {
			return "", err
		}
		defer f.Close()

		if err := process.InstallSkillFromReader(f, targetDir, name, s.cfg.OpenClawConfigDir); err != nil {
			return "", err
		}
		process.SyncKeySingle("skills", s.cfg.OpenClawConfigDir)
		process.ReloadOpenClawSkills()
		return "tasks.results.uploaded", nil
	})
}
