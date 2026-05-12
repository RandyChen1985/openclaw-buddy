package process

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

type OpenClawPlugin struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Version     string   `json:"version"`
	Enabled     bool     `json:"enabled"`
	Status      string   `json:"status"`
	Origin      string   `json:"origin"`
	RootDir     string   `json:"rootDir"`
	Source      string   `json:"source"`
	Error       string   `json:"error,omitempty"`
	ChannelIds  []string `json:"channelIds"`
	ProviderIds []string `json:"providerIds"`
}

// GetOpenClawPlugins 列出插件；configDir 为 OpenClaw 配置目录（内含 openclaw.json），与渠道命令一致注入 OpenClawConfigEnv，避免 CLI 写到默认目录导致与网关不一致。
func GetOpenClawPlugins(configDir string) (any, error) {
	env, err := OpenClawConfigEnv(configDir)
	if err != nil {
		return nil, err
	}
	res, err := RunCommandWithEnvAndTimeout(45*time.Second, env, GetOpenClawBinary(), "plugins", "list", "--json")
	if err != nil {
		return nil, fmt.Errorf("failed to list plugins: %w", err)
	}

	// 清理 ANSI 颜色代码
	cleanOut := StripANSI(res.Output)
	if jsonStr, ok := ExtractFirstJSONValue(cleanOut); ok {
		cleanOut = jsonStr
	} else {
		cleanOut = ExtractJSON(cleanOut) // legacy fallback
	}

	var data struct {
		Plugins []OpenClawPlugin `json:"plugins"`
	}
	decoder := json.NewDecoder(strings.NewReader(cleanOut))
	if err := decoder.Decode(&data); err != nil {
		preview := cleanOut
		if len(preview) > 400 {
			preview = preview[:400] + "...(truncated)"
		}
		return nil, fmt.Errorf("failed to parse plugins json: %v. Output: %s", err, preview)
	}
	return data.Plugins, nil
}

func ReloadOpenClawPlugins() error {
	// 目前版本的 openclaw CLI (2026.3.24) 不支持 plugins reload 子命令。
	// 重载操作由上层 Handler 调用 SyncKeySingle("plugins") 通过执行 list 命令来完成实时的列表扫描。
	return nil
}

func EnableOpenClawPlugin(id string) error {
	cmd := exec.Command("openclaw", "plugins", "enable", id)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to enable plugin %s: %v. Output: %s", id, err, string(out))
	}
	return nil
}

func DisableOpenClawPlugin(id string) error {
	cmd := exec.Command("openclaw", "plugins", "disable", id)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to disable plugin %s: %v. Output: %s", id, err, string(out))
	}
	return nil
}

func UninstallOpenClawPlugin(id string) error {
	cmd := exec.Command("openclaw", "plugins", "uninstall", id)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to uninstall plugin %s: %v. Output: %s", id, err, string(out))
	}
	return nil
}

func UpdateOpenClawPlugins() error {
	cmd := exec.Command("openclaw", "plugins", "update")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to update plugins: %v. Output: %s", err, string(out))
	}
	return nil
}
