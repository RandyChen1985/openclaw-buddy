package process

import (
	"encoding/json"
	"log"
	"runtime"
	"strings"
	"sync"
	"time"

	"openclaw-buddy/internal/utils"
)

// SyncAll 刷所有缓存 (并发模式)
func SyncAll(configDir string) {
	SyncAllWithConcurrency(configDir, 0)
}

// SyncAllWithConcurrency 刷所有缓存（带并发上限）。
// 启动阶段如果并发启动过多 openclaw CLI 子进程，会造成 CPU 峰值，因此提供并发限流。
func SyncAllWithConcurrency(configDir string, concurrency int) {
	if concurrency <= 0 {
		concurrency = 2
	}
	if concurrency > 8 {
		concurrency = 8
	}
	if runtime.GOMAXPROCS(0) == 1 && concurrency > 1 {
		concurrency = 1
	}

	log.Printf("🔄 [Cache] 开始全量同步业务数据 (并发上限=%d)...", concurrency)

	start := time.Now()

	// 定义任务列表（每个任务通常会触发一次或多次 openclaw CLI 调用）
	tasks := []struct {
		key string
		fn  func() (any, error)
	}{
		{"bots_models", func() (any, error) { return GetOpenClawBotsModels(configDir) }},
		{"chat_channels", func() (any, error) { return GetChatChannels() }},
		{"devices", func() (any, error) { return GetOpenClawDevices() }},
		{"skills", func() (any, error) { return GetOpenClawSkills() }},
		{"plugins", func() (any, error) { return GetOpenClawPlugins(configDir) }},
		{"cron_jobs", func() (any, error) { return GetOpenClawCronJobs() }},
		{"sessions", func() (any, error) { return GetOpenClawSessions() }},
		{"ranking", func() (any, error) { return GetBotRanking(configDir) }},
		{"security_status", func() (any, error) { return GetSecurityStatusData() }},
	}

	type job struct {
		key string
		fn  func() (any, error)
	}

	jobs := make(chan job, len(tasks))
	for _, t := range tasks {
		jobs <- job{key: t.key, fn: t.fn}
	}
	close(jobs)

	var wg sync.WaitGroup
	wg.Add(concurrency)
	for i := 0; i < concurrency; i++ {
		go func() {
			defer wg.Done()
			for j := range jobs {
				syncKey(j.key, j.fn)
			}
		}()
	}

	wg.Wait()
	log.Printf("✅ [Cache] 全量同步完成，总耗时 %v。", time.Since(start))
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
		fetcher = func() (any, error) { return GetOpenClawPlugins(configDir) }
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

// BotIDExistsInCachedBotsModels 判断 agent id 是否出现在 SQLite `data_caches` 键 `bots_models` 的缓存中
//（与面板「虾兵蟹将」同源缓存，由 SyncAll / SyncKeySingle 等写入）。不调用 openclaw CLI。
// 缓存缺失或结构异常时返回 false。
func BotIDExistsInCachedBotsModels(botID string) bool {
	botID = strings.TrimSpace(botID)
	if botID == "" {
		return false
	}
	cached, _, err := GetCachedData("bots_models")
	if err != nil || cached == nil {
		return false
	}
	m, ok := cached.(map[string]interface{})
	if !ok {
		return false
	}
	bots, ok := m["bots"].([]interface{})
	if !ok {
		return false
	}
	for _, b := range bots {
		bm, ok := b.(map[string]interface{})
		if !ok {
			continue
		}
		if strings.TrimSpace(jsonStringish(bm["id"])) == botID {
			return true
		}
	}
	return false
}
