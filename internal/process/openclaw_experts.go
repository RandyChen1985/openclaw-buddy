package process

import (
	"embed"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

//go:embed experts
var expertTemplates embed.FS

type Expert struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	NameEn        string `json:"name_en"`
	Description   string `json:"description"`
	DescriptionEn string `json:"description_en"`
	Emoji         string `json:"emoji"`
	Category      string `json:"category"`
	CategoryZh    string `json:"category_zh"`
	Soul          string `json:"soul"`
	Identity      struct {
		Name string `json:"name"`
		Bio  string `json:"bio"`
	} `json:"identity"`
	IdentityMD string   `json:"identity_md"` // 新增字段：支持全量身份 Markdown
	Skills     []string `json:"skills"`
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
