package utils

import (
	"database/sql"
	"fmt"
	"log"
	"math/rand"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

func InitDB(dbPath string, existingToken string) (string, error) {
	// Ensure directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return "", fmt.Errorf("failed to create db directory: %v", err)
	}

	var err error
	DB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return "", fmt.Errorf("failed to open database: %v", err)
	}

	if err = DB.Ping(); err != nil {
		return "", fmt.Errorf("failed to ping database: %v", err)
	}

	log.Printf("📦 [数据库] 正在从路径加载对话数据服务: %s", dbPath)
	activeToken, err := createTables(existingToken)
	if err != nil {
		return "", fmt.Errorf("failed to create tables: %v", err)
	}

	log.Println("✅ [数据库] 数据架构已就绪")
	RecordSystemEvent("INFO", "数据库引擎启动，架构检查完成")
	return activeToken, nil
}

func createTables(existingToken string) (string, error) {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS health_checks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
			status TEXT,
			response_time_ms INTEGER,
			cpu_usage REAL,
			mem_usage REAL,
			error_msg TEXT
		);`,
		`CREATE TABLE IF NOT EXISTS heal_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
			reason TEXT,
			method TEXT,
			result TEXT,
			report_path TEXT,
			verify_retries INTEGER DEFAULT 0,
			verify_duration_ms INTEGER DEFAULT 0,
			verify_error TEXT
		);`,
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT
		);`,
		`CREATE TABLE IF NOT EXISTS data_caches (
			key TEXT PRIMARY KEY,
			value TEXT,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS quick_commands (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			label TEXT NOT NULL,
			prompt TEXT NOT NULL,
			icon TEXT,
			is_system INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS system_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
			event_type TEXT, -- 'INFO', 'WARN', 'HEAL', 'UPDATE', 'CONTROL'
			message TEXT
		);`,
		`CREATE TABLE IF NOT EXISTS tasks (
			id TEXT PRIMARY KEY,
			name TEXT,
			module TEXT,
			action TEXT,
			target TEXT,
			status TEXT,
			progress INTEGER DEFAULT 0,
			payload TEXT,
			result TEXT,
			error TEXT,
			start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
			end_time DATETIME
		);`,
	}

	for _, query := range queries {
		_, err := DB.Exec(query)
		if err != nil {
			return "", err
		}
	}
	log.Println("✅ [数据库] 基础表结构校验完成")

	// 增量迁移检查
	_, _ = DB.Exec("ALTER TABLE health_checks ADD COLUMN cpu_usage REAL")
	_, _ = DB.Exec("ALTER TABLE health_checks ADD COLUMN mem_usage REAL")
	_, _ = DB.Exec("ALTER TABLE tasks ADD COLUMN command TEXT")
	_, _ = DB.Exec("ALTER TABLE heal_events ADD COLUMN verify_retries INTEGER DEFAULT 0")
	_, _ = DB.Exec("ALTER TABLE heal_events ADD COLUMN verify_duration_ms INTEGER DEFAULT 0")
	_, _ = DB.Exec("ALTER TABLE heal_events ADD COLUMN verify_error TEXT")

	// 初始化“首次启动时间”
	firstRun := GetSetting("first_run_at", "")
	activeToken := ""
	if firstRun == "" {
		now := time.Now().Format("2006-01-02 15:04:05")
		_ = SetSetting("first_run_at", now)
		_ = SetSetting("self_healing_enabled", "true")

		if existingToken == "" || strings.HasPrefix(existingToken, "sk-replace-me") {
			activeToken = generateRandomToken(16)
			_ = UpdateEnvToken(activeToken)
		}
	}

	// 初始化默认快捷指令
	defaults := []struct{ Label, Prompt, Icon string }{
		{"🍭我的 Soul", "告诉我关于 我的 Soul 的配置信息", "Sparkles"},
		{"👤我的 Identity", "告诉我关于 我的 Identity 的配置信息", "UserCircle"},
		{"🧠我的 Memory", "我们今天都聊了啥，看看记忆的内容", "Brain"},
		{"🤖我当前的模型", "我当前使用的什么模型", "Bot"},
		{"🖥️系统模型列表", "系统目前配置了哪些模型", "Cpu"},
		{"📊会话状态", "查看我的会话状态/status", "Activity"},
		{"🔄重置会话", "/reset", "RotateCcw"},
		{"🛑终止会话", "/stop", "StopCircle"},
	}
	
	_, _ = DB.Exec("DELETE FROM quick_commands WHERE is_system = 1")
	for _, d := range defaults {
		_, _ = DB.Exec("INSERT INTO quick_commands (label, prompt, icon, is_system) VALUES (?, ?, ?, 1)", d.Label, d.Prompt, d.Icon)
	}

	return activeToken, nil
}

