package process

import (
	"encoding/json"
	"log"
	"sync"
	"time"
	"openclaw-buddy/internal/utils"
)

// SyncAll 刷所有缓存 (并发模式)
func SyncAll(configDir string) {
	log.Println("🔄 [Cache] 开始全量并发同步业务数据...")
	
	start := time.Now()
	var wg sync.WaitGroup

	// 定义并发任务列表
	tasks := []struct {
		key string
		fn  func() (any, error)
	}{
		{"bots_models", func() (any, error) { return GetOpenClawBotsModels(configDir) }},
		{"chat_channels", func() (any, error) { return GetChatChannels() }},
		{"devices", func() (any, error) { return GetOpenClawDevices() }},
		{"skills", func() (any, error) { return GetOpenClawSkills() }},
		{"plugins", func() (any, error) { return GetOpenClawPlugins() }},
		{"cron_jobs", func() (any, error) { return GetOpenClawCronJobs() }},
		{"sessions", func() (any, error) { return GetOpenClawSessions() }},
		{"ranking", func() (any, error) { return GetBotRanking(configDir) }},
		{"security_status", func() (any, error) { return GetSecurityStatusData() }},
	}

	wg.Add(len(tasks))
	for _, t := range tasks {
		go func(key string, fetcher func() (any, error)) {
			defer wg.Done()
			syncKey(key, fetcher)
		}(t.key, t.fn)
	}

	// 等待所有同步协程完成
	wg.Wait()
	log.Printf("✅ [Cache] 全量并发同步完成，总耗时 %v。", time.Since(start))
}

// SyncKeySingle 同步单个 Key
func SyncKeySingle(key string, configDir string) error {
	var fetcher func() (any, error)
	switch key {
	case "bots_models":
		fetcher = func() (any, error) { return GetOpenClawBotsModels(configDir) }
	case "chat_channels":
		fetcher = func() (any, error) { return GetChatChannels() }
	case "devices":
		fetcher = func() (any, error) { return GetOpenClawDevices() }
	case "skills":
		fetcher = func() (any, error) { return GetOpenClawSkills() }
	case "plugins":
		fetcher = func() (any, error) { return GetOpenClawPlugins() }
	case "cron_jobs":
		fetcher = func() (any, error) { return GetOpenClawCronJobs() }
	case "sessions":
		fetcher = func() (any, error) { return GetOpenClawSessions() }
	case "ranking":
		fetcher = func() (any, error) { return GetBotRanking(configDir) }
	case "security_status":
		fetcher = func() (any, error) { return GetSecurityStatusData() }
	default:
		return nil
	}
	
	data, err := fetcher()
	if err != nil {
		return err
	}

	jsonData, _ := json.Marshal(data)
	return utils.SetCache(key, string(jsonData))
}

func syncKey(key string, fetcher func() (any, error)) {
	data, err := fetcher()
	if err != nil {
		log.Printf("❌ [Cache] 同步 %s 失败: %v", key, err)
		return
	}

	jsonData, _ := json.Marshal(data)
	if err := utils.SetCache(key, string(jsonData)); err != nil {
		log.Printf("❌ [Cache] 写入数据库失败 (%s): %v", key, err)
	}
}

// GetCachedData 获取缓存数据
func GetCachedData(key string) (any, string, error) {
	val, updatedAt, err := utils.GetCache(key)
	if err != nil {
		return nil, "", err
	}

	var data any
	if err := json.Unmarshal([]byte(val), &data); err != nil {
		return nil, "", err
	}

	return data, updatedAt, nil
}
