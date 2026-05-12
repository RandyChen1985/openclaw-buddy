package process

import (
	"encoding/json"
	"os"
	"path/filepath"
)

func openClawConfigPath(configDir string) string {
	return filepath.Join(configDir, "openclaw.json")
}

func readOpenClawConfig(configDir string) (map[string]interface{}, error) {
	data, err := os.ReadFile(openClawConfigPath(configDir))
	if err != nil {
		return nil, err
	}
	var cfg map[string]interface{}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return cfg, nil
}

func updateOpenClawConfig(configDir string, fn func(map[string]interface{}) error) error {
	cfg, err := readOpenClawConfig(configDir)
	if err != nil {
		return err
	}
	if err := fn(cfg); err != nil {
		return err
	}
	newData, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(openClawConfigPath(configDir), newData, 0644)
}

func ensureMap(parent map[string]interface{}, key string) map[string]interface{} {
	v, ok := parent[key]
	if !ok || v == nil {
		m := make(map[string]interface{})
		parent[key] = m
		return m
	}
	m, ok := v.(map[string]interface{})
	if !ok {
		m = make(map[string]interface{})
		parent[key] = m
		return m
	}
	return m
}
