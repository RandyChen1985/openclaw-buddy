package analyzer

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"openclaw-buddy/internal/utils"
)

var securityPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\brm\b`),
	regexp.MustCompile(`(?i)\bchmod\b`),
	regexp.MustCompile(`(?i)\breboot\b`),
	regexp.MustCompile(`(?i)\bfdisk\b`),
	regexp.MustCompile(`(?i)\bformat\b`),
	regexp.MustCompile(`(?i)drop\s+table`),
	regexp.MustCompile(`(?i)curl.*\|\s*sh`),
}

// StartAuditCollector 启动后台日志采集协程
func StartAuditCollector(configDir string) {
	log.Println("🚀 [审计] 启动全渠道日志采集器 (周期: 1分钟)...")
	go func() {
		for {
			err := syncAllLogs(configDir)
			if err != nil {
				log.Printf("⚠️ [审计] 同步日志出错: %v", err)
			}
			time.Sleep(1 * time.Minute)
		}
	}()

	// 启动清理协程
	go func() {
		for {
			// 每天凌晨清理一次
			CleanupAuditData()
			time.Sleep(24 * time.Hour)
		}
	}()
}

func CleanupAuditData() {
	log.Println("🧹 [审计] 正在执行 7 天数据滚动清理...")
	affected, err := utils.CleanupOldData(7)
	if err != nil {
		log.Printf("❌ [审计] 清理旧数据失败: %v", err)
	} else {
		log.Printf("✅ [审计] 清理完成，移除 %d 条过期记录", affected)
	}
}

func syncAllLogs(configDir string) error {
	agentsDir := filepath.Join(configDir, "agents")

	if _, err := os.Stat(agentsDir); os.IsNotExist(err) {
		return nil
	}

	return filepath.Walk(agentsDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() && strings.HasSuffix(info.Name(), ".jsonl") {
			// 只采集 sessions 目录下的对话日志
			if strings.Contains(path, "/sessions/") {
				return syncFile(path)
			}
		}
		return nil
	})
}

func syncFile(filePath string) error {
	f, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer f.Close()

	var lastOffset int64
	err = utils.DB.QueryRow("SELECT last_offset FROM audit_log_offsets WHERE file_path = ?", filePath).Scan(&lastOffset)
	if err != nil {
		lastOffset = 0
	}

	info, err := f.Stat()
	if err != nil {
		return err
	}

	if info.Size() < lastOffset {
		// 文件可能被重置，从头开始
		lastOffset = 0
	}

	if info.Size() == lastOffset {
		return nil
	}

	_, err = f.Seek(lastOffset, 0)
	if err != nil {
		return err
	}

	reader := bufio.NewReader(f)
	currentOffset := lastOffset

	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			if err == io.EOF {
				break
			}
			return err
		}
		currentOffset += int64(len(line))
		parseAndSaveLine(filePath, line)
	}

	_, err = utils.DB.Exec("INSERT OR REPLACE INTO audit_log_offsets (file_path, last_offset, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)", filePath, currentOffset)
	return err
}

type v3LogLine struct {
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
	Message   struct {
		Role            string `json:"role"`
		Model           string `json:"model"`
		Usage           map[string]interface{} `json:"usage"`
		InboundMetadata map[string]interface{} `json:"inboundMetadata"`
		Content         []struct {
			Type      string `json:"type"`
			Name      string `json:"name"`
			Arguments json.RawMessage `json:"arguments"`
		} `json:"content"`
	} `json:"message"`
}

func parseAndSaveLine(filePath string, line string) {
	var ll v3LogLine
	if err := json.Unmarshal([]byte(line), &ll); err != nil {
		return
	}

	// 提取 agentId
	parts := strings.Split(filePath, string(os.PathSeparator))
	agentId := "unknown"
	for i, p := range parts {
		if p == "agents" && i+1 < len(parts) {
			agentId = parts[i+1]
			break
		}
	}

	// 提取 sessionKey：使用文件名作为会话标识，并与 agentId 拼接避免跨 agent 冲突
	sessionFile := filepath.Base(filePath)
	sessionBase := strings.TrimSuffix(sessionFile, filepath.Ext(sessionFile))
	sessionKey := agentId + ":" + sessionBase

	ts, _ := time.Parse(time.RFC3339, ll.Timestamp)
	if ts.IsZero() {
		ts = time.Now()
	}

	tsStr := ts.Format("2006-01-02 15:04:05")

	if ll.Type == "message" {
		// 1. 处理 Token 消耗
		if ll.Message.Usage != nil {
			input := int64(asFloat64(ll.Message.Usage["input"]))
			output := int64(asFloat64(ll.Message.Usage["output"]))
			model := ll.Message.Model
			if model == "" {
				model = "unknown"
			}
			channelId := "unknown"
			if ll.Message.InboundMetadata != nil {
				channelId = asString(ll.Message.InboundMetadata["channel"])
			}

			if input > 0 || output > 0 {
				_, _ = utils.DB.Exec("INSERT INTO audit_usage (session_key, agent_id, channel_id, model_id, prompt_tokens, completion_tokens, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)",
					sessionKey, agentId, channelId, model, input, output, tsStr)
			}
		}

		// 2. 处理工具调用和安全审计
		for _, c := range ll.Message.Content {
			if c.Type == "toolCall" {
				// 记录工具调用
				_, _ = utils.DB.Exec("INSERT INTO audit_tool_calls (session_key, agent_id, tool_name, timestamp) VALUES (?, ?, ?, ?)",
					sessionKey, agentId, c.Name, tsStr)

				// 安全审计
				if c.Name == "exec" || c.Name == "shell" {
					var args map[string]interface{}
					if err := json.Unmarshal(c.Arguments, &args); err == nil {
						cmd := asString(args["command"])
						if cmd != "" {
							riskLevel := "low"
							for _, p := range securityPatterns {
								if p.MatchString(cmd) {
									riskLevel = "high"
									break
								}
							}
							_, _ = utils.DB.Exec("INSERT INTO audit_security_events (session_key, agent_id, command, risk_level, timestamp) VALUES (?, ?, ?, ?, ?)",
								sessionKey, agentId, cmd, riskLevel, tsStr)
						}
					}
				}
			}
		}
	}
}

func asFloat64(v interface{}) float64 {
	if v == nil {
		return 0
	}
	switch t := v.(type) {
	case float64:
		return t
	case int:
		return float64(t)
	case int64:
		return float64(t)
	case json.Number:
		f, _ := t.Float64()
		return f
	}
	return 0
}

func asString(v interface{}) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}
