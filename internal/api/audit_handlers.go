package api

import (
	"net/http"
	"time"
	"openclaw-buddy/internal/utils"
	"github.com/gin-gonic/gin"
)

// handleGetAuditSummary 获取审计大屏汇总数据
func (s *Server) handleGetAuditSummary(c *gin.Context) {
	start := c.Query("start")
	end := c.Query("end")

	if start == "" {
		start = time.Now().AddDate(0, 0, -7).Format(time.RFC3339)
	}
	if end == "" {
		end = time.Now().Format(time.RFC3339)
	}

	if start != "" && len(start) > 10 {
		start = start[:10] + " 00:00:00"
	}
	if end != "" && len(end) > 10 {
		end = end[:10] + " 23:59:59"
	}

	// 1. 基础总量统计
	var totalPrompt, totalCompletion int64
	_ = utils.DB.QueryRow(`
		SELECT COALESCE(SUM(prompt_tokens), 0), COALESCE(SUM(completion_tokens), 0) 
		FROM audit_usage 
		WHERE timestamp >= ? AND timestamp <= ?`, start, end).Scan(&totalPrompt, &totalCompletion)

	var securityHits int
	_ = utils.DB.QueryRow(`
		SELECT COUNT(*) 
		FROM audit_security_events 
		WHERE risk_level = 'high' AND timestamp >= ? AND timestamp <= ?`, start, end).Scan(&securityHits)

	var totalSessions int
	_ = utils.DB.QueryRow(`
		SELECT COUNT(DISTINCT agent_id) 
		FROM audit_usage 
		WHERE timestamp >= ? AND timestamp <= ?`, start, end).Scan(&totalSessions)

	// 2. 模型分布统计
	modelDist := []gin.H{}
	rows, err := utils.DB.Query(`
		SELECT model_id, SUM(prompt_tokens + completion_tokens) as total 
		FROM audit_usage 
		WHERE timestamp >= ? AND timestamp <= ? 
		GROUP BY model_id 
		ORDER BY total DESC`, start, end)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var mid string
			var total int64
			if err := rows.Scan(&mid, &total); err == nil {
				modelDist = append(modelDist, gin.H{"model": mid, "tokens": total})
			}
		}
	}

	// 2.1 Agent 分布统计
	agentDist := []gin.H{}
	aRows, err := utils.DB.Query(`
		SELECT agent_id, SUM(prompt_tokens + completion_tokens) as total 
		FROM audit_usage 
		WHERE timestamp >= ? AND timestamp <= ? 
		GROUP BY agent_id 
		ORDER BY total DESC`, start, end)
	if err == nil {
		defer aRows.Close()
		for aRows.Next() {
			var aid string
			var total int64
			if err := aRows.Scan(&aid, &total); err == nil {
				agentDist = append(agentDist, gin.H{"agent": aid, "tokens": total})
			}
		}
	}

	// 3. 每日趋势 (Token 消耗)
	granularity := c.DefaultQuery("granularity", "day")
	groupFormat := 10 // YYYY-MM-DD
	if granularity == "hour" {
		groupFormat = 13 // YYYY-MM-DD HH
	}

	trend := []gin.H{}
	// 使用 substr 提取对应颗粒度的时间字符串
	trendRows, err := utils.DB.Query(`
		SELECT substr(timestamp, 1, ?) as time_unit, SUM(prompt_tokens + completion_tokens) 
		FROM audit_usage 
		WHERE timestamp >= ? AND timestamp <= ?
		GROUP BY time_unit 
		ORDER BY time_unit ASC`, groupFormat, start, end)
	if err == nil {
		defer trendRows.Close()
		for trendRows.Next() {
			var unit string
			var tokens int64
			if err := trendRows.Scan(&unit, &tokens); err == nil {
				trend = append(trend, gin.H{"time": unit, "tokens": tokens})
			}
		}
	}

	s.Success(c, gin.H{
		"summary": gin.H{
			"total_prompt":     totalPrompt,
			"total_completion": totalCompletion,
			"total_tokens":     totalPrompt + totalCompletion,
			"security_hits":    securityHits,
			"active_agents":    totalSessions,
		},
		"model_distribution": modelDist,
		"agent_distribution": agentDist,
		"trend":              trend,
	})
}

// handleGetAuditTools 获取工具调用热力排行
func (s *Server) handleGetAuditTools(c *gin.Context) {
	start := c.Query("start")
	end := c.Query("end")

	if start == "" {
		start = time.Now().AddDate(0, 0, -7).Format(time.RFC3339)
	}
	if end == "" {
		end = time.Now().Format(time.RFC3339)
	}

	rows, err := utils.DB.Query(`
		SELECT tool_name, COUNT(*) as count 
		FROM audit_tool_calls 
		WHERE timestamp >= ? AND timestamp <= ? 
		GROUP BY tool_name 
		ORDER BY count DESC 
		LIMIT 15`, start, end)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	tools := []gin.H{}
	for rows.Next() {
		var name string
		var count int
		if err := rows.Scan(&name, &count); err == nil {
			tools = append(tools, gin.H{"name": name, "count": count})
		}
	}

	s.Success(c, tools)
}

// handleGetAuditLogs 获取安全审计流水
func (s *Server) handleGetAuditLogs(c *gin.Context) {
	start := c.Query("start")
	end := c.Query("end")
	level := c.Query("level")
	keyword := c.Query("keyword")

	if start == "" {
		start = time.Now().AddDate(0, 0, -7).Format(time.RFC3339)
	}
	if end == "" {
		end = time.Now().Format(time.RFC3339)
	}

	query := "SELECT agent_id, command, risk_level, timestamp FROM audit_security_events WHERE timestamp >= ? AND timestamp <= ?"
	args := []interface{}{start, end}

	if level != "" {
		query += " AND risk_level = ?"
		args = append(args, level)
	}
	if keyword != "" {
		query += " AND command LIKE ?"
		args = append(args, "%"+keyword+"%")
	}

	query += " ORDER BY timestamp DESC LIMIT 100"

	rows, err := utils.DB.Query(query, args...)
	if err != nil {
		s.Error(c, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	logs := []gin.H{}
	for rows.Next() {
		var aid, cmd, rl, ts string
		if err := rows.Scan(&aid, &cmd, &rl, &ts); err == nil {
			logs = append(logs, gin.H{
				"agent_id":   aid,
				"command":    cmd,
				"risk_level": rl,
				"timestamp":  ts,
			})
		}
	}

	s.Success(c, logs)
}
