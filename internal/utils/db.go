package utils

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
	"math/rand"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

func InitDB(dbPath string) error {
	// Ensure directory exists
	dir := filepath.Dir(dbPath)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("failed to create db directory: %v", err)
	}

	var err error
	DB, err = sql.Open("sqlite", dbPath)
	if err != nil {
		return fmt.Errorf("failed to open database: %v", err)
	}

	if err = DB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %v", err)
	}

	if err = createTables(); err != nil {
		return fmt.Errorf("failed to create tables: %v", err)
	}

	return nil
}

func createTables() error {
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
	}

	for _, query := range queries {
		_, err := DB.Exec(query)
		if err != nil {
			return err
		}
	}

	// 初始化“首次启动时间”
	firstRun := GetSetting("first_run_at", "")
	if firstRun == "" {
		now := time.Now().Format("2006-01-02 15:04:05")
		_ = SetSetting("first_run_at", now)

		// 首次启动：生成随机 Token 并更新 env 文件
		newToken := generateRandomToken(16)
		_ = UpdateEnvToken(newToken)
	}

	return nil
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

	re := regexp.MustCompile(`(?m)^GUARDIAN_TOKEN\s*=.*$`)
	newContent := re.ReplaceAllString(string(content), "GUARDIAN_TOKEN="+newToken)
	
	// 如果没找到，追加到末尾
	if !strings.Contains(newContent, "GUARDIAN_TOKEN=") {
		newContent += "\nGUARDIAN_TOKEN=" + newToken
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
