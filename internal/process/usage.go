package process

import (
	"encoding/json"
	"fmt"
	"log"
	"time"

	"openclaw-buddy/internal/utils"
)

// UsageCostResult 代表 openclaw gateway usage-cost --json 的输出结构
type UsageCostResult struct {
	UpdatedAt int64              `json:"updatedAt"`
	Days      int                `json:"days"`
	Daily     []UsageDailyStats  `json:"daily"`
	Totals    UsageTotals        `json:"totals"`
}

type UsageDailyStats struct {
	Date          string  `json:"date"`
	Input         int64   `json:"input"`
	Output        int64   `json:"output"`
	CacheRead     int64   `json:"cacheRead"`
	CacheWrite    int64   `json:"cacheWrite"`
	TotalTokens   int64   `json:"totalTokens"`
	TotalCost     float64 `json:"totalCost"`
	InputCost     float64 `json:"inputCost"`
	OutputCost    float64 `json:"outputCost"`
	CacheReadCost float64 `json:"cacheReadCost"`
}

type UsageTotals struct {
	Input         int64   `json:"input"`
	Output        int64   `json:"output"`
	CacheRead     int64   `json:"cacheRead"`
	CacheWrite    int64   `json:"cacheWrite"`
	TotalTokens   int64   `json:"totalTokens"`
	TotalCost     float64 `json:"totalCost"`
}

// GetUsageCost 调用 openclaw gateway usage-cost --json --days [days] 并解析结果
// 支持基于数据库的缓存，TTL 为 1 小时
func GetUsageCost(days int, force bool) (*UsageCostResult, error) {
	if days <= 0 {
		days = 7
	}

	key := fmt.Sprintf("gateway_usage_cost_%d", days)

	// 1. 尝试从缓存读取 (除非强制刷新)
	if !force {
		cachedVal, updatedAt, err := utils.GetCache(key)
		if err == nil && cachedVal != "" {
			// 校验缓存有效期 (1小时)
			// SQLite CURRENT_TIMESTAMP 格式通常为 2006-01-02 15:04:05
			updateTime, parseErr := time.Parse("2006-01-02 15:04:05", updatedAt)
			if parseErr == nil && time.Since(updateTime) < 1*time.Hour {
				var result UsageCostResult
				if err := json.Unmarshal([]byte(cachedVal), &result); err == nil {
					log.Printf("📥 [Usage] 命中数据库缓存 (Key: %s, 更新时间: %s)", key, updatedAt)
					return &result, nil
				}
			}
		}
	}

	bin := GetOpenClawBinary()
	args := []string{"gateway", "usage-cost", "--json", "--days", fmt.Sprintf("%d", days)}
	
	log.Printf("📊 [Usage] 缓存失效或强制刷新，执行命令: %s %v", bin, args)
	res, err := RunCommandWithTimeout(15*time.Second, bin, args...)
	if err != nil {
		return nil, fmt.Errorf("failed to execute usage-cost command: %v", err)
	}

	if !res.Success {
		return nil, fmt.Errorf("usage-cost command failed: %s (code: %d)", res.Error, res.ReturnCode)
	}

	var result UsageCostResult
	jsonStr := ExtractJSON(res.Stdout)
	if err := json.Unmarshal([]byte(jsonStr), &result); err != nil {
		log.Printf("⚠️ [Usage] 反序列化 JSON 失败: %v, Stdout: %s, Stderr: %s", err, res.Stdout, res.Stderr)
		return nil, fmt.Errorf("failed to parse usage-cost output: %v", err)
	}

	// 3. 写入缓存
	if jsonData, err := json.Marshal(result); err == nil {
		if cacheErr := utils.SetCache(key, string(jsonData)); cacheErr != nil {
			log.Printf("⚠️ [Usage] 写入缓存失败: %v", cacheErr)
		} else {
			log.Printf("💾 [Usage] 数据已存入缓存 (Key: %s)", key)
		}
	}

	return &result, nil
}
