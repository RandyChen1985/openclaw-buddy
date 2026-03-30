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
			report_path TEXT
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
	}

	for _, query := range queries {
		_, err := DB.Exec(query)
		if err != nil {
			return "", err
		}
	}
	log.Println("✅ [数据库] 基础表结构校验完成")

	// 增量迁移检查：为旧的 health_checks 表添加 cpu_usage / mem_usage 字段
	log.Println("🔄 [数据库] 检查增量迁移: health_checks (资源指标需求)")
	_, _ = DB.Exec("ALTER TABLE health_checks ADD COLUMN cpu_usage REAL")
	_, _ = DB.Exec("ALTER TABLE health_checks ADD COLUMN mem_usage REAL")

	// 增量迁移检查：修复可能存在的损坏的 quick_commands 表 (之前版本可能误删了字段)
	var hasLabel int
	_ = DB.QueryRow("SELECT count(*) FROM pragma_table_info('quick_commands') WHERE name='label'").Scan(&hasLabel)
	if hasLabel == 0 {
		log.Println("🛠️  [数据库] 修复损坏架构: quick_commands (补全核心字段)")
		// 如果没有 label 字段，说明是损坏的表，我们需要重建它
		// 注意：损坏的表通常只有 created_at 字段，没有有效数据，直接重建是安全的
		_, _ = DB.Exec("DROP TABLE IF EXISTS quick_commands_old")
		_, _ = DB.Exec("ALTER TABLE quick_commands RENAME TO quick_commands_old")
		_, _ = DB.Exec(`CREATE TABLE IF NOT EXISTS quick_commands (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			label TEXT NOT NULL,
			prompt TEXT NOT NULL,
			icon TEXT,
			is_system INTEGER DEFAULT 0,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`)
		// 尝试从旧表恢复数据（虽然损坏表通常没数据，但为了保险）
		// 由于字段完全不匹配，通常无法 INSERT INTO ... SELECT，这里我们选择直接删除旧表
		_, _ = DB.Exec("DROP TABLE IF EXISTS quick_commands_old")
	}

	// 初始化“首次启动时间”
	firstRun := GetSetting("first_run_at", "")
	activeToken := ""
	if firstRun == "" {
		now := time.Now().Format("2006-01-02 15:04:05")
		_ = SetSetting("first_run_at", now)
		_ = SetSetting("self_healing_enabled", "true")

		// 首次启动：只有当传入 Token 为空或显式的占位符时，才重新生成随机 Token
		if existingToken == "" || strings.HasPrefix(existingToken, "sk-replace-me") {
			activeToken = generateRandomToken(16)
			_ = UpdateEnvToken(activeToken)
		}
	}

	// 初始化默认快捷指令 (系统级指令，不可删除)
	defaults := []struct{ Label, Prompt, Icon string }{
		{"🍭我的 Soul", "告诉我关于 我的 Soul 的配置信息", "Sparkles"},
		{"👤我的 Identity", "告诉我关于 我的 Identity 的配置信息", "UserCircle"},
		{"🧠我的 Memory", "我们今天都聊了啥，看看记忆的内容", "Brain"},
		{"🤖我当前的模型", "我当前使用的什么模型", "Bot"},
		{"🖥️系统模型列表", "系统目前配置了哪些模型", "Cpu"},
	}
	for _, d := range defaults {
		var exists int
		_ = DB.QueryRow("SELECT COUNT(*) FROM quick_commands WHERE label = ?", d.Label).Scan(&exists)
		if exists == 0 {
			_, _ = DB.Exec("INSERT INTO quick_commands (label, prompt, icon, is_system) VALUES (?, ?, ?, 1)", d.Label, d.Prompt, d.Icon)
		}
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

	// 如果没找到，追加到末尾
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

	queryHeal := fmt.Sprintf("DELETE FROM heal_events WHERE timestamp < datetime('now', '-%d days')", days)
	_, _ = DB.Exec(queryHeal)

	queryEvents := fmt.Sprintf("DELETE FROM system_events WHERE timestamp < datetime('now', '-%d days')", days)
	_, _ = DB.Exec(queryEvents)

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

// NullFloat64 兼容 SQLite 的 NULL 浮点数
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
