package process

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type OpenClawBot struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	Model        string `json:"model"`
	Emoji        string `json:"emoji"`
	Workspace    string `json:"workspace"`
	AgentDir     string `json:"agentDir"`
	RoutingRules string `json:"routingRules"`
	Routing      string `json:"routing"`
}

type OpenClawModel struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Provider  string `json:"provider"`
	IsDefault bool   `json:"isDefault"`
}

type OpenClawBotsModelsResponse struct {
	Bots     []OpenClawBot     `json:"bots"`
	Models   []OpenClawModel   `json:"models"`
	UpdateAt string            `json:"updated_at"`
}

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

func GetOpenClawBotsModels(configDir string) (*OpenClawBotsModelsResponse, error) {
	res := &OpenClawBotsModelsResponse{
		Bots:   []OpenClawBot{},
		Models: []OpenClawModel{},
	}

	// 1. 解析 Bots: openclaw agents list
	cmdBots := exec.Command("openclaw", "agents", "list")
	outBots, _ := cmdBots.CombinedOutput()

	var currentBot *OpenClawBot
	scannerBots := bufio.NewScanner(strings.NewReader(string(outBots)))
	for scannerBots.Scan() {
		line := scannerBots.Text()
		if IsLogLine(line) {
			continue
		}
		trimmedLine := strings.TrimSpace(StripANSI(line))

		// 匹配 Agent ID: "- main (default)"
		if strings.HasPrefix(trimmedLine, "- ") {
			if currentBot != nil {
				res.Bots = append(res.Bots, *currentBot)
			}
			id := strings.TrimPrefix(trimmedLine, "- ")
			id = strings.Split(id, " ")[0]
			currentBot = &OpenClawBot{ID: id}
		} else if currentBot != nil {
			if strings.Contains(line, "Identity:") {
				// 格式示例 1: Identity: 🤖 云枢智维 (IDENTITY.md)
				// 格式示例 2: Identity: 测试 002 号 (config)
				lineContent := strings.Split(line, "Identity:")[1]
				lineContent = strings.TrimSpace(lineContent)

				// 1. 去掉末尾的 (xxx) 标识
				lastIdx := strings.LastIndex(lineContent, "(")
				namePart := lineContent
				if lastIdx > 0 {
					namePart = strings.TrimSpace(lineContent[:lastIdx])
				}

				// 2. 尝试提取 Emoji (这里采用简单策略：如果有空格且第一部分长度较短，认为是 Emoji)
				parts := strings.SplitN(namePart, " ", 2)
				if len(parts) == 2 {
					// 常见的 Emoji 或者是图标，长度通常在 1-4 字节(UTF-8)
					// 如果第一部分包含非 ASCII 字符或长度极短，我们把它当 Emoji
					first := parts[0]
					isEmoji := false
					for _, r := range first {
						if r > 127 { // 包含非 ASCII，大概率是 Emoji 或中文
							// 如果长度很短(1个字符)，认为是 Emoji
							if len([]rune(first)) == 1 {
								isEmoji = true
							}
							break
						}
					}
					if isEmoji {
						currentBot.Emoji = first
						currentBot.Name = strings.TrimSpace(parts[1])
					} else {
						currentBot.Name = namePart
					}
				} else {
					currentBot.Name = namePart
				}
			} else if strings.Contains(line, "Workspace:") {
				currentBot.Workspace = strings.TrimSpace(strings.Split(line, "Workspace:")[1])
			} else if strings.Contains(line, "Agent dir:") {
				currentBot.AgentDir = strings.TrimSpace(strings.Split(line, "Agent dir:")[1])
			} else if strings.Contains(line, "Model:") {
				currentBot.Model = strings.TrimSpace(strings.Split(line, "Model:")[1])
			} else if strings.Contains(line, "Routing rules:") {
				currentBot.RoutingRules = strings.TrimSpace(strings.Split(line, "Routing rules:")[1])
			} else if strings.Contains(line, "Routing:") {
				currentBot.Routing = strings.TrimSpace(strings.Split(line, "Routing:")[1])
			}
		}
	}
	if currentBot != nil {
		res.Bots = append(res.Bots, *currentBot)
	}

	// 2. 解析 Models: openclaw models list
	cmdModels := exec.Command("openclaw", "models", "list")
	outModels, _ := cmdModels.CombinedOutput()

	scannerModels := bufio.NewScanner(strings.NewReader(string(outModels)))
	isTableStarted := false
	for scannerModels.Scan() {
		line := scannerModels.Text()
		if IsLogLine(line) {
			continue
		}
		trimmedLine := strings.TrimSpace(StripANSI(line))

		// 识别表头
		if strings.HasPrefix(trimmedLine, "Model") && strings.Contains(trimmedLine, "Ctx") {
			isTableStarted = true
			continue
		}

		if isTableStarted && trimmedLine != "" && !strings.Contains(trimmedLine, "OpenClaw") {
			fields := strings.Fields(trimmedLine)
			// 模型列表至少应包含 Model, Input, Ctx 3个核心字段
			if len(fields) >= 3 {
				modelID := fields[0]
				isDefault := strings.Contains(strings.ToLower(line), "default")
				tags := ""
				if len(fields) >= 5 {
					tags = fields[len(fields)-1]
				}
				res.Models = append(res.Models, OpenClawModel{
					ID:        modelID,
					Name:      modelID,
					Provider:  tags,
					IsDefault: isDefault,
				})
			}
		}
	}

	return res, nil
}

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
	// 执行 openclaw agents set-identity --agent [id] --name "[name]"
	cmd := exec.Command("openclaw", "agents", "set-identity", "--agent", id, "--name", name)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to set identity: %v. Output: %s", err, string(out))
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
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}

	var fullCfg map[string]interface{}
	if err := json.Unmarshal(data, &fullCfg); err != nil {
		return err
	}

	gateway, ok := fullCfg["gateway"].(map[string]interface{})
	if !ok {
		gateway = make(map[string]interface{})
		fullCfg["gateway"] = gateway
	}

	httpCfg, ok := gateway["http"].(map[string]interface{})
	if !ok {
		httpCfg = make(map[string]interface{})
		gateway["http"] = httpCfg
	}

	endpoints, ok := httpCfg["endpoints"].(map[string]interface{})
	if !ok {
		endpoints = make(map[string]interface{})
		httpCfg["endpoints"] = endpoints
	}

	chatCompletions, ok := endpoints["chatCompletions"].(map[string]interface{})
	if !ok {
		chatCompletions = make(map[string]interface{})
		endpoints["chatCompletions"] = chatCompletions
	}

	chatCompletions["enabled"] = true

	// 序列化回文件
	newData, err := json.MarshalIndent(fullCfg, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(configPath, newData, 0644)
}
