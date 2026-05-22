package process

import (
	"encoding/json"
	"fmt"
	"log"
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
	Path        string `json:"path"`      // 绝对路径
	IsGlobal    bool   `json:"is_global"` // 是否为全局技能 (true=全局, false=私有)
	BotID       string `json:"bot_id,omitempty"` // 所属 Bot ID (仅私有技能有效)
	UpdatedAt   int64  `json:"updated_at,omitempty"` // 目录更新时间 (Unix timestamp)
	Missing     *struct {
		Bins   []string `json:"bins"`
		Env    []string `json:"env"`
		Config []string `json:"config"`
		OS     []string `json:"os"`
	} `json:"missing,omitempty"`
}

func GetDynamicSkillDirs(configDir string) []string {
	dirs := []string{
		utils.ExpandPath("~/.openclaw/skills"),
		utils.ExpandPath("~/.openclaw/workspace/skills"),
		utils.ExpandPath("~/.agents/skills"),
		utils.ExpandPath("~/.openclaw/lib/skills"),
	}

	cfgDir := configDir
	if cfgDir == "" {
		cfgDir = utils.ExpandPath("~/.openclaw")
	} else {
		cfgDir = utils.ExpandPath(cfgDir)
	}

	configPath := filepath.Join(cfgDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err == nil {
		var fullCfg map[string]interface{}
		if err := json.Unmarshal(data, &fullCfg); err == nil {
			if agents, ok := fullCfg["agents"].(map[string]interface{}); ok {
				// 1. 默认 workspace
				if defaults, ok := agents["defaults"].(map[string]interface{}); ok {
					if ws, ok := defaults["workspace"].(string); ok && ws != "" {
						dirs = append(dirs, filepath.Join(utils.ExpandPath(ws), "skills"))
					}
				}
				// 2. 各个 bot 的专属 workspace
				if list, ok := agents["list"].([]interface{}); ok {
					for _, item := range list {
						if bot, ok := item.(map[string]interface{}); ok {
							if ws, ok := bot["workspace"].(string); ok && ws != "" {
								dirs = append(dirs, filepath.Join(utils.ExpandPath(ws), "skills"))
							}
						}
					}
				}
			}
		}
	}

	// 去重并确保绝对路径
	uniqueDirs := make(map[string]bool)
	var finalDirs []string
	for _, d := range dirs {
		abs, err := filepath.Abs(d)
		if err != nil {
			abs = d
		}
		if !uniqueDirs[abs] {
			uniqueDirs[abs] = true
			finalDirs = append(finalDirs, abs)
		}
	}

	return finalDirs
}

type SkillDirSource struct {
	Path     string
	IsGlobal bool
	BotID    string
}

func GetDynamicSkillDirSources(configDir string) []SkillDirSource {
	var sources []SkillDirSource

	// 1. 常规全局路径
	globalDirs := []string{
		utils.ExpandPath("~/.openclaw/skills"),
		utils.ExpandPath("~/.agents/skills"),
		utils.ExpandPath("~/.openclaw/lib/skills"),
	}
	for _, gd := range globalDirs {
		abs, err := filepath.Abs(gd)
		if err != nil {
			abs = gd
		}
		sources = append(sources, SkillDirSource{
			Path:     abs,
			IsGlobal: true,
		})
	}

	// 2. Python 内置路径也是全局路径
	if bundledPath := GetBundledSkillsPath(); bundledPath != "" {
		abs, err := filepath.Abs(bundledPath)
		if err != nil {
			abs = bundledPath
		}
		sources = append(sources, SkillDirSource{
			Path:     abs,
			IsGlobal: true,
		})
	}

	// 3. 读取各 Bot 的专属工作区 (私有技能)
	cfgDir := configDir
	if cfgDir == "" {
		cfgDir = utils.ExpandPath("~/.openclaw")
	} else {
		cfgDir = utils.ExpandPath(cfgDir)
	}

	configPath := filepath.Join(cfgDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err == nil {
		var fullCfg map[string]interface{}
		if err := json.Unmarshal(data, &fullCfg); err == nil {
			if agents, ok := fullCfg["agents"].(map[string]interface{}); ok {
				// 默认 workspace (属于默认主 Bot "main" 的私有技能目录)
				if defaults, ok := agents["defaults"].(map[string]interface{}); ok {
					if ws, ok := defaults["workspace"].(string); ok && ws != "" {
						abs, err := filepath.Abs(filepath.Join(utils.ExpandPath(ws), "skills"))
						if err != nil {
							abs = filepath.Join(utils.ExpandPath(ws), "skills")
						}
						sources = append(sources, SkillDirSource{
							Path:     abs,
							IsGlobal: false,
							BotID:    "main",
						})
					}
				}
				// 各个 bot 的专属 workspace
				if list, ok := agents["list"].([]interface{}); ok {
					for _, item := range list {
						if bot, ok := item.(map[string]interface{}); ok {
							botID, _ := bot["id"].(string)
							if ws, ok := bot["workspace"].(string); ok && ws != "" && botID != "" {
								abs, err := filepath.Abs(filepath.Join(utils.ExpandPath(ws), "skills"))
								if err != nil {
									abs = filepath.Join(utils.ExpandPath(ws), "skills")
								}
								sources = append(sources, SkillDirSource{
									Path:     abs,
									IsGlobal: false,
									BotID:    botID,
								})
							}
						}
					}
				}
			}
		}
	}

	// 排重
	uniqueSources := make(map[string]SkillDirSource)
	var finalSources []SkillDirSource
	for _, src := range sources {
		if existing, exists := uniqueSources[src.Path]; exists {
			if !existing.IsGlobal && existing.BotID == "" && src.BotID != "" {
				uniqueSources[src.Path] = src
			}
		} else {
			uniqueSources[src.Path] = src
			finalSources = append(finalSources, src)
		}
	}

	var result []SkillDirSource
	for _, src := range finalSources {
		result = append(result, uniqueSources[src.Path])
	}
	return result
}

func GetOpenClawSkills(configDir string) (any, error) {
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

	// 补全绝对路径并绑定 IsGlobal 与 BotID 属性
	sources := GetDynamicSkillDirSources(configDir)

	for i := range skills {
		name := skills[i].Name
		skills[i].IsGlobal = false
		skills[i].BotID = ""

		for _, src := range sources {
			if skillPath := findSkillPathInDir(src.Path, name); skillPath != "" {
				skills[i].Path = skillPath
				skills[i].IsGlobal = src.IsGlobal
				skills[i].BotID = src.BotID
				break
			}
		}
		// 如果物理路径存在，根据目录的更新时间来判断，如果不存在目录，则忽略这个时间
		if skills[i].Path != "" {
			if info, err := os.Stat(skills[i].Path); err == nil {
				skills[i].UpdatedAt = info.ModTime().Unix()
			}
		}
		// 如果最终未能匹配并获取到任何物理路径，则一律归属为“全局技能”，对所有 Bot 开放
		if skills[i].Path == "" {
			skills[i].IsGlobal = true
		}
	}

	return map[string]any{"skills": skills}, nil
}

func UninstallOpenClawSkill(configDir string, name string) error {
	cmd := exec.Command("openclaw", "skills", "uninstall", name)
	out, err := cmd.CombinedOutput()
	if err == nil {
		return nil
	}

	// 卸载命令执行失败，开始通过删除物理路径目录进行兜底
	log.Printf("⚠️ openclaw skills uninstall %s 失败: %v. Output: %s. 开始尝试物理路径删除兜底...", name, err, string(out))

	// 物理路径搜寻
	sources := GetDynamicSkillDirSources(configDir)
	var targetPath string
	for _, src := range sources {
		if skillPath := findSkillPathInDir(src.Path, name); skillPath != "" {
			targetPath = skillPath
			break
		}
	}

	if targetPath != "" {
		log.Printf("🔍 发现技能物理路径: %s，执行物理删除兜底...", targetPath)
		if err := os.RemoveAll(targetPath); err != nil {
			return fmt.Errorf("openclaw uninstall failed (%v), and fallback physical removal of %s failed: %w", err, targetPath, err)
		}
		log.Printf("✅ 物理删除兜底成功: %s", targetPath)
		return nil
	}

	// 如果既不能通过卸载命令完成，也无法定位其物理路径，则返回原始命令错误
	return fmt.Errorf("failed to uninstall skill %s: %v. Output: %s", name, err, string(out))
}

func ReloadOpenClawSkills() error {
	// 目前版本的 openclaw CLI (2026.3.24) 不支持 skills reload 子命令。
	// 重载操作由上层 Handler 调用 SyncKeySingle("skills") 通过执行 list 命令来完成实时的列表扫描。
	return nil
}

func findSkillPathInDir(dirBase string, skillName string) string {
	// 1. 直连匹配 (最快，覆盖95%的情况)
	directPath := filepath.Join(dirBase, skillName)
	if info, err := os.Stat(directPath); err == nil && info.IsDir() {
		return directPath
	}

	// 2. 遍历子目录，解析元数据 (兼容目录名与技能名不一致的情况，如目录名为中文 “上海天气预报”)
	entries, err := os.ReadDir(dirBase)
	if err != nil {
		return ""
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}

		subDirPath := filepath.Join(dirBase, entry.Name())

		// 检查 SKILL.md
		skillMdPath := filepath.Join(subDirPath, "SKILL.md")
		if info, err := os.Stat(skillMdPath); err == nil && !info.IsDir() {
			// 读取前 1KB 数据以提取 yaml frontmatter
			data, err := readFirstBytes(skillMdPath, 1024)
			if err == nil {
				if nameFromYaml := parseSkillName(data); nameFromYaml == skillName {
					return subDirPath
				}
			}
		}

		// 也可以检查 skill.yaml (备用)
		skillYamlPath := filepath.Join(subDirPath, "skill.yaml")
		if info, err := os.Stat(skillYamlPath); err == nil && !info.IsDir() {
			data, err := readFirstBytes(skillYamlPath, 1024)
			if err == nil {
				if nameFromYaml := parseSkillName(data); nameFromYaml == skillName {
					return subDirPath
				}
			}
		}
	}

	return ""
}

func readFirstBytes(path string, limit int64) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()

	buf := make([]byte, limit)
	n, err := file.Read(buf)
	if err != nil && err.Error() != "EOF" {
		return "", err
	}
	return string(buf[:n]), nil
}

func parseSkillName(content string) string {
	lines := strings.Split(content, "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "name:") {
			parts := strings.SplitN(trimmed, ":", 2)
			if len(parts) == 2 {
				val := strings.TrimSpace(parts[1])
				// 去掉两边的引号
				val = strings.Trim(val, `"'`)
				return val
			}
		}
	}
	return ""
}
