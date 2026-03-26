package process

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

type OpenClawBot struct {
	ID    string `json:"id"`
	Model string `json:"model"`
	Emoji string `json:"emoji"`
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

// openClawRawConfig 用于解析原始 JSON
type openClawRawConfig struct {
	Models struct {
		Providers map[string]struct {
			Models []struct {
				ID   string `json:"id"`
				Name string `json:"name"`
			} `json:"models"`
		} `json:"providers"`
	} `json:"models"`
	Agents struct {
		List []struct {
			ID       string `json:"id"`
			Model    string `json:"model"`
			Identity struct {
				Emoji string `json:"emoji"`
			} `json:"identity"`
		} `json:"list"`
	} `json:"agents"`
}

func GetOpenClawBotsModels(configDir string) (*OpenClawBotsModelsResponse, error) {
	path := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read openclaw.json: %v", err)
	}

	var raw openClawRawConfig
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse openclaw.json: %v", err)
	}

	res := &OpenClawBotsModelsResponse{
		Bots:   []OpenClawBot{},
		Models: []OpenClawModel{},
	}

	// 解析 Bots
	for _, agent := range raw.Agents.List {
		res.Bots = append(res.Bots, OpenClawBot{
			ID:    agent.ID,
			Model: agent.Model,
			Emoji: agent.Identity.Emoji,
		})
	}

	// 解析 Models
	for providerName, provider := range raw.Models.Providers {
		for _, m := range provider.Models {
			res.Models = append(res.Models, OpenClawModel{
				ID:       m.ID,
				Name:     m.Name,
				Provider: providerName,
			})
		}
	}

	return res, nil
}
