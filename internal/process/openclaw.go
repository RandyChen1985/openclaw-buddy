package process

import (
	"bufio"
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

//go:embed experts
var expertTemplates embed.FS

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

type Expert struct {
	ID            string   `json:"id"`
	Name          string   `json:"name"`
	NameEn        string   `json:"name_en"`
	Description   string   `json:"description"`
	DescriptionEn string   `json:"description_en"`
	Emoji         string   `json:"emoji"`
	Category      string   `json:"category"`
	CategoryZh    string   `json:"category_zh"`
	Soul          string   `json:"soul"`
	Identity      struct {
		Name string `json:"name"`
		Bio  string `json:"bio"`
	} `json:"identity"`
	IdentityMD string   `json:"identity_md"` // 新增字段：支持全量身份 Markdown
	Skills     []string `json:"skills"`
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

func GetOpenClawBotFileContent(configDir, id, fileType, workspace string) (string, error) {
	// 如果 workspace 已经传入，直接使用，避免执行耗时的 openclaw agents list
	botWorkspace := workspace
	if botWorkspace == "" {
		// 降级逻辑：如果 workspace 没传，则尝试全量获取并寻找 (旧逻辑兼容)
		res, err := GetOpenClawBotsModels(configDir)
		if err != nil {
			return "", err
		}

		for _, bot := range res.Bots {
			if bot.ID == id {
				botWorkspace = bot.Workspace
				break
			}
		}
	}

	if botWorkspace == "" {
		return "", fmt.Errorf("bot %s not found and no workspace provided", id)
	}

	if strings.HasPrefix(botWorkspace, "~") {
		home, _ := os.UserHomeDir()
		if botWorkspace == "~" {
			botWorkspace = home
		} else if strings.HasPrefix(botWorkspace, "~/") {
			botWorkspace = filepath.Join(home, botWorkspace[2:])
		}
	}

	fileName := ""
	switch strings.ToLower(fileType) {
	case "soul":
		fileName = "SOUL.md"
	case "identity":
		fileName = "IDENTITY.md"
	case "tools":
		fileName = "TOOLS.md"
	case "user":
		fileName = "USER.md"
	default:
		return "", fmt.Errorf("unsupported file type: %s", fileType)
	}

	filePath := filepath.Join(botWorkspace, fileName)
	// 尝试探测大小写
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		lowerPath := filepath.Join(botWorkspace, strings.ToLower(fileName))
		if _, err := os.Stat(lowerPath); err == nil {
			filePath = lowerPath
		}
	}

	data, err := os.ReadFile(filePath)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil // 文件不存在返回空
		}
		return "", err
	}

	return string(data), nil
}

// SaveOpenClawBotFileContent 保存机器人工作区文件的内容
func SaveOpenClawBotFileContent(configDir, id, fileType, content, workspace string) error {
	// 如果 workspace 已经传入，直接使用
	botWorkspace := workspace
	if botWorkspace == "" {
		res, err := GetOpenClawBotsModels(configDir)
		if err != nil {
			return err
		}

		for _, bot := range res.Bots {
			if bot.ID == id {
				botWorkspace = bot.Workspace
				break
			}
		}
	}

	if botWorkspace == "" {
		return fmt.Errorf("bot %s not found and no workspace provided", id)
	}

	if strings.HasPrefix(botWorkspace, "~") {
		home, _ := os.UserHomeDir()
		if botWorkspace == "~" {
			botWorkspace = home
		} else if strings.HasPrefix(botWorkspace, "~/") {
			botWorkspace = filepath.Join(home, botWorkspace[2:])
		}
	}

	fileName := ""
	switch strings.ToLower(fileType) {
	case "soul":
		fileName = "SOUL.md"
	case "identity":
		fileName = "IDENTITY.md"
	case "tools":
		fileName = "TOOLS.md"
	case "user":
		fileName = "USER.md"
	default:
		return fmt.Errorf("unsupported file type: %s", fileType)
	}

	filePath := filepath.Join(botWorkspace, fileName)
	// 如果存在小写形式，则遵循原有命名进行覆盖
	if _, err := os.Stat(filePath); os.IsNotExist(err) {
		lowerPath := filepath.Join(botWorkspace, strings.ToLower(fileName))
		if _, err := os.Stat(lowerPath); err == nil {
			filePath = lowerPath
		}
	}

	err := os.WriteFile(filePath, []byte(content), 0644)
	if err != nil {
		return err
	}

	// 异步触发同步逻辑，避免阻塞 API 响应
	go SyncKeySingle("bots_models", configDir)
	return nil
}

