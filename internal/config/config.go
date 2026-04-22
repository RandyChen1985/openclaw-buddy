package config

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"openclaw-buddy/internal/utils"

	"github.com/joho/godotenv"
)

var Version = "1.0.6"

type Config struct {
	OpenClawConfigDir    string
	BackupDir            string
	CheckIntervalSeconds int
	MaxRetries           int
	LogFile              string
	LogMaxSize           int  // 每个日志文件最大 MB 数
	LogMaxBackups        int  // 保留旧日志文件的最大个数
	LogMaxAge            int  // 保留旧日志文件的最大天数
	LogCompress          bool // 是否压缩旧日志
	ReportDir            string
	HealthPort           int
	FeishuEnabled        bool
	FeishuAppID          string
	FeishuAppSecret      string
	FeishuChatID         string
	DBFile               string
	Token                string
	WebPort              int
	WebRoot              string
	CORSAllowOrigins     string
	ExternalDashboardURL string
	GUIDisableFeatures   string
	ShowExternalTools    bool
	CacheSyncOnStartup   bool
	CacheSyncConcurrency int
}

func LoadConfig() (*Config, error) {
	_ = ensureEnvFile()
	_ = godotenv.Load("env") // Load the file named "env" instead of ".env"

	interval, _ := strconv.Atoi(getEnv("CHECK_INTERVAL_SECONDS", "60"))
	maxRetries, _ := strconv.Atoi(getEnv("MAX_RETRIES", "3"))
	healthPort, _ := strconv.Atoi(getEnv("HEALTH_PORT", "18789"))
	webPort, _ := strconv.Atoi(getEnv("WEB_PORT", "3000"))
	feishuEnabled, _ := strconv.ParseBool(getEnv("FEISHU_ENABLED", "false"))
	showExternalTools, _ := strconv.ParseBool(getEnv("SHOW_EXTERNAL_TOOLS", "false"))
	cacheSyncOnStartup, _ := strconv.ParseBool(getEnv("CACHE_SYNC_ON_STARTUP", "true"))
	cacheSyncConcurrency, _ := strconv.Atoi(getEnv("CACHE_SYNC_CONCURRENCY", "2"))

	// 规范化 WebRoot
	webRoot := getEnv("WEB_ROOT", "/")
	if webRoot == "" || webRoot == "/" {
		webRoot = "/"
	} else {
		if webRoot[0] != '/' {
			webRoot = "/" + webRoot
		}
		if len(webRoot) > 1 && webRoot[len(webRoot)-1] == '/' {
			webRoot = webRoot[:len(webRoot)-1]
		}
	}

	// 日志轮转配置
	maxSize, _ := strconv.Atoi(getEnv("LOG_MAX_SIZE", "10"))
	maxBackups, _ := strconv.Atoi(getEnv("LOG_MAX_BACKUPS", "5"))
	maxAge, _ := strconv.Atoi(getEnv("LOG_MAX_AGE", "7"))
	compress, _ := strconv.ParseBool(getEnv("LOG_COMPRESS", "true"))

	return &Config{
		OpenClawConfigDir:    filepath.Clean(utils.ExpandPath(getEnv("OPENCLAW_CONFIG_DIR", "~/.openclaw"))),
		BackupDir:            filepath.Clean(getEnv("BACKUP_DIR", "./backups")),
		CheckIntervalSeconds: interval,
		MaxRetries:           maxRetries,
		LogFile:              filepath.Clean(getEnv("LOG_FILE", "./logs/guardian.log")),
		LogMaxSize:           maxSize,
		LogMaxBackups:        maxBackups,
		LogMaxAge:            maxAge,
		LogCompress:          compress,
		ReportDir:            filepath.Clean(getEnv("REPORT_DIR", "./reports")),
		HealthPort:           healthPort,
		FeishuEnabled:        feishuEnabled,
		FeishuAppID:          getEnv("FEISHU_APP_ID", ""),
		FeishuAppSecret:      getEnv("FEISHU_APP_SECRET", ""),
		FeishuChatID:         getEnv("FEISHU_CHAT_ID", ""),
		DBFile:               filepath.Clean(getEnv("DB_FILE", "./data/guardian.db")),
		Token:                strings.TrimSpace(getEnv("BUDDY_TOKEN", "sk-replace-me-on-first-run")),
		WebPort:              webPort,
		WebRoot:              webRoot,
		CORSAllowOrigins:     strings.TrimSpace(getEnv("CORS_ALLOW_ORIGINS", "https://yovole.com")),
		ExternalDashboardURL: getEnv("EXTERNAL_DASHBOARD_URL", ""),
		GUIDisableFeatures:   getEnv("GUI_DISABLE_FEATURES", ""),
		ShowExternalTools:    showExternalTools,
		CacheSyncOnStartup:   cacheSyncOnStartup,
		CacheSyncConcurrency: cacheSyncConcurrency,
	}, nil
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}


func ensureEnvFile() error {
	_ = os.MkdirAll("data", 0755)
	_ = os.MkdirAll("pid", 0755)

	if _, err := os.Stat("env"); err == nil {
		return nil
	}

	// Generate random token
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	token := "sk-" + hex.EncodeToString(b)

	content := fmt.Sprintf(`# 🦞 OpenClaw Buddy (Auto-generated)
# Guardian 面板监听端口
WEB_PORT=3000
# 基础路径
WEB_ROOT="/"
# 访问面板所需的认证令牌 (已自动生成)
BUDDY_TOKEN="%s"

# [网络与安全]
# 允许跨域访问的 Origin 白名单（逗号分隔）。留空则默认仅允许同源/本机访问。
# 例：CORS_ALLOW_ORIGINS="https://console.example.com,http://localhost:5173"
CORS_ALLOW_ORIGINS="https://yovole.com"

# [存储与目录]
DB_FILE="./data/guardian.db"
OPENCLAW_CONFIG_DIR="~/.openclaw"
BACKUP_DIR="./backups"
LOG_FILE="./logs/guardian.log"
REPORT_DIR="./reports"

# [监控策略]
CHECK_INTERVAL_SECONDS=60
HEALTH_PORT=18789
MAX_RETRIES=3

# [缓存同步]
# 启动时是否执行一次全量缓存同步（会调用 openclaw CLI，多进程并发可能造成 CPU 峰值）
CACHE_SYNC_ON_STARTUP=true
# 全量同步时的并发上限（建议 1-3；过大可能造成启动 CPU 飙升）
CACHE_SYNC_CONCURRENCY=2

# [高级选项]
EXTERNAL_DASHBOARD_URL=""
GUI_DISABLE_FEATURES=""
# 是否在侧边栏显示“外部工具”菜单组 (龙虾面板跳转)
SHOW_EXTERNAL_TOOLS=false

# [飞书通知]
FEISHU_ENABLED=false
`, token)

	return os.WriteFile("env", []byte(content), 0644)
}
