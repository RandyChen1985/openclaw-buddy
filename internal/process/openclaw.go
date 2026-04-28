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
	"sync"
	"time"
	"openclaw-buddy/internal/utils"
)

//go:embed experts
var expertTemplates embed.FS

type OpenClawBot struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Model        string   `json:"model"`
	Emoji        string   `json:"emoji"`
	Workspace    string   `json:"workspace"`
	AgentDir     string   `json:"agentDir"`
	RoutingRules string   `json:"routingRules"`
	Routing      string   `json:"routing"`
	Capabilities []string `json:"capabilities"`
	Input        []string `json:"input"`
}

type OpenClawModel struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Provider     string   `json:"provider"`
	IsDefault    bool     `json:"isDefault"`
	Capabilities []string `json:"capabilities"`
	Input        []string `json:"input"`
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

type OpenClawSkill struct {
	Name        string `json:"name"`
	Description string `json:"description"`
	Emoji       string `json:"emoji,omitempty"`
	Eligible    bool   `json:"eligible"`
	Disabled    bool   `json:"disabled"`
	Source      string `json:"source"`
	Bundled     bool   `json:"bundled"`
	Path        string `json:"path"` // 绝对路径
	Missing     *struct {
		Bins   []string `json:"bins"`
		Env    []string `json:"env"`
		Config []string `json:"config"`
		OS     []string `json:"os"`
	} `json:"missing,omitempty"`
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

type OpenClawPolicyValue struct {
	Requested       string `json:"requested"`
	RequestedSource string `json:"requestedSource"`
	Host            string `json:"host,omitempty"`
	HostSource      string `json:"hostSource,omitempty"`
	Effective       string `json:"effective"`
	Note            string `json:"note,omitempty"`
}

type OpenClawPolicyScope struct {
	ScopeLabel    string               `json:"scopeLabel"`
	ConfigPath    string               `json:"configPath"`
	AgentID       string               `json:"agentId,omitempty"`
	Security      OpenClawPolicyValue  `json:"security"`
	Ask           OpenClawPolicyValue  `json:"ask"`
	AskFallback   *OpenClawPolicyValue `json:"askFallback,omitempty"`
	RuntimeSource string               `json:"runtimeApprovalsSource,omitempty"`
}

type OpenClawExecPolicyResponse struct {
	ConfigPath      string `json:"configPath"`
	ApprovalsPath   string `json:"approvalsPath"`
	ApprovalsExists bool   `json:"approvalsExists"`
	EffectivePolicy struct {
		Note   string                `json:"note"`
		Scopes []OpenClawPolicyScope `json:"scopes"`
	} `json:"effectivePolicy"`
}

type OpenClawApprovalsSnapshot struct {
	Path            string `json:"path"`
	Exists          bool   `json:"exists"`
	EffectivePolicy struct {
		Scopes []OpenClawPolicyScope `json:"scopes"`
	} `json:"effectivePolicy"`
	File struct {
		Version int `json:"version"`
		Agents  map[string]struct {
			Allowlist []struct {
				Pattern    string `json:"pattern"`
				LastUsedAt int64  `json:"lastUsedAt"`
				ID         string `json:"id"`
			} `json:"allowlist"`
		} `json:"agents"`
	} `json:"file"`
}

type SecurityStatusData struct {
	Policy        *OpenClawExecPolicyResponse `json:"policy"`
	Snapshot      *OpenClawApprovalsSnapshot   `json:"snapshot"`
	VersionTooLow bool                         `json:"versionTooLow"`
}

type cliBot struct {
	ID            string   `json:"id"`
	IdentityName  string   `json:"identityName"`
	IdentityEmoji string   `json:"identityEmoji"`
	Workspace     string   `json:"workspace"`
	AgentDir      string   `json:"agentDir"`
	Model         string   `json:"model"`
	Bindings      int      `json:"bindings"`
	Routes        []string `json:"routes"`
}

type cliModel struct {
	Key       string   `json:"key"`
	Name      string   `json:"name"`
	Tags      []string `json:"tags"`
	Provider  string   `json:"provider"` // 某些版本可能有，没有就从 Key 截取
	IsDefault bool     `json:"isDefault"`
}

func GetOpenClawBotsModels(configDir string) (*OpenClawBotsModelsResponse, error) {
	res := &OpenClawBotsModelsResponse{
		Bots:   []OpenClawBot{},
		Models: []OpenClawModel{},
	}

	var wg sync.WaitGroup
	var botsOut, modelsOut []byte
	var botsErr, modelsErr error

	wg.Add(2)

	// --- 并发执行命令 ---
	go func() {
		defer wg.Done()
		cmd := exec.Command("openclaw", "agents", "list", "--json")
		botsOut, botsErr = cmd.Output()
	}()

	go func() {
		defer wg.Done()
		cmd := exec.Command("openclaw", "models", "list", "--json")
		modelsOut, modelsErr = cmd.Output()
	}()

	wg.Wait()

	// --- 1. 解析 Bots ---
	usedJSON := false
	if botsErr == nil {
		cleanOut := StripANSI(string(botsOut))
		jsonStr := ExtractJSON(cleanOut)
		var cliBots []cliBot
		if jsonErr := json.Unmarshal([]byte(jsonStr), &cliBots); jsonErr == nil {
			for _, b := range cliBots {
				name := b.IdentityName
				if name == "" {
					name = b.ID
				}
				emoji := b.IdentityEmoji
				if emoji == "" {
					emoji = "🤖"
				}
				if b.Workspace == "" {
					continue
				}
				res.Bots = append(res.Bots, OpenClawBot{
					ID:           b.ID,
					Name:         name,
					Emoji:        emoji,
					Model:        b.Model,
					Workspace:    b.Workspace,
					AgentDir:     b.AgentDir,
					RoutingRules: fmt.Sprintf("%d", b.Bindings),
					Routing:      strings.Join(b.Routes, ", "),
				})
			}
			usedJSON = true
		}
	}

	if !usedJSON {
		var currentBot *OpenClawBot
		isAgentsSection := false
		var scannerBots *bufio.Scanner
		
		// 如果 JSON 模式失败，重新获取纯文本输出（为了保持原始逻辑的健壮性）
		cmdBotsPlain := exec.Command("openclaw", "agents", "list")
		outBotsPlain, _ := cmdBotsPlain.CombinedOutput()
		scannerBots = bufio.NewScanner(strings.NewReader(string(outBotsPlain)))

		for scannerBots.Scan() {
			line := scannerBots.Text()
			if IsLogLine(line) {
				continue
			}
			rawLine := StripANSI(line)
			trimmedLine := strings.TrimSpace(rawLine)

			if strings.HasPrefix(trimmedLine, "Agents:") {
				isAgentsSection = true
				continue
			}
			if !isAgentsSection {
				continue
			}

			if strings.HasPrefix(rawLine, "- ") {
				if currentBot != nil && currentBot.Workspace != "" {
					res.Bots = append(res.Bots, *currentBot)
				}
				id := strings.TrimPrefix(trimmedLine, "- ")
				id = strings.Split(id, " ")[0]
				currentBot = &OpenClawBot{ID: id, Emoji: "🤖"}
			} else if currentBot != nil {
				if strings.Contains(line, "Identity:") {
					lineContent := strings.Split(line, "Identity:")[1]
					lineContent = strings.TrimSpace(lineContent)
					lastIdx := strings.LastIndex(lineContent, "(")
					namePart := lineContent
					if lastIdx > 0 {
						namePart = strings.TrimSpace(lineContent[:lastIdx])
					}
					parts := strings.SplitN(namePart, " ", 2)
					if len(parts) == 2 && len([]rune(parts[0])) == 1 && []rune(parts[0])[0] > 127 {
						currentBot.Emoji = parts[0]
						currentBot.Name = strings.TrimSpace(parts[1])
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
		if currentBot != nil && currentBot.Workspace != "" {
			res.Bots = append(res.Bots, *currentBot)
		}
	}

	// --- 2. 解析 Models ---
	usedModelsJSON := false
	if modelsErr == nil {
		cleanOut := StripANSI(string(modelsOut))
		jsonStr := ExtractJSON(cleanOut)
		var cliModels []cliModel
		
		// 增强解析：兼容对象包装和直接数组
		var wrapper struct {
			Models []cliModel `json:"models"`
		}
		if jsonErr := json.Unmarshal([]byte(jsonStr), &wrapper); jsonErr == nil && len(wrapper.Models) > 0 {
			cliModels = wrapper.Models
		} else {
			_ = json.Unmarshal([]byte(jsonStr), &cliModels)
		}

		if len(cliModels) > 0 {
			for _, m := range cliModels {
				isDefault := m.IsDefault
				if !isDefault {
					for _, t := range m.Tags {
						if t == "default" {
							isDefault = true
							break
						}
					}
				}
				id := m.Key
				if id == "" {
					id = m.Name
				}
				provider := m.Provider
				if provider == "" && strings.Contains(id, "/") {
					provider = strings.Split(id, "/")[0]
				}

				res.Models = append(res.Models, OpenClawModel{
					ID:        id,
					Name:      id,
					Provider:  provider,
					IsDefault: isDefault,
				})
			}
			usedModelsJSON = true
		}
	}

	if !usedModelsJSON {
		cmdModelsPlain := exec.Command("openclaw", "models", "list")
		outModelsPlain, _ := cmdModelsPlain.CombinedOutput()
		scannerModels := bufio.NewScanner(strings.NewReader(string(outModelsPlain)))
		isTableStarted := false
		for scannerModels.Scan() {
			line := scannerModels.Text()
			if IsLogLine(line) {
				continue
			}
			trimmedLine := strings.TrimSpace(StripANSI(line))
			if strings.HasPrefix(trimmedLine, "Model") && strings.Contains(trimmedLine, "Ctx") {
				isTableStarted = true
				continue
			}
			if isTableStarted && trimmedLine != "" && !strings.Contains(trimmedLine, "OpenClaw") {
				fields := strings.Fields(trimmedLine)
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
	}

	// --- 3. 合并物理配置中的能力标识 (以用户填写为准) ---
	providers, _ := GetOpenClawModelsConfig(configDir)
	modelCaps := make(map[string][]string)
	for _, p := range providers {
		if pMap, ok := p.(map[string]interface{}); ok {
			if ms, ok := pMap["models"].([]interface{}); ok {
				for _, m := range ms {
					if mMap, ok := m.(map[string]interface{}); ok {
						if id, ok := mMap["id"].(string); ok {
							// 优先读取 input 数组 (对应前端「支持的能力」)
							if caps, ok := mMap["input"].([]interface{}); ok {
								strCaps := []string{}
								for _, c := range caps {
									if s, ok := c.(string); ok {
										strCaps = append(strCaps, s)
									}
								}
								modelCaps[id] = strCaps
							}
						}
					}
				}
			}
		}
	}

	// 辅助函数：判断是否包含
	contains := func(slice []string, val string) bool {
		for _, item := range slice {
			if item == val {
				return true
			}
		}
		return false
	}

	// 启发式函数：基于名称判断 Vision 能力
	isVisionModel := func(id string) bool {
		id = strings.ToLower(id)
		return strings.Contains(id, "vision") ||
			strings.Contains(id, "gpt-4o") ||
			strings.Contains(id, "gpt-4-turbo") ||
			strings.Contains(id, "claude-3") ||
			strings.Contains(id, "gemini") ||
			strings.Contains(id, "vl-") ||
			strings.HasSuffix(id, "-vl") ||
			strings.Contains(id, "llava") ||
			strings.Contains(id, "qwen-vl")
	}

	// 注入模型能力
	for i := range res.Models {
		m := &res.Models[i]
		
		// 优先从物理配置匹配
		idParts := strings.Split(m.ID, "/")
		baseID := idParts[len(idParts)-1]
		
		if caps, ok := modelCaps[m.ID]; ok {
			m.Capabilities = caps
		} else if caps, ok := modelCaps[baseID]; ok {
			m.Capabilities = caps
		}
		
		// 兼容旧字段
		m.Input = m.Capabilities
		
		// 如果物理配置没填，应用启发式规则
		if !contains(m.Capabilities, "image") && isVisionModel(m.ID) {
			m.Capabilities = append(m.Capabilities, "image")
			m.Input = m.Capabilities
		}
	}

	// 注入机器人能力 (基于其当前绑定的模型)
	for i := range res.Bots {
		b := &res.Bots[i]
		for _, m := range res.Models {
			if m.ID == b.Model {
				b.Capabilities = m.Capabilities
				b.Input = m.Input
				break
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

func GetOpenClawBotFileContent(configDir, id, fileType, filename, workspace string) (string, error) {
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

	botWorkspace = utils.ExpandPath(botWorkspace)

	filePath := ""
	switch strings.ToLower(fileType) {
	case "soul":
		filePath = filepath.Join(botWorkspace, "SOUL.md")
	case "identity":
		filePath = filepath.Join(botWorkspace, "IDENTITY.md")
	case "tools":
		filePath = filepath.Join(botWorkspace, "TOOLS.md")
	case "user":
		filePath = filepath.Join(botWorkspace, "USER.md")
	case "memory":
		filePath = filepath.Join(botWorkspace, "MEMORY.md")
	case "heartbeat":
		filePath = filepath.Join(botWorkspace, "HEARTBEAT.md")
	case "agents":
		filePath = filepath.Join(botWorkspace, "AGENTS.md")
	case "memory_file":
		if filename == "" {
			return "", fmt.Errorf("filename is required for memory_file type")
		}
		filePath = filepath.Join(botWorkspace, "memory", filename)
	default:
		return "", fmt.Errorf("unsupported file type: %s", fileType)
	}

	// 尝试探测大小写（针对根目录固定命名的文件）
	if fileType != "memory_file" {
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			dir, name := filepath.Split(filePath)
			lowerPath := filepath.Join(dir, strings.ToLower(name))
			if _, err := os.Stat(lowerPath); err == nil {
				filePath = lowerPath
			}
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
func SaveOpenClawBotFileContent(configDir, id, fileType, filename, content, workspace string) error {
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

	botWorkspace = utils.ExpandPath(botWorkspace)

	filePath := ""
	switch strings.ToLower(fileType) {
	case "soul":
		filePath = filepath.Join(botWorkspace, "SOUL.md")
	case "identity":
		filePath = filepath.Join(botWorkspace, "IDENTITY.md")
	case "tools":
		filePath = filepath.Join(botWorkspace, "TOOLS.md")
	case "user":
		filePath = filepath.Join(botWorkspace, "USER.md")
	case "memory":
		filePath = filepath.Join(botWorkspace, "MEMORY.md")
	case "heartbeat":
		filePath = filepath.Join(botWorkspace, "HEARTBEAT.md")
	case "agents":
		filePath = filepath.Join(botWorkspace, "AGENTS.md")
	case "memory_file":
		if filename == "" {
			return fmt.Errorf("filename is required for memory_file type")
		}
		memoryDir := filepath.Join(botWorkspace, "memory")
		if err := os.MkdirAll(memoryDir, 0755); err != nil {
			return fmt.Errorf("failed to create memory directory: %w", err)
		}
		filePath = filepath.Join(memoryDir, filename)
	default:
		return fmt.Errorf("unsupported file type: %s", fileType)
	}

	// 如果存在小写形式（针对根目录固定命名的文件），则遵循原有命名进行覆盖
	if fileType != "memory_file" {
		if _, err := os.Stat(filePath); os.IsNotExist(err) {
			dir, name := filepath.Split(filePath)
			lowerPath := filepath.Join(dir, strings.ToLower(name))
			if _, err := os.Stat(lowerPath); err == nil {
				filePath = lowerPath
			}
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

// ListOpenClawBotMemoryFiles 获取机器人记忆目录下的文件列表
func ListOpenClawBotMemoryFiles(configDir, id, workspace string) ([]string, error) {
	botWorkspace := workspace
	if botWorkspace == "" {
		res, err := GetOpenClawBotsModels(configDir)
		if err != nil {
			return nil, err
		}
		for _, bot := range res.Bots {
			if bot.ID == id {
				botWorkspace = bot.Workspace
				break
			}
		}
	}

	if botWorkspace == "" {
		return nil, fmt.Errorf("bot %s not found and no workspace provided", id)
	}

	memoryDir := filepath.Join(utils.ExpandPath(botWorkspace), "memory")
	if _, err := os.Stat(memoryDir); os.IsNotExist(err) {
		return []string{}, nil
	}

	entries, err := os.ReadDir(memoryDir)
	if err != nil {
		return nil, err
	}

	var files []string
	for _, entry := range entries {
		if !entry.IsDir() && (strings.HasSuffix(entry.Name(), ".md") || strings.HasSuffix(entry.Name(), ".txt")) {
			files = append(files, entry.Name())
		}
	}

	// 倒序排列，通常最新的日期排在前面
	for i, j := 0, len(files)-1; i < j; i, j = i+1, j-1 {
		files[i], files[j] = files[j], files[i]
	}

	return files, nil
}

// DeleteOpenClawBotMemoryFile 删除机器人记忆目录下的指定文件
func DeleteOpenClawBotMemoryFile(configDir, id, filename, workspace string) error {
	if filename == "" {
		return fmt.Errorf("filename is required")
	}

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

	filePath := filepath.Join(utils.ExpandPath(botWorkspace), "memory", filename)
	return os.Remove(filePath)
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
				// 修改模型
				bot["model"] = *model
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
		if err := os.WriteFile(configPath, newData, 0644); err != nil {
			return fmt.Errorf("failed to write openclaw.json: %v", err)
		}
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

type OpenClawCronSchedule struct {
	Expr string `json:"expr"`
	Kind string `json:"kind"`
	TZ   string `json:"tz"`
}

type OpenClawCronPayload struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
	Model   string `json:"model"`
}

type OpenClawCronDelivery struct {
	Mode    string `json:"mode"`
	To      string `json:"to"`
	Channel string `json:"channel"`
}

type OpenClawCronState struct {
	NextRunAtMs        int64  `json:"nextRunAtMs"`
	LastRunAtMs        int64  `json:"lastRunAtMs"`
	LastRunStatus      string `json:"lastRunStatus"`
	LastStatus         string `json:"lastStatus"`
	LastDurationMs     int64  `json:"lastDurationMs"`
	LastDelivered      bool   `json:"lastDelivered"`
	LastDeliveryStatus string `json:"lastDeliveryStatus"`
	ConsecutiveErrors  int    `json:"consecutiveErrors"`
}

type OpenClawCronJob struct {
	ID            string              `json:"id"`
	AgentID       string              `json:"agentId"`
	SessionKey    string              `json:"sessionKey"`
	Name          string              `json:"name"`
	Enabled       bool                `json:"enabled"`
	CreatedAtMs   int64               `json:"createdAtMs"`
	UpdatedAtMs   int64               `json:"updatedAtMs"`
	Schedule      OpenClawCronSchedule `json:"schedule"`
	SessionTarget string              `json:"sessionTarget"`
	WakeMode      string              `json:"wakeMode"`
	Payload       OpenClawCronPayload `json:"payload"`
	Delivery      OpenClawCronDelivery `json:"delivery"`
	State         OpenClawCronState   `json:"state"`
}

type OpenClawCronJobsResponse struct {
	Jobs      []OpenClawCronJob `json:"jobs"`
	Total     int               `json:"total"`
	Offset    int               `json:"offset"`
	Limit     int               `json:"limit"`
	HasMore   bool              `json:"hasMore"`
	NextOffset *int             `json:"nextOffset"`
}

func GetOpenClawCronJobs() (any, error) {
	cmd := exec.Command("openclaw", "cron", "list", "--all", "--json")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to list cron jobs: %v. Output: %s", err, string(out))
	}

	cleanOut := StripANSI(string(out))
	if jsonStr, ok := ExtractFirstJSONValue(cleanOut); ok {
		cleanOut = jsonStr
	} else {
		cleanOut = ExtractJSON(cleanOut) // legacy fallback
	}

	var data OpenClawCronJobsResponse
	decoder := json.NewDecoder(strings.NewReader(cleanOut))
	if err := decoder.Decode(&data); err != nil {
		preview := cleanOut
		if len(preview) > 400 {
			preview = preview[:400] + "...(truncated)"
		}
		return nil, fmt.Errorf("failed to parse cron jobs json: %v. Output: %s", err, preview)
	}

	return data, nil
}

func EnableOpenClawCronJob(id string) error {
	cmd := exec.Command("openclaw", "cron", "enable", id)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to enable cron job %s: %v. Output: %s", id, err, string(out))
	}
	return nil
}

func DisableOpenClawCronJob(id string) error {
	cmd := exec.Command("openclaw", "cron", "disable", id)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to disable cron job %s: %v. Output: %s", id, err, string(out))
	}
	return nil
}

func RemoveOpenClawCronJob(id string) error {
	cmd := exec.Command("openclaw", "cron", "rm", id)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to remove cron job %s: %v. Output: %s", id, err, string(out))
	}
	return nil
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

func GetOpenClawSkills() (any, error) {
	cmd := exec.Command("openclaw", "skills", "list", "--json")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to list skills: %v. Output: %s", err, string(out))
	}

	// 清理 ANSI 颜色代码，防止 JSON 解析失败
	cleanOut := StripANSI(string(out))
	cleanOut = ExtractJSON(cleanOut)

	var data struct {
		Skills []OpenClawSkill `json:"skills"`
	}
	decoder := json.NewDecoder(strings.NewReader(cleanOut))
	if err := decoder.Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to parse skills json: %v", err)
	}

	skills := data.Skills

	// 补全绝对路径
	searchDirs := []string{
		"~/.openclaw/skills",
		"~/.openclaw/workspace/skills",
		"~/.agents/skills",
		"~/.openclaw/lib/skills",
	}

	// Add bundled skills path if detected
	if bundledPath := GetBundledSkillsPath(); bundledPath != "" {
		searchDirs = append(searchDirs, bundledPath)
	}

	for i := range skills {
		name := skills[i].Name
		for _, dir := range searchDirs {
			absDir := utils.ExpandPath(dir)
			skillPath := filepath.Join(absDir, name)
			if info, err := os.Stat(skillPath); err == nil && info.IsDir() {
				skills[i].Path = skillPath
				break
			}
		}
	}

	return map[string]any{"skills": skills}, nil
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
	// 目前版本的 openclaw CLI (2026.3.24) 不支持 skills reload 子命令。
	// 重载操作由上层 Handler 调用 SyncKeySingle("skills") 通过执行 list 命令来完成实时的列表扫描。
	return nil
}

func GetOpenClawSessions() ([]OpenClawSession, error) {
	cmd := exec.Command("openclaw", "sessions", "--all-agents", "--json")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to list sessions: %v. Output: %s", err, string(out))
	}

	// 清理 ANSI 颜色代码，防止 JSON 解析失败
	cleanOut := StripANSI(string(out))
	cleanOut = ExtractJSON(cleanOut)

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

func DeleteOpenClawProvider(configDir, providerName string) error {
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return err
	}

	var fullCfg map[string]interface{}
	if err := json.Unmarshal(data, &fullCfg); err != nil {
		return err
	}

	// 1. 从 models.providers 中移除
	models, ok := fullCfg["models"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("models section not found")
	}

	providers, ok := models["providers"].(map[string]interface{})
	if !ok {
		return fmt.Errorf("providers section not found")
	}

	if _, ok := providers[providerName]; !ok {
		return fmt.Errorf("provider %s not found", providerName)
	}

	delete(providers, providerName)

	// 2. 从 agents.defaults.models 中移除该渠道下的所有模型注册
	agents, ok := fullCfg["agents"].(map[string]interface{})
	if ok {
		defaults, ok := agents["defaults"].(map[string]interface{})
		if ok {
			registeredModels, ok := defaults["models"].(map[string]interface{})
			if ok {
				prefix := providerName + "/"
				for key := range registeredModels {
					if strings.HasPrefix(key, prefix) {
						delete(registeredModels, key)
					}
				}
				defaults["models"] = registeredModels
			}
			agents["defaults"] = defaults
		}
		fullCfg["agents"] = agents
	}

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

func ExecPolicyShow() (*OpenClawExecPolicyResponse, error) {
	cmd := exec.Command("openclaw", "exec-policy", "show", "--json")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to show exec policy: %v. Output: %s", err, string(out))
	}

	cleanOut := StripANSI(string(out))
	cleanOut = ExtractJSON(cleanOut)

	var res OpenClawExecPolicyResponse
	decoder := json.NewDecoder(strings.NewReader(cleanOut))
	if err := decoder.Decode(&res); err != nil {
		return nil, fmt.Errorf("failed to unmarshal exec policy: %v", err)
	}

	return &res, nil
}

func GetApprovalsSnapshot() (*OpenClawApprovalsSnapshot, error) {
	cmd := exec.Command("openclaw", "approvals", "get", "--json")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get approvals snapshot: %v. Output: %s", err, string(out))
	}

	cleanOut := StripANSI(string(out))
	cleanOut = ExtractJSON(cleanOut)

	var res OpenClawApprovalsSnapshot
	decoder := json.NewDecoder(strings.NewReader(cleanOut))
	if err := decoder.Decode(&res); err != nil {
		return nil, fmt.Errorf("failed to unmarshal approvals snapshot: %v", err)
	}

	return &res, nil
}

func ApplyExecPreset(preset string) error {
	cmd := exec.Command("openclaw", "exec-policy", "preset", preset)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to apply preset %s: %v. Output: %s", preset, err, string(out))
	}
	return nil
}

func SetExecPolicy(ask, security string) error {
	args := []string{"exec-policy", "set"}
	if ask != "" {
		args = append(args, "--ask", ask)
	}
	if security != "" {
		args = append(args, "--security", security)
	}
	cmd := exec.Command("openclaw", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to set exec policy: %v. Output: %s", err, string(out))
	}
	return nil
}

func AddAllowlistPattern(agentID, pattern string) error {
	args := []string{"approvals", "allowlist", "add"}
	if agentID != "" && agentID != "*" {
		args = append(args, "--agent", agentID)
	} else if agentID == "*" {
		args = append(args, "--agent", "*")
	}
	args = append(args, pattern)
	cmd := exec.Command("openclaw", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to add allowlist pattern: %v. Output: %s", err, string(out))
	}
	return nil
}

func RemoveAllowlistPattern(agentID, pattern string) error {
	args := []string{"approvals", "allowlist", "remove"}
	if agentID != "" && agentID != "*" {
		args = append(args, "--agent", agentID)
	} else if agentID == "*" {
		args = append(args, "--agent", "*")
	}
	args = append(args, pattern)
	cmd := exec.Command("openclaw", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to remove allowlist pattern: %v. Output: %s", err, string(out))
	}
	return nil
}

func SetApprovals(content string) error {
	// Create a temporary file to hold the JSON content
	tmpFile, err := os.CreateTemp("", "exec-approvals-*.json")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(content); err != nil {
		return fmt.Errorf("failed to write to temp file: %v", err)
	}
	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("failed to close temp file: %v", err)
	}

	cmd := exec.Command("openclaw", "approvals", "set", tmpFile.Name())
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to set approvals: %v. Output: %s", err, string(out))
	}
	return nil
}

func GetSecurityStatusData() (*SecurityStatusData, error) {
	policy, err := ExecPolicyShow()
	if err != nil {
		// 容错设计：如果 openclaw 版本过低，不支持 exec-policy 命令，则返回特定标志
		if strings.Contains(err.Error(), "unknown command") {
			return &SecurityStatusData{
				Policy:        nil,
				Snapshot:      nil,
				VersionTooLow: true,
			}, nil
		}
		return nil, err
	}

	snapshot, err := GetApprovalsSnapshot()
	if err != nil {
		// 如果获取快照失败（例如 approvals 文件不存在），依然返回 policy
		return &SecurityStatusData{
			Policy:   policy,
			Snapshot: nil,
		}, nil
	}

	return &SecurityStatusData{
		Policy:   policy,
		Snapshot: snapshot,
	}, nil
}