func SetOpenClawBotModel(configDir, botID, modelID string) error {
	return UpdateOpenClawBotConfig(configDir, botID, nil, &modelID)
}

// UpdateOpenClawBotConfig 统一更新机器人的基本配置 (名称、模型等)
// 采用一次性读写模式，防止并发修改 openclaw.json 产生冲突
func UpdateOpenClawBotConfig(configDir, botID string, name, model *string) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return fmt.Errorf("failed to read openclaw.json: %v", err)
	}

	var fullCfg map[string]interface{}
	if err := json.Unmarshal(data, &fullCfg); err != nil {
		return fmt.Errorf("failed to unmarshal config: %v", err)
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
			// 如果传入了名称，则执行赋值
			if name != nil {
				bot["name"] = *name
			}
			// 如果传入了模型，则执行赋值
			if model != nil {
				bot["model"] = *model
			}
			found = true
			break
		}
	}

	if !found {
		return fmt.Errorf("bot with ID '%s' not found", botID)
	}

	newData, err := json.MarshalIndent(fullCfg, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal config: %v", err)
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

func GetOpenClawPlugins() (any, error) {
	cmd := exec.Command("openclaw", "plugins", "list", "--json")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to list plugins: %v. Output: %s", err, string(out))
	}

	// 清理 ANSI 颜色代码
	cleanOut := StripANSI(string(out))

	// 找到第一个 '{'，跳过前面的日志行
	index := strings.Index(cleanOut, "{")
	if index == -1 {
		return nil, fmt.Errorf("failed to find JSON start in output: %s", cleanOut)
	}
	cleanOut = cleanOut[index:]

	var data struct {
		Plugins []OpenClawPlugin `json:"plugins"`
	}
	decoder := json.NewDecoder(strings.NewReader(cleanOut))
	if err := decoder.Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to parse plugins json: %v", err)
	}
	return data.Plugins, nil
}

func ReloadOpenClawPlugins() error {
	cmd := exec.Command("openclaw", "plugins", "reload")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to reload plugins: %v. Output: %s", err, string(out))
	}
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

	// [Hardening] 检查是否存在相同 ID 的模型，如有则更新
	modelID, _ := modelConfig["id"].(string)
	foundIdx := -1
	for i, m := range providerModels {
		if model, isMap := m.(map[string]interface{}); isMap {
			if id, idOk := model["id"].(string); idOk && id == modelID {
				foundIdx = i
				break
			}
		}
	}

	if foundIdx >= 0 {
		providerModels[foundIdx] = modelConfig
	} else {
		providerModels = append(providerModels, modelConfig)
	}
	provider["models"] = providerModels

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

func GetOpenClawExperts() ([]Expert, error) {
	files, err := expertTemplates.ReadDir("experts")
	if err != nil {
		return nil, fmt.Errorf("failed to read embedded experts directory: %v", err)
	}

	var experts []Expert
	for _, f := range files {
		if !f.IsDir() && strings.HasSuffix(f.Name(), ".json") {
			data, err := expertTemplates.ReadFile("experts/" + f.Name())
			if err != nil {
				continue
			}
			var expert Expert
			if err := json.Unmarshal(data, &expert); err != nil {
				continue
			}
			experts = append(experts, expert)
		}
	}
	return experts, nil
}

