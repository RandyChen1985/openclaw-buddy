package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

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
