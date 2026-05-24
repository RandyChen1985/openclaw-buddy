package process

import (
	"encoding/json"
	"net/http"
	"time"
)

type MarketSkillRequirements struct {
	Bins []string `json:"bins"`
	Env  []string `json:"env"`
}

type MarketSkill struct {
	Name         string                  `json:"name"`
	Description  string                  `json:"description"`
	Emoji        string                  `json:"emoji,omitempty"`
	Version      string                  `json:"version"`
	TarballURL   string                  `json:"tarball_url"`
	Author       string                  `json:"author"`
	Rating       float64                 `json:"rating"`
	Requirements MarketSkillRequirements `json:"requirements"`
}

// GetPresetMarketSkills returns a beautifully curated list of skills for offline/fallback mode
func GetPresetMarketSkills() []MarketSkill {
	return []MarketSkill{
		{
			Name:        "EchartsPlotter",
			Description: "高颜值 Echarts 数据自动制图技能，支持生成折线图、柱状图、饼图等可视化图表",
			Emoji:       "📊",
			Version:     "1.0.2",
			TarballURL:  "https://cdn.clawhub.ai/packages/echarts_plotter.tar.gz",
			Author:      "ClawHub Team",
			Rating:      4.9,
			Requirements: MarketSkillRequirements{
				Bins: []string{"python3"},
				Env:  []string{"PYTHONPATH"},
			},
		},
		{
			Name:        "ExcelAnalyzer",
			Description: "智能 Excel 表格深度数据分析与可视化洞察技能，轻松处理海量行列报表",
			Emoji:       "📈",
			Version:     "1.1.0",
			TarballURL:  "https://cdn.clawhub.ai/packages/excel_analyzer.tar.gz",
			Author:      "ClawHub Team",
			Rating:      4.8,
			Requirements: MarketSkillRequirements{
				Bins: []string{"python3"},
				Env:  []string{"PYTHONPATH"},
			},
		},
		{
			Name:        "TextExtractor",
			Description: "多格式文档通用文本提取与智能摘要生成技能，支持 PDF、Word、TXT",
			Emoji:       "📄",
			Version:     "2.0.1",
			TarballURL:  "https://cdn.clawhub.ai/packages/text_extractor.tar.gz",
			Author:      "ClawHub Team",
			Rating:      4.7,
			Requirements: MarketSkillRequirements{
				Bins: []string{"python3"},
				Env:  []string{},
			},
		},
		{
			Name:        "WebScraper",
			Description: "通用高强度网页抓取与结构化数据提取技能，支持智能反爬与节点解析",
			Emoji:       "🕷️",
			Version:     "1.3.0",
			TarballURL:  "https://cdn.clawhub.ai/packages/web_scraper.tar.gz",
			Author:      "ClawHub Team",
			Rating:      4.6,
			Requirements: MarketSkillRequirements{
				Bins: []string{"python3"},
				Env:  []string{"PYTHONPATH"},
			},
		},
	}
}

// FetchSkillMarket connects to ClawHub API to fetch skills, falling back to presets if offline
func FetchSkillMarket(configDir string) (string, []MarketSkill, error) {
	client := &http.Client{
		Timeout: 8 * time.Second,
	}

	req, err := http.NewRequest("GET", "https://clawhub.ai/api/v1/skills", nil)
	if err != nil {
		// Request creation failed, return offline and presets
		return "offline", GetPresetMarketSkills(), nil
	}

	resp, err := client.Do(req)
	if err != nil {
		// Network timeout or unreachable, return offline and presets
		return "offline", GetPresetMarketSkills(), nil
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// Server returned non-200, return offline and presets
		return "offline", GetPresetMarketSkills(), nil
	}

	var apiResp struct {
		Status string        `json:"status"`
		Data   []MarketSkill `json:"data"`
		Items  []struct {
			Slug          string `json:"slug"`
			DisplayName   string `json:"displayName"`
			Summary       string `json:"summary"`
			LatestVersion struct {
				Version string `json:"version"`
			} `json:"latestVersion"`
		} `json:"items"`
	}

	decoder := json.NewDecoder(resp.Body)
	if err := decoder.Decode(&apiResp); err != nil {
		// JSON decoding failed, return offline and presets
		return "offline", GetPresetMarketSkills(), nil
	}

	// If items field is present (ClawHub API V1), transform to MarketSkill list
	if len(apiResp.Items) > 0 {
		var skills []MarketSkill
		for _, item := range apiResp.Items {
			name := item.Slug
			if name == "" {
				name = item.DisplayName
			}

			reqs := MarketSkillRequirements{
				Bins: []string{"python3"},
				Env:  []string{},
			}

			// Map default emojis for recognized categories
			emoji := "🧩"
			if item.Slug == "fast-ppt" {
				emoji = "📊"
			} else if item.Slug == "golang-testing" {
				emoji = "🧪"
			} else if item.Slug == "virustotal3" {
				emoji = "🛡️"
			} else if item.Slug == "skill-docker" {
				emoji = "🐳"
			} else if item.Slug == "yq-image-creator" {
				emoji = "🎨"
			} else if item.Slug == "yq-gif-sticker-generator" {
				emoji = " Q"
			}

			version := item.LatestVersion.Version
			if version == "" {
				version = "1.0.0"
			}

			skills = append(skills, MarketSkill{
				Name:         name,
				Description:  item.Summary,
				Emoji:        emoji,
				Version:      version,
				TarballURL:   "https://clawhub.ai/api/v1/packages/" + item.Slug + "/download",
				Author:       "ClawHub Team",
				Rating:       4.8,
				Requirements: reqs,
			})
		}
		return "online", skills, nil
	}

	if len(apiResp.Data) == 0 {
		return "online", GetPresetMarketSkills(), nil
	}

	return "online", apiResp.Data, nil
}
