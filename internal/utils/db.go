package utils

import (
	"database/sql"
	"fmt"
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

	activeToken, err := createTables(existingToken)
	if err != nil {
		return "", fmt.Errorf("failed to create tables: %v", err)
	}

	return activeToken, nil
}

func createTables(existingToken string) (string, error) {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS health_checks (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
			status TEXT,
			response_time_ms INTEGER,
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
	}

	for _, query := range queries {
		_, err := DB.Exec(query)
		if err != nil {
			return "", err
		}
	}

	// 初始化“首次启动时间”
	firstRun := GetSetting("first_run_at", "")
	activeToken := ""
	if firstRun == "" {
		now := time.Now().Format("2006-01-02 15:04:05")
		_ = SetSetting("first_run_at", now)

		// 首次启动：只有当传入 Token 为空或显式的占位符时，才重新生成随机 Token
		if existingToken == "" || strings.HasPrefix(existingToken, "sk-replace-me") {
			activeToken = generateRandomToken(16)
			_ = UpdateEnvToken(activeToken)
		}
	}

	// 初始化默认快捷指令 (系统级指令，不可删除)
	defaults := []struct{ Label, Prompt, Icon string }{
		{"我的 Soul", "告诉我关于 我的 Soul 的配置信息", "Sparkles"},
		{"我的 Identity", "告诉我关于 我的 Identity 的配置信息", "UserCircle"},
		{"我的 Memory", "我们今天都聊了啥，看看记忆的内容", "Brain"},
		{"我当前的模型", "我当前使用的什么模型", "Bot"},
		{"系统模型列表", "系统目前配置了哪些模型", "Cpu"},
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

	return rowsAffected, nil
}
