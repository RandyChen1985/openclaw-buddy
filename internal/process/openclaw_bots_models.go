package process

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
	"sync"
)

type OpenClawBotsModelsResponse struct {
	Bots     []OpenClawBot   `json:"bots"`
	Models   []OpenClawModel `json:"models"`
	UpdateAt string          `json:"updated_at"`
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
