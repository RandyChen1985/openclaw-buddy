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

type OpenClawSession struct {
	Key           string `json:"key"`
	AgentID       string `json:"agentId"`
	Model         string `json:"model"`
	Kind          string `json:"kind"`
	AgeMs         int64  `json:"ageMs"`
	InputTokens   int    `json:"inputTokens"`
	OutputTokens  int    `json:"outputTokens"`
	TotalTokens   int    `json:"totalTokens"`
	ContextTokens int    `json:"contextTokens"`
	SessionID     string `json:"sessionId"`
	UpdatedAt     int64  `json:"updatedAt"`
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

func SetOpenClawBotModel(configDir, botID, modelID string) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}

	var fullCfg map[string]interface{}
	if err := json.Unmarshal(data, &fullCfg); err != nil {
		return err
	}

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
			bot["model"] = modelID
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("bot with ID '%s' not found in agents.list", botID)
	}

	newData, err := json.MarshalIndent(fullCfg, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(configPath, newData, 0644)
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
    // ... (unchanged content if any, but I'll replace the end)
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

func GetOpenClawSkills() (any, error) {
	cmd := exec.Command("openclaw", "skills", "list", "--json")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to list skills: %v. Output: %s", err, string(out))
	}

	// 清理 ANSI 颜色代码，防止 JSON 解析失败
	cleanOut := StripANSI(string(out))

	// 找到第一个 '{'，跳过前面的日志行 (例如: 16:15:18+08:00 [plugins] ...)
	index := strings.Index(cleanOut, "{")
	if index == -1 {
		return nil, fmt.Errorf("failed to find JSON start in output: %s", cleanOut)
	}
	cleanOut = cleanOut[index:]

	var skills interface{}
	decoder := json.NewDecoder(strings.NewReader(cleanOut))
	if err := decoder.Decode(&skills); err != nil {
		return nil, fmt.Errorf("failed to parse skills json: %v", err)
	}
	return skills, nil
}

func UninstallOpenClawSkill(name string) error {
	cmd := exec.Command("openclaw", "skills", "uninstall", name)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to uninstall skill %s: %v. Output: %s", name, err, string(out))
	}
	return nil
}

func ReloadOpenClawSkills() error {
	cmd := exec.Command("openclaw", "skills", "reload")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to reload skills: %v. Output: %s", err, string(out))
	}
	return nil
}

func GetOpenClawSessions() ([]OpenClawSession, error) {
	cmd := exec.Command("openclaw", "sessions", "--all-agent", "--json")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to list sessions: %v. Output: %s", err, string(out))
	}

	// 清理 ANSI 颜色代码，防止 JSON 解析失败
	cleanOut := StripANSI(string(out))

	// 找到第一个 '{'，跳过前面的日志行
	index := strings.Index(cleanOut, "{")
	if index == -1 {
		return nil, fmt.Errorf("failed to find JSON start in output: %s", cleanOut)
	}
	cleanOut = cleanOut[index:]

	var data struct {
		Sessions []OpenClawSession `json:"sessions"`
	}
	decoder := json.NewDecoder(strings.NewReader(cleanOut))
	if err := decoder.Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to parse sessions json: %v", err)
	}
	return data.Sessions, nil
}

func GetOpenClawModelsConfig(configDir string) (map[string]interface{}, error) {
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, err
	}

	var fullCfg map[string]interface{}
	if err := json.Unmarshal(data, &fullCfg); err != nil {
		return nil, err
	}

	models, ok := fullCfg["models"].(map[string]interface{})
	if !ok {
		return make(map[string]interface{}), nil
	}

	providers, ok := models["providers"].(map[string]interface{})
	if !ok {
		return make(map[string]interface{}), nil
	}

	return providers, nil
}

func AddOpenClawProvider(configDir, name string, config map[string]interface{}) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}

	var fullCfg map[string]interface{}
	if err := json.Unmarshal(data, &fullCfg); err != nil {
		return err
	}

	models, ok := fullCfg["models"].(map[string]interface{})
	if !ok {
		models = make(map[string]interface{})
		fullCfg["models"] = models
	}

	providers, ok := models["providers"].(map[string]interface{})
	if !ok {
		providers = make(map[string]interface{})
		models["providers"] = providers
	}

	// 如果 Provider 已存在，保留原有的 models 列表
	if existing, ok := providers[name].(map[string]interface{}); ok {
		if existingModels, ok := existing["models"]; ok {
			config["models"] = existingModels
		}
	} else if _, ok := config["models"]; !ok {
		config["models"] = []interface{}{}
	}

	providers[name] = config

	// --- 3. 处理 agents.defaults.models 注册部分 (同步该 Provider 下所有已定义模型) ---
	agents, ok := fullCfg["agents"].(map[string]interface{})
	if !ok {
		agents = make(map[string]interface{})
		fullCfg["agents"] = agents
	}

	defaults, ok := agents["defaults"].(map[string]interface{})
	if !ok {
		defaults = make(map[string]interface{})
		agents["defaults"] = defaults
	}

	registeredModels, ok := defaults["models"].(map[string]interface{})
	if !ok {
		registeredModels = make(map[string]interface{})
		defaults["models"] = registeredModels
	}

	if providerModels, ok := config["models"].([]interface{}); ok {
		for _, m := range providerModels {
			if model, isMap := m.(map[string]interface{}); isMap {
				if modelID, idOk := model["id"].(string); idOk && modelID != "" {
					registrationKey := fmt.Sprintf("%s/%s", name, modelID)
					if _, exists := registeredModels[registrationKey]; !exists {
						registeredModels[registrationKey] = make(map[string]interface{})
					}
				}
			}
		}
	}

	newData, err := json.MarshalIndent(fullCfg, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(configPath, newData, 0644)
}