func CreateBotFromExpert(expertID, newBotID, modelID, customSoul, customIdentityMD string) error {
	// [Hardening] 预检 BotID 是否已占用，防止覆盖 SOUL.md 和误操作
	// 这里通过尝试列出机器人来实现，如果 GetOpenClawBotsModels 返回了该 ID，则拦截
	currentBots, err := GetOpenClawBotsModels("") 
	if err == nil {
		for _, b := range currentBots.Bots {
			if b.ID == newBotID {
				return fmt.Errorf("bot ID '%s' already exists, please use another ID", newBotID)
			}
		}
	}

	// 1. 获取专家模板内容
	experts, err := GetOpenClawExperts()
	if err != nil {
		return err
	}

	var targetExpert *Expert
	for _, e := range experts {
		if e.ID == expertID {
			targetExpert = &e
			break
		}
	}

	if targetExpert == nil {
		return fmt.Errorf("expert template %s not found", expertID)
	}

	// 3. 创建基础 Bot (AddOpenClawBot 会处理基础目录创建)
	// 使用空字符串作为 workspace，AddOpenClawBot 会自动生成 ~/.openclaw/workspace_[ID]
	if err := AddOpenClawBot(newBotID, modelID, ""); err != nil {
		return err
	}

	// 4. 获取 Bot 的工作目录 (~/.openclaw/workspace_[id])
	homeDir, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("failed to get home directory: %v", err)
	}
	// 对齐实际目录结构：直接写入 workspace 根目录
	workspaceDir := filepath.Join(homeDir, ".openclaw", "workspace_"+newBotID)

	// 确保目录存在 (由 AddOpenClawBot 或手动逻辑保障)
	if err := os.MkdirAll(workspaceDir, 0755); err != nil {
		return fmt.Errorf("failed to create workspace directory: %v", err)
	}

	fmt.Printf("🔍 [Expert] Initializing bot config in: %s\n", workspaceDir)

	// 5. 写入 SOUL.md (优先使用自定义内容)
	var soulContent string
	if customSoul != "" {
		soulContent = customSoul
	} else {
		soulContent = targetExpert.Soul
	}

	soulPath := filepath.Join(workspaceDir, "SOUL.md")
	if err := os.WriteFile(soulPath, []byte(soulContent), 0644); err != nil {
		return fmt.Errorf("failed to write SOUL.md: %v", err)
	}
	fmt.Printf("✅ [Expert] Successfully wrote SOUL.md (Custom: %v)\n", customSoul != "")

	// 6. 写入 IDENTITY.md (优先使用自定义内容)
	var identityContent string
	if customIdentityMD != "" {
		identityContent = customIdentityMD
	} else if targetExpert.IdentityMD != "" {
		identityContent = targetExpert.IdentityMD
	} else {
		// 降级渲染逻辑：将旧版 JSON 属性转换为结构化的专业 Markdown
		identityContent = fmt.Sprintf("# 🆔 Identity: %s\n\n## 👤 角色定义\n- **Name:** %s\n- **Role:** %s\n\n## 📝 个人简介\n%s\n",
			targetExpert.Name,
			targetExpert.Identity.Name,
			targetExpert.Description,
			targetExpert.Identity.Bio)

		if len(targetExpert.Skills) > 0 {
			identityContent += "\n## 🛠️ 具备技能\n"
			for _, skill := range targetExpert.Skills {
				identityContent += fmt.Sprintf("- [x] %s\n", skill)
			}
		}
	}

	identityPath := filepath.Join(workspaceDir, "IDENTITY.md")
	if err := os.WriteFile(identityPath, []byte(identityContent), 0644); err != nil {
		return fmt.Errorf("failed to write IDENTITY.md: %v", err)
	}
	fmt.Printf("✅ [Expert] Successfully wrote IDENTITY.md (Rich Content: %v)\n", targetExpert.IdentityMD != "")

	return nil
}
