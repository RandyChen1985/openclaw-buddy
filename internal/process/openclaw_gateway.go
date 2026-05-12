package process

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type OpenClawGatewayConfig struct {
	Port int    `json:"port"`
	Mode string `json:"mode"`
	Auth struct {
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