func AddOpenClawModelToProvider(configDir, providerName string, modelConfig map[string]interface{}) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}

	var fullCfg map[string]interface{}
	if err := json.Unmarshal(data, &fullCfg); err != nil {
		return err
	}

	// --- 1. 处理 models.providers 部分 ---
	models, ok := fullCfg["models"].(map[string]interface{})
	if !ok {
		models = make(map[string]interface{})
		fullCfg["models"] = models
	}

	providers, ok := models["providers"].(map[string]interface{})
	if !ok {
		providers = make(map[string]interface{})
		models["providers"] = providers
	}

	provider, ok := providers[providerName].(map[string]interface{})
	if !ok {
		return fmt.Errorf("provider %s not found", providerName)
	}

	providerModels, ok := provider["models"].([]interface{})
	if !ok {
		providerModels = []interface{}{}
	}

	// 补齐模型配置默认值
	if _, ok := modelConfig["cost"]; !ok {
		modelConfig["cost"] = map[string]interface{}{
			"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
		}
	}
	if _, ok := modelConfig["contextWindow"]; !ok {
		modelConfig["contextWindow"] = 128000
	}
	if _, ok := modelConfig["maxTokens"]; !ok {
		modelConfig["maxTokens"] = 4096
	}
	if _, ok := modelConfig["compat"]; !ok {
		modelConfig["compat"] = map[string]interface{}{
			"supportsStore": false, "supportsDeveloperRole": false,
		}
	}

	provider["models"] = append(providerModels, modelConfig)

	// --- 2. 处理 agents.defaults.models 注册部分 ---
	agents, ok := fullCfg["agents"].(map[string]interface{})
	if !ok {
		agents = make(map[string]interface{})
		fullCfg["agents"] = agents
	}

	defaults, ok := agents["defaults"].(map[string]interface{})
	if !ok {
		defaults = make(map[string]interface{})
		agents["defaults"] = defaults
	}

	registeredModels, ok := defaults["models"].(map[string]interface{})
	if !ok {
		registeredModels = make(map[string]interface{})
		defaults["models"] = registeredModels
	}

	// 注册格式: "provider/id": {}
	modelID, _ := modelConfig["id"].(string)
	if modelID != "" {
		registrationKey := fmt.Sprintf("%s/%s", providerName, modelID)
		if _, exists := registeredModels[registrationKey]; !exists {
			registeredModels[registrationKey] = make(map[string]interface{})
		}
	}

	// 序列化回文件
	newData, err := json.MarshalIndent(fullCfg, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(configPath, newData, 0644)
}

func DeleteOpenClawModelFromProvider(configDir, providerName, modelID string) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}

	var fullCfg map[string]interface{}
	if err := json.Unmarshal(data, &fullCfg); err != nil {
		return err
	}

	// --- 1. 处理 models.providers 部分 ---
	models, ok := fullCfg["models"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("models section not found")
	}

	providers, ok := models["providers"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("providers section not found")
	}

	provider, ok := providers[providerName].(map[string]interface{})
	if !ok {
		return fmt.Errorf("provider %s not found", providerName)
	}

	providerModels, ok := provider["models"].([]interface{})
	if !ok {
		return fmt.Errorf("models list not found for provider %s", providerName)
	}

	newProviderModels := []interface{}{}
	found := false
	for _, m := range providerModels {
		if model, isMap := m.(map[string]interface{}); isMap {
			if id, idOk := model["id"].(string); idOk && id == modelID {
				found = true
				continue
			}
		}
		newProviderModels = append(newProviderModels, m)
	}

	if !found {
		return fmt.Errorf("model %s not found in provider %s", modelID, providerName)
	}

	provider["models"] = newProviderModels
	providers[providerName] = provider // 更新 provider

	// --- 2. 处理 agents.defaults.models 注册部分 ---
	// 同样需要从 defaults.models 中移除
	agents, ok := fullCfg["agents"].(map[string]interface{})
	if ok { // 只有 agents 存在才处理
		defaults, ok := agents["defaults"].(map[string]interface{})
		if ok { // 只有 defaults 存在才处理
			registeredModels, ok := defaults["models"].(map[string]interface{})
			if ok { // 只有 registeredModels 存在才处理
				registrationKey := fmt.Sprintf("%s/%s", providerName, modelID)
				delete(registeredModels, registrationKey)
				defaults["models"] = registeredModels
			}
			agents["defaults"] = defaults
		}
		fullCfg["agents"] = agents
	}

	// 序列化回文件
	newData, err := json.MarshalIndent(fullCfg, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(configPath, newData, 0644)
}
