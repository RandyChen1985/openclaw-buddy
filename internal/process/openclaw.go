package process

import (
	"bufio"
	"os/exec"
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
	ID       string `json:"id"`
	Name     string `json:"name"`
	Provider string `json:"provider"`
}

type OpenClawBotsModelsResponse struct {
	Bots   []OpenClawBot   `json:"bots"`
	Models []OpenClawModel `json:"models"`
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
		trimmedLine := strings.TrimSpace(line)
		
		// 忽略日志行
		if len(trimmedLine) > 8 && trimmedLine[8] == '+' {
			continue
		}

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
				// Identity: 🤖 云枢智维 (IDENTITY.md)
				content := strings.TrimSpace(strings.Split(line, "Identity:")[1])
				parts := strings.Fields(content)
				if len(parts) > 0 {
					currentBot.Emoji = parts[0]
					if len(parts) > 1 {
						currentBot.Name = parts[1]
					}
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
		trimmedLine := strings.TrimSpace(line)

		// 忽略日志行
		if len(trimmedLine) > 8 && trimmedLine[8] == '+' {
			continue
		}

		// 识别表头
		if strings.HasPrefix(trimmedLine, "Model") && strings.Contains(trimmedLine, "Ctx") {
			isTableStarted = true
			continue
		}

		if isTableStarted && trimmedLine != "" && !strings.Contains(trimmedLine, "OpenClaw") {
			fields := strings.Fields(line)
			if len(fields) >= 1 {
				modelID := fields[0]
				tags := ""
				if len(fields) >= 5 {
					tags = fields[len(fields)-1]
				}
				res.Models = append(res.Models, OpenClawModel{
					ID:       modelID,
					Name:     modelID, // 命令行不直接提供友好名称，用 ID 代替
					Provider: tags,    // 将 Tags 作为 Provider 展示或辅助信息
				})
			}
		}
	}

	return res, nil
}
