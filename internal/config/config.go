package config

import (
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

const Version = "1.0.2"

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
	ExternalDashboardURL string
}

func LoadConfig() (*Config, error) {
	_ = godotenv.Load("env") // Load the file named "env" instead of ".env"

	interval, _ := strconv.Atoi(getEnv("CHECK_INTERVAL_SECONDS", "60"))
	maxRetries, _ := strconv.Atoi(getEnv("MAX_RETRIES", "3"))
	healthPort, _ := strconv.Atoi(getEnv("HEALTH_PORT", "18789"))
	webPort, _ := strconv.Atoi(getEnv("WEB_PORT", "3000"))
	feishuEnabled, _ := strconv.ParseBool(getEnv("FEISHU_ENABLED", "false"))

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
		OpenClawConfigDir:    expandPath(getEnv("OPENCLAW_CONFIG_DIR", "~/.openclaw")),
		BackupDir:            getEnv("BACKUP_DIR", "./backups"),
		CheckIntervalSeconds: interval,
		MaxRetries:           maxRetries,
		LogFile:              getEnv("LOG_FILE", "./logs/guardian.log"),
		LogMaxSize:           maxSize,
		LogMaxBackups:        maxBackups,
		LogMaxAge:            maxAge,
		LogCompress:          compress,
		ReportDir:            getEnv("REPORT_DIR", "./reports"),
		HealthPort:           healthPort,
		FeishuEnabled:        feishuEnabled,
		FeishuAppID:          getEnv("FEISHU_APP_ID", ""),
		FeishuAppSecret:      getEnv("FEISHU_APP_SECRET", ""),
		FeishuChatID:         getEnv("FEISHU_CHAT_ID", ""),
		DBFile:               getEnv("DB_FILE", "./data/guardian.db"),
		Token:                getEnv("BUDDY_TOKEN", "sk-replace-me-on-first-run"),
		WebPort:              webPort,
		WebRoot:              webRoot,
		ExternalDashboardURL: getEnv("EXTERNAL_DASHBOARD_URL", ""),
	}, nil
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}

// expandPath 将路径中的 ~ 展开为当前用户的主目录
func expandPath(path string) string {
	if len(path) > 0 && path[0] == '~' {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return home + path[1:]
	}
	return path
}
