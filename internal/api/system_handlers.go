package api

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"openclaw-buddy/internal/config"
	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

func (s *Server) getSystemVersion(c *gin.Context) {
	current := strings.TrimPrefix(config.Version, "v")

	// 如果请求带了 refresh=true，则立即触发一次物理对账
	if c.Query("refresh") == "true" && s.guardian != nil {
		log.Printf("🌐 [API] 收到手动版本刷新请求，正在联网对账...")
		s.guardian.CheckVersionUpdate()
	}

	latest := strings.TrimPrefix(utils.GetSetting("latest_version", current), "v")

	s.Success(c, gin.H{
		"current":              current,
		"latest":               latest,
		"release_url":          "https://github.com/RandyChen1985/openclaw-buddy/releases",
		"gui_disable_features": s.cfg.GUIDisableFeatures,
		"show_external_tools":  s.cfg.ShowExternalTools,
	})
}

func (s *Server) handleUpgrade(c *gin.Context) {
	var req struct {
		Version string `json:"version" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "版本号是必填项")
		return
	}

	log.Printf("📥 [系统] 用户请求全自动版本升级: v%s", req.Version)
	utils.RecordSystemEvent("CONTROL", fmt.Sprintf("发起系统升级请求: v%s", req.Version))

	task := &process.Task{
		ID:     fmt.Sprintf("upgrade-%d", time.Now().UnixNano()),
		Name:   "系统版本升级: v" + req.Version,
		Module: "system",
		Action: "upgrade",
		Target: req.Version,
	}

	s.runAsyncTask(c, task, func() (string, error) {
		return process.DownloadAndUpgrade(req.Version, task.ID)
	})
}

func (s *Server) handleRestart(c *gin.Context) {
	log.Printf("📥 [系统] 用户请求全自动静默重启...")
	utils.RecordSystemEvent("CONTROL", "发起系统重启请求")

	// 异步执行重启，给响应留出时间
	err := process.SelfRestart()
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "重启失败: "+err.Error())
		return
	}

	s.Success(c, "服务正在重启，请在 5-10 秒后刷新页面")
}

func (s *Server) getSystemEvents(c *gin.Context) {
	rows, err := utils.DB.Query(`
		SELECT id, timestamp, event_type, message 
		FROM system_events 
		ORDER BY timestamp DESC 
		LIMIT 20
	`)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	type SystemEvent struct {
		ID        int    `json:"id"`
		Timestamp string `json:"timestamp"`
		Type      string `json:"event_type"`
		Message   string `json:"message"`
	}

	events := []SystemEvent{}
	for rows.Next() {
		var ev SystemEvent
		if err := rows.Scan(&ev.ID, &ev.Timestamp, &ev.Type, &ev.Message); err != nil {
			continue
		}
		events = append(events, ev)
	}
	s.Success(c, events)
}

func (s *Server) getTopBots(c *gin.Context) {
	// ?refresh=true：跳过缓存，同步重算榜单并写入 data_caches（与审计口径一致）
	if c.Query("refresh") == "true" {
		if err := process.SyncKeySingle("ranking", s.cfg.OpenClawConfigDir); err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		data, _, err := process.GetCachedData("ranking")
		if err != nil {
			s.Error(c, http.StatusInternalServerError, err.Error())
			return
		}
		s.Success(c, data)
		return
	}

	// 1. 优先尝试从缓存获取 (后台定时 SyncAll 也会刷新)
	data, _, err := process.GetCachedData("ranking")
	if err == nil && data != nil {
		s.Success(c, data)
		return
	}

	// 2. 缓存失效或不存在：实时计算并异步写入缓存
	ranks, err := process.GetBotRanking(s.cfg.OpenClawConfigDir)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	go process.SyncKeySingle("ranking", s.cfg.OpenClawConfigDir)

	s.Success(c, ranks)
}

func (s *Server) getServerInfo(c *gin.Context) {
	hostname, _ := os.Hostname()
	s.Success(c, gin.H{
		"hostname": hostname,
		"os":       runtime.GOOS,
		"arch":     runtime.GOARCH,
		"cpus":     runtime.NumCPU(),
	})
}

func (s *Server) getOpenClawVersion(c *gin.Context) {
	path, err := exec.LookPath("openclaw")
	if err != nil {
		s.Success(c, gin.H{
			"installed": false,
			"version":   "",
			"path":      "",
			"error":     "openclaw terminal command not found",
		})
		return
	}

	out, err := exec.Command(path, "--version").Output()
	if err != nil {
		// 尝试不带 --
		out, err = exec.Command(path, "version").Output()
	}

	version := "Unknown"
	if err == nil {
		version = strings.TrimSpace(string(out))
	}

	s.Success(c, gin.H{
		"installed": true,
		"version":   version,
		"path":      path,
	})
}
