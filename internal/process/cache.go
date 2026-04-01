package process

import (
	"encoding/json"
	"log"
	"time"
	"openclaw-buddy/internal/utils"
)

// SyncAll 刷所有缓存
func SyncAll(configDir string) {
	log.Println("🔄 [Cache] 开始全量同步业务数据...")
	
	start := time.Now()

	// 1. Bots & Models
	syncKey("bots_models", func() (any, error) {
		return GetOpenClawBotsModels(configDir)
	})

	// 2. Chat Channels
	syncKey("chat_channels", func() (any, error) {
		return GetChatChannels()
	})

	// 3. Devices
	syncKey("devices", func() (any, error) {
		return GetOpenClawDevices()
	})

	// 4. Skills
	syncKey("skills", func() (any, error) {
		return GetOpenClawSkills()
	})

	// 5. Plugins
	syncKey("plugins", func() (any, error) {
		return GetOpenClawPlugins()
	})
	
	// 6. Sessions
	syncKey("sessions", func() (any, error) {
		return GetOpenClawSessions()
	})
	
	// 7. Bot Ranking (机器人活跃榜)
	syncKey("ranking", func() (any, error) {
		return GetBotRanking(configDir)
	})

	log.Printf("✅ [Cache] 全量同步完成，耗时 %v。", time.Since(start))
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
	case "sessions":
		fetcher = func() (any, error) { return GetOpenClawSessions() }
	case "ranking":
		fetcher = func() (any, error) { return GetBotRanking(configDir) }
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