func generateRandomToken(n int) string {
	const letters = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
	rand.Seed(time.Now().UnixNano())
	b := make([]byte, n)
	for i := range b {
		b[i] = letters[rand.Intn(len(letters))]
	}
	return "sk-" + string(b)
}

func UpdateEnvToken(newToken string) error {
	envPath := "env"
	content, err := os.ReadFile(envPath)
	if err != nil {
		return err
	}

	re := regexp.MustCompile(`(?m)^BUDDY_TOKEN\s*=.*$`)
	newContent := re.ReplaceAllString(string(content), "BUDDY_TOKEN="+newToken)

	if !strings.Contains(newContent, "BUDDY_TOKEN=") {
		newContent += "\nBUDDY_TOKEN=" + newToken
	}

	return os.WriteFile(envPath, []byte(newContent), 0644)
}

func GetSetting(key, defaultValue string) string {
	if DB == nil {
		return defaultValue
	}
	var value string
	err := DB.QueryRow("SELECT value FROM settings WHERE key = ?", key).Scan(&value)
	if err != nil {
		return defaultValue
	}
	return value
}

func SetSetting(key, value string) error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	_, err := DB.Exec("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", key, value)
	return err
}

func GetCache(key string) (string, string, error) {
	if DB == nil {
		return "", "", fmt.Errorf("database not initialized")
	}
	var value string
	var updatedAt string
	err := DB.QueryRow("SELECT value, updated_at FROM data_caches WHERE key = ?", key).Scan(&value, &updatedAt)
	if err != nil {
		return "", "", err
	}
	return value, updatedAt, nil
}

func SetCache(key, value string) error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	_, err := DB.Exec("INSERT OR REPLACE INTO data_caches (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)", key, value)
	return err
}

func CleanupOldData(days int) (int64, error) {
	if DB == nil {
		return 0, fmt.Errorf("database not initialized")
	}

	query := fmt.Sprintf("DELETE FROM health_checks WHERE timestamp < datetime('now', '-%d days')", days)
	res, err := DB.Exec(query)
	if err != nil {
		return 0, err
	}
	rowsAffected, _ := res.RowsAffected()

	_, _ = DB.Exec(fmt.Sprintf("DELETE FROM heal_events WHERE timestamp < datetime('now', '-%d days')", days))
	_, _ = DB.Exec(fmt.Sprintf("DELETE FROM system_events WHERE timestamp < datetime('now', '-%d days')", days))
	_, _ = DB.Exec(fmt.Sprintf("DELETE FROM tasks WHERE start_time < datetime('now', '-%d days')", days))

	return rowsAffected, nil
}

func RecordSystemEvent(eventType, message string) {
	if DB == nil {
		return
	}
	_, err := DB.Exec("INSERT INTO system_events (event_type, message) VALUES (?, ?)", eventType, message)
	if err != nil {
		fmt.Printf("❌ Failed to record system event: %v\n", err)
	}
}

type NullFloat64 struct {
	Float64 float64
	Valid   bool
}

func (n *NullFloat64) Scan(value interface{}) error {
	if value == nil {
		n.Float64, n.Valid = 0, false
		return nil
	}
	n.Valid = true
	switch v := value.(type) {
	case float64:
		n.Float64 = v
	case float32:
		n.Float64 = float64(v)
	case int64:
		n.Float64 = float64(v)
	case int:
		n.Float64 = float64(v)
	default:
		return fmt.Errorf("unsupported type for NullFloat64: %T", value)
	}
	return nil
}
