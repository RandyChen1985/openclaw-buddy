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

	// 开启 WAL 模式提高并发性能
	_, _ = DB.Exec("PRAGMA journal_mode=WAL;")

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
		`CREATE TABLE IF NOT EXISTS audit_usage (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_key TEXT,
			agent_id TEXT,
			channel_id TEXT,
			model_id TEXT,
			prompt_tokens INTEGER,
			completion_tokens INTEGER,
			timestamp DATETIME
		);`,
		`CREATE TABLE IF NOT EXISTS audit_tool_calls (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_key TEXT,
			agent_id TEXT,
			tool_name TEXT,
			timestamp DATETIME
		);`,
		`CREATE TABLE IF NOT EXISTS audit_security_events (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			session_key TEXT,
			agent_id TEXT,
			command TEXT,
			risk_level TEXT,
			timestamp DATETIME
		);`,
		`CREATE TABLE IF NOT EXISTS audit_log_offsets (
			file_path TEXT PRIMARY KEY,
			last_offset INTEGER,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		// 用户与 RBAC 体系
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			real_name TEXT DEFAULT '',
			remark TEXT DEFAULT '',
			password_hash TEXT NOT NULL,
			status INTEGER DEFAULT 1,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
		);`,
		`CREATE TABLE IF NOT EXISTS roles (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			key TEXT NOT NULL UNIQUE,
			name TEXT NOT NULL,
			remark TEXT DEFAULT '',
			is_builtin INTEGER DEFAULT 0
		);`,
		`CREATE TABLE IF NOT EXISTS permissions (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			key TEXT NOT NULL UNIQUE,
			type TEXT NOT NULL DEFAULT 'menu',
			name TEXT NOT NULL,
			menu_key TEXT DEFAULT '',
			remark TEXT DEFAULT ''
		);`,
		`CREATE TABLE IF NOT EXISTS user_roles (
			user_id INTEGER NOT NULL,
			role_id INTEGER NOT NULL,
			PRIMARY KEY (user_id, role_id)
		);`,
		`CREATE TABLE IF NOT EXISTS role_permissions (
			role_id INTEGER NOT NULL,
			permission_id INTEGER NOT NULL,
			PRIMARY KEY (role_id, permission_id)
		);`,
		// 用户直绑权限（替代 role_permissions 作为实际生效来源）
		`CREATE TABLE IF NOT EXISTS user_permissions (
			user_id INTEGER NOT NULL,
			permission_id INTEGER NOT NULL,
			PRIMARY KEY (user_id, permission_id)
		);`,
		// 用户可用 Bot 列表（用于聊天界面筛选可见 Bot；admin/superadmin 不受限）
		`CREATE TABLE IF NOT EXISTS user_bots (
			user_id INTEGER NOT NULL,
			bot_id TEXT NOT NULL,
			PRIMARY KEY (user_id, bot_id)
		);`,
		`CREATE TABLE IF NOT EXISTS user_sessions (
			token TEXT PRIMARY KEY,
			user_id INTEGER NOT NULL,
			expires_at DATETIME,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP
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
	_, _ = DB.Exec("ALTER TABLE audit_usage ADD COLUMN session_key TEXT")
	_, _ = DB.Exec("ALTER TABLE audit_tool_calls ADD COLUMN session_key TEXT")
	_, _ = DB.Exec("ALTER TABLE audit_security_events ADD COLUMN session_key TEXT")

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

	if err := seedRBACDefaults(); err != nil {
		log.Printf("⚠️ [数据库] RBAC 默认数据初始化失败: %v", err)
	}

	return activeToken, nil
}

// seedRBACDefaults 幂等地写入内置角色与基础权限点。
// 第一期：仅维护一个"用户管理"菜单权限点；普通业务功能默认对所有登录用户开放。
func seedRBACDefaults() error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}

	roles := []struct {
		Key, Name, Remark string
	}{
		{"admin", "管理员", "拥有用户管理等系统级权限"},
		{"user", "普通用户", "仅可使用业务功能，无系统管理权限"},
	}
	for _, r := range roles {
		if _, err := DB.Exec(
			`INSERT INTO roles (key, name, remark, is_builtin) VALUES (?, ?, ?, 1)
			ON CONFLICT(key) DO UPDATE SET name=excluded.name, is_builtin=1`,
			r.Key, r.Name, r.Remark,
		); err != nil {
			return err
		}
	}

	// 菜单权限点：需要与前端侧栏菜单 key 一一对应，便于分配与过滤显示。
	// key 命名约定：menu:<域>:<对象>:<动作>
	permissions := []struct {
		Key, Type, Name, MenuKey, Remark string
	}{
		// 监控中心
		{"menu:monitor:dashboard:view", "menu", "运行状态", "dashboard", "查看运行状态"},
		{"menu:monitor:audit:view", "menu", "审计大屏", "audit", "查看审计大屏"},
		{"menu:monitor:logs:view", "menu", "实时日志", "logs", "查看实时日志"},
		{"menu:monitor:self_healing:manage", "menu", "自愈管理", "tools", "自愈与控制工具"},
		{"menu:monitor:shell:manage", "menu", "运维终端", "shell", "运维终端"},
		{"menu:monitor:security:manage", "menu", "安全中心", "security", "安全策略与白名单"},
		{"menu:monitor:cron:view", "menu", "定时任务", "cron", "查看与同步定时任务"},

		// 资产管理
		{"menu:assets:chat:view", "menu", "在线聊天", "chat", "在线聊天 Web 版"},
		{"menu:assets:tui:view", "menu", "TUI 聊天", "tui", "TUI 聊天"},
		{"menu:assets:bots:manage", "menu", "虾兵蟹将", "bots-models", "机器人与模型管理"},
		{"menu:assets:skills:manage", "menu", "技能管理", "skills", "技能管理"},
		{"menu:assets:plugins:manage", "menu", "插件管理", "plugins", "插件管理"},
		{"menu:assets:experts:view", "menu", "专家市场", "experts", "专家市场"},

		// 绑定中心
		{"menu:binding:channels:manage", "menu", "渠道绑定", "components", "渠道绑定管理"},
		{"menu:binding:devices:manage", "menu", "设备绑定", "devices", "设备绑定管理"},

		// 系统管理
		{"menu:system:user:manage", "menu", "用户管理", "system.users", "查看与维护系统用户/权限"},

		// 外部工具
		{"menu:external:lobster_panel:open", "menu", "龙虾面板", "lobster-panel", "打开外部龙虾面板"},
	}
	for _, p := range permissions {
		if _, err := DB.Exec(
			`INSERT INTO permissions (key, type, name, menu_key, remark) VALUES (?, ?, ?, ?, ?)
			ON CONFLICT(key) DO UPDATE SET type=excluded.type, name=excluded.name, menu_key=excluded.menu_key`,
			p.Key, p.Type, p.Name, p.MenuKey, p.Remark,
		); err != nil {
			return err
		}
	}

	// 注意：权限现在直接挂在用户上；角色仅做展示/预留，不再作为权限来源。

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

	var totalAffected int64

	tables := []struct {
		name string
		col  string
	}{
		{"health_checks", "timestamp"},
		{"heal_events", "timestamp"},
		{"system_events", "timestamp"},
		{"tasks", "start_time"},
		{"audit_usage", "timestamp"},
		{"audit_tool_calls", "timestamp"},
		{"audit_security_events", "timestamp"},
	}

	for _, t := range tables {
		query := fmt.Sprintf("DELETE FROM %s WHERE %s < datetime('now', '-%d days')", t.name, t.col, days)
		res, err := DB.Exec(query)
		if err == nil {
			rows, _ := res.RowsAffected()
			totalAffected += rows
		}
	}

	return totalAffected, nil
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
