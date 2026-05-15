package process

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type OpenClawGatewayConfig struct {
	Host           string `json:"host"` // 允许用户在 openclaw.json 中直接写 host（简单模式）
	Bind           string `json:"bind"`
	CustomBindHost string `json:"customBindHost"`
	Port           int    `json:"port"`
	Mode           string `json:"mode"`
	Auth           struct {
		Token string `json:"token"`
	} `json:"auth"`
	HTTP struct {
		Endpoints struct {
			ChatCompletions struct {
				Enabled bool `json:"enabled"`
			} `json:"chatCompletions"`
		} `json:"endpoints"`
	} `json:"http"`
}

func (cfg *OpenClawGatewayConfig) GetGatewayHosts() []string {
	// 尝试连接的目标地址列表：优先 127.0.0.1
	hosts := []string{"127.0.0.1"}

	// 1. 如果配置了自定义 host (Buddy 扩展字段)
	if cfg.Host != "" && cfg.Host != "127.0.0.1" && cfg.Host != "localhost" {
		hosts = append(hosts, cfg.Host)
	}

	// 2. 如果配置了 OpenClaw 标准的 customBindHost
	if (cfg.Bind == "custom" || cfg.Bind == "") && cfg.CustomBindHost != "" {
		if cfg.CustomBindHost != "127.0.0.1" && cfg.CustomBindHost != "0.0.0.0" && cfg.CustomBindHost != cfg.Host {
			hosts = append(hosts, cfg.CustomBindHost)
		}
	}

	return hosts
}
func GetOpenClawGatewayConfig(configDir string) (*OpenClawGatewayConfig, error) {
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read openclaw.json: %v", err)
	}

	var cfg struct {
		Gateway OpenClawGatewayConfig `json:"gateway"`
	}

	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("failed to unmarshal openclaw.json: %v", err)
	}

	return &cfg.Gateway, nil
}

func EnableChatCompletions(configDir string) error {
	return updateOpenClawConfig(configDir, func(fullCfg map[string]interface{}) error {
		gateway := ensureMap(fullCfg, "gateway")
		httpCfg := ensureMap(gateway, "http")
		endpoints := ensureMap(httpCfg, "endpoints")
		chatCompletions := ensureMap(endpoints, "chatCompletions")
		chatCompletions["enabled"] = true
		return nil
	})
}
