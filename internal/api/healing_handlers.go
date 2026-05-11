package api

import (
	"database/sql"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"openclaw-buddy/internal/analyzer"
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

func (s *Server) getHealthStats(c *gin.Context) {
	rows, err := utils.DB.Query(`
		SELECT timestamp, status, response_time_ms, cpu_usage, mem_usage
		FROM health_checks 
		WHERE timestamp >= datetime('now', '-24 hours')
		ORDER BY timestamp ASC
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type HealthStat struct {
		Timestamp      string  `json:"timestamp"`
		Status         string  `json:"status"`
		ResponseTimeMS int     `json:"response_time_ms"`
		CPUUsage       float64 `json:"cpu_usage"`
		MemoryUsage    float64 `json:"memory_usage"`
	}

	stats := []HealthStat{}
	for rows.Next() {
		var st HealthStat
		var cpu, mem utils.NullFloat64
		if err := rows.Scan(&st.Timestamp, &st.Status, &st.ResponseTimeMS, &cpu, &mem); err != nil {
			continue
		}
		st.CPUUsage = cpu.Float64
		st.MemoryUsage = mem.Float64
		stats = append(stats, st)
	}

	s.Success(c, stats)
}

func (s *Server) getSelfHealingSetting(c *gin.Context) {
	enabled := utils.GetSetting("self_healing_enabled", "false")
	s.Success(c, gin.H{"enabled": enabled == "true"})
}

func (s *Server) updateSelfHealingSetting(c *gin.Context) {
	var req struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		s.Error(c, http.StatusBadRequest, "Invalid request")
		return
	}

	log.Printf("🎮 [控制] 用户请求: 【切换自愈功能】 (Enabled: %v)", req.Enabled)
	val := "false"
	if req.Enabled {
		val = "true"
	}

	if err := utils.SetSetting("self_healing_enabled", val); err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}

	s.Success(c, gin.H{"enabled": req.Enabled})
}

func (s *Server) getHealEvents(c *gin.Context) {
	rows, err := utils.DB.Query(`
		SELECT id, timestamp, reason, method, result, report_path, verify_retries, verify_duration_ms, verify_error
		FROM heal_events 
		ORDER BY timestamp DESC 
		LIMIT 50
	`)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	type HealEvent struct {
		ID               int    `json:"id"`
		Timestamp        string `json:"timestamp"`
		Reason           string `json:"reason"`
		Method           string `json:"method"`
		Result           string `json:"result"`
		ReportPath       string `json:"report_path"`
		VerifyRetries    int    `json:"verify_retries"`
		VerifyDurationMS int64  `json:"verify_duration_ms"`
		VerifyError      string `json:"verify_error"`
	}

	events := []HealEvent{}
	for rows.Next() {
		var ev HealEvent
		var reason, method, result, reportPath, verifyError sql.NullString
		if err := rows.Scan(&ev.ID, &ev.Timestamp, &reason, &method, &result, &reportPath, &ev.VerifyRetries, &ev.VerifyDurationMS, &verifyError); err != nil {
			continue
		}
		ev.Reason = reason.String
		ev.Method = method.String
		ev.Result = result.String
		ev.ReportPath = reportPath.String
		ev.VerifyError = verifyError.String
		events = append(events, ev)
	}

	s.Success(c, events)
}

func (s *Server) getHealReports(c *gin.Context) {
	files, err := os.ReadDir(s.cfg.ReportDir)
	if err != nil {
		if os.IsNotExist(err) {
			s.Success(c, []map[string]interface{}{})
			return
		}
		s.Error(c, http.StatusInternalServerError, "无法读取报表目录: "+err.Error())
		return
	}

	reports := []map[string]interface{}{}
	for _, f := range files {
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".md") {
			info, _ := f.Info()
			reports = append(reports, map[string]interface{}{
				"name": f.Name(),
				"size": info.Size(),
				"time": info.ModTime().Format("2006-01-02 15:04:05"),
			})
		}
	}

	// 按时间倒序
	sort.Slice(reports, func(i, j int) bool {
		return reports[i]["time"].(string) > reports[j]["time"].(string)
	})

	s.Success(c, reports)
}

func (s *Server) getHealReportDetail(c *gin.Context) {
	name := c.Param("name")
	if name == "" || strings.Contains(name, "..") {
		s.Error(c, http.StatusBadRequest, "无效的报表名称")
		return
	}

	path := filepath.Join(s.cfg.ReportDir, name)
	content, err := os.ReadFile(path)
	if err != nil {
		s.Error(c, http.StatusNotFound, "未找到该报表")
		return
	}

	s.Success(c, gin.H{
		"name":    name,
		"content": string(content),
	})
}

func (s *Server) getHealBackups(c *gin.Context) {
	files, err := os.ReadDir(s.cfg.BackupDir)
	if err != nil {
		if os.IsNotExist(err) {
			s.Success(c, []map[string]interface{}{})
			return
		}
		s.Error(c, http.StatusInternalServerError, "无法读取备份目录: "+err.Error())
		return
	}

	backups := []map[string]interface{}{}
	for _, f := range files {
		// 备份文件以 .bak 结尾
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".bak") {
			info, _ := f.Info()
			backups = append(backups, map[string]interface{}{
				"name": f.Name(),
				"size": info.Size(),
				"time": info.ModTime().Format("2006-01-02 15:04:05"),
			})
		}
	}

	// 按时间倒序
	sort.Slice(backups, func(i, j int) bool {
		return backups[i]["time"].(string) > backups[j]["time"].(string)
	})

	s.Success(c, backups)
}

func (s *Server) getHealBackupDetail(c *gin.Context) {
	name := c.Param("name")
	if name == "" || strings.Contains(name, "..") {
		s.Error(c, http.StatusBadRequest, "无效的备份名称")
		return
	}

	path := filepath.Join(s.cfg.BackupDir, name)
	content, err := os.ReadFile(path)
	if err != nil {
		s.Error(c, http.StatusNotFound, "未找到该备份文件")
		return
	}

	s.Success(c, gin.H{
		"name":    name,
		"content": string(content),
	})
}

func (s *Server) getHealBackupDiff(c *gin.Context) {
	name := c.Param("name")
	if name == "" || strings.Contains(name, "..") {
		s.Error(c, http.StatusBadRequest, "无效的备份名称")
		return
	}

	backupPath := filepath.Join(s.cfg.BackupDir, name)
	currentConfigPath := filepath.Join(s.cfg.OpenClawConfigDir, "openclaw.json")

	// 使用 analyzer 中的通用对比逻辑
	diff, err := analyzer.GetDiff(backupPath, currentConfigPath)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, "生成对比失败: "+err.Error())
		return
	}

	s.Success(c, gin.H{
		"name": name,
		"diff": diff,
	})
}
