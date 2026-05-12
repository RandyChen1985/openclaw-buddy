package process

import (
	"encoding/json"
	"fmt"
	"openclaw-buddy/internal/utils"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

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

func GetOpenClawSkills() (any, error) {
	out, err := openclawCombinedLargeStdout(GetOpenClawBinary(), "skills", "list", "--json")
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
		preview := cleanOut
		if len(preview) > 480 {
			preview = preview[:480] + "…"
		}
		return nil, fmt.Errorf("failed to parse skills json: %w (len=%d preview=%q)", err, len(cleanOut), preview)
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
