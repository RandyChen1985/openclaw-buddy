package config

import (
	"os"
	"strconv"

	"github.com/joho/godotenv"
)

type Config struct {
	OpenClawConfigDir    string
	CheckIntervalSeconds int
	LogFile              string
	ReportDir            string
	HealthPort           int
	FeishuEnabled        bool
	FeishuAppID          string
	FeishuAppSecret      string
	FeishuChatID         string
}

func LoadConfig() (*Config, error) {
	_ = godotenv.Load("env") // Load the file named "env" instead of ".env"

	interval, _ := strconv.Atoi(getEnv("CHECK_INTERVAL_SECONDS", "30"))
	healthPort, _ := strconv.Atoi(getEnv("HEALTH_PORT", "18789"))
	feishuEnabled, _ := strconv.ParseBool(getEnv("FEISHU_ENABLED", "false"))

	return &Config{
		OpenClawConfigDir:    getEnv("OPENCLAW_CONFIG_DIR", os.Getenv("HOME")+"/.openclaw"),
		CheckIntervalSeconds: interval,
		LogFile:              getEnv("LOG_FILE", "./logs/guardian.log"),
		ReportDir:            getEnv("REPORT_DIR", "./reports"),
		HealthPort:           healthPort,
		FeishuEnabled:        feishuEnabled,
		FeishuAppID:          getEnv("FEISHU_APP_ID", ""),
		FeishuAppSecret:      getEnv("FEISHU_APP_SECRET", ""),
		FeishuChatID:         getEnv("FEISHU_CHAT_ID", ""),
	}, nil
}

func getEnv(key, fallback string) string {
	if value, ok := os.LookupEnv(key); ok {
		return value
	}
	return fallback
}
