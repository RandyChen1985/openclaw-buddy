package process

import (
	"fmt"
	"openclaw-buddy/internal/utils"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
)

func AddOpenClawBot(id, model, workspace string) error {
	// 如果 workspace 为空，则根据 id 自动生成
	if workspace == "" {
		workspace = fmt.Sprintf("~/.openclaw/workspace_%s", id)
	}

	// 执行 openclaw agents add [id] --model [model] --workspace [workspace]
	cmd := exec.Command("openclaw", "agents", "add", id, "--model", model, "--workspace", workspace)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to add agent: %v. Output: %s", err, string(out))
	}
	return nil
}

func SetOpenClawBotIdentity(id, name string) error {
	// 1. 执行 openclaw agents set-identity --agent [id] --name "[name]"
	cmd := exec.Command("openclaw", "agents", "set-identity", "--agent", id, "--name", name)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to set identity: %v. Output: %s", err, string(out))
	}

	// 2. 兜底逻辑：同步修改 IDENTITY.md 文件中的 - **Name:** 字段
	// 我们需要先找到该机器人的工作区
	configDir := filepath.Dir(os.Getenv("OPENCLAW_CONFIG"))
	if configDir == "." || configDir == "" {
		configDir = utils.ExpandPath("~/.openclaw")
	}

	res, err := GetOpenClawBotsModels(configDir)
	if err == nil {
		var workspace string
		for _, bot := range res.Bots {
			if bot.ID == id {
				workspace = bot.Workspace
				break
			}
		}

		if workspace != "" {
			identityPath := filepath.Join(utils.ExpandPath(workspace), "IDENTITY.md")
			if content, err := os.ReadFile(identityPath); err == nil {
				// 使用正则替换 - **Name:** 后面的内容
				re := regexp.MustCompile(`(?m)^- \*\*Name:\*\*.*$`)
				newContent := re.ReplaceAllString(string(content), fmt.Sprintf("- **Name:** %s", name))
				_ = os.WriteFile(identityPath, []byte(newContent), 0644)
			}
		}
	}

	return nil
}

func DeleteOpenClawBot(id string) error {
	// 执行 openclaw agents delete [id] --force
	cmd := exec.Command("openclaw", "agents", "delete", id, "--force")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to delete agent: %v. Output: %s", err, string(out))
	}
	return nil
}

func SetOpenClawDefaultModel(modelID string) error {
	cmd := exec.Command("openclaw", "models", "set", modelID)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to set default model: %v (%s)", err, string(out))
	}
	return nil
}

func SetOpenClawBotModel(configDir, botID, modelID string) error {
	return UpdateOpenClawBotConfig(configDir, botID, nil, &modelID)
}

// UpdateOpenClawBotConfig 统一更新机器人的基本配置 (名称、模型等)
// 采用一次性读写模式，防止并发修改 openclaw.json 产生冲突
func UpdateOpenClawBotConfig(configDir, botID string, name, model *string) error {
	// 1. 如果传入了名称，调用官方命令执行 Identity 设置 (不要手动改文件中的 name)
	if name != nil {
		if err := SetOpenClawBotIdentity(botID, *name); err != nil {
			return fmt.Errorf("failed to set identity via CLI: %v", err)
		}
	}

	// 2. 只有在修改模型时，才执行磁盘 JSON 物理重写逻辑
	if model != nil {
		return updateOpenClawConfig(configDir, func(fullCfg map[string]interface{}) error {
			agents, ok := fullCfg["agents"].(map[string]interface{})
			if !ok {
				return fmt.Errorf("invalid config: agents key not found")
			}

			list, ok := agents["list"].([]interface{})
			if !ok {
				return fmt.Errorf("invalid config: agents.list not found or not an array")
			}

			found := false
			for i := range list {
				bot, ok := list[i].(map[string]interface{})
				if !ok {
					continue
				}
				if id, ok := bot["id"].(string); ok && id == botID {
					// 修改模型
					bot["model"] = *model
					found = true
					break
				}
			}

			if !found {
				return fmt.Errorf("bot with ID '%s' not found", botID)
			}

			return nil
		})
	}

	return nil
}
