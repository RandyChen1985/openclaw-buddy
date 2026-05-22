package process

import (
	"archive/tar"
	"archive/zip"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"openclaw-buddy/internal/utils"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
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

// extractArchive extracts a .tar.gz or .zip file safely to target finalSkillDir
func extractArchive(archivePath string, finalSkillDir string) error {
	if err := os.MkdirAll(filepath.Dir(finalSkillDir), 0755); err != nil {
		return err
	}

	tempExtractDir, err := os.MkdirTemp(filepath.Dir(finalSkillDir), "tmp_extract_*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tempExtractDir)

	f, err := os.Open(archivePath)
	if err != nil {
		return err
	}
	defer f.Close()

	headerBytes := make([]byte, 262)
	n, _ := f.Read(headerBytes)
	_, _ = f.Seek(0, 0)

	isZip := false
	if n >= 4 && string(headerBytes[:4]) == "PK\x03\x04" {
		isZip = true
	}

	if isZip {
		fi, err := f.Stat()
		if err != nil {
			return err
		}
		zr, err := zip.NewReader(f, fi.Size())
		if err != nil {
			return err
		}
		for _, file := range zr.File {
			cleanName := filepath.Clean(file.Name)
			if strings.HasPrefix(cleanName, "/") || strings.Contains(cleanName, "..") {
				return fmt.Errorf("security boundary violation: zip contains traversal path: %s", file.Name)
			}
			targetPath := filepath.Join(tempExtractDir, cleanName)
			if !strings.HasPrefix(targetPath, tempExtractDir) {
				return fmt.Errorf("security boundary violation: zip path outside temp: %s", file.Name)
			}

			if file.FileInfo().IsDir() {
				if err := os.MkdirAll(targetPath, 0755); err != nil {
					return err
				}
				continue
			}

			if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
				return err
			}

			outFile, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, file.Mode())
			if err != nil {
				return err
			}
			rc, err := file.Open()
			if err != nil {
				outFile.Close()
				return err
			}
			_, err = io.Copy(outFile, rc)
			rc.Close()
			outFile.Close()
			if err != nil {
				return err
			}
		}
	} else {
		gr, err := gzip.NewReader(f)
		if err != nil {
			return fmt.Errorf("failed to create gzip reader (is it a valid tar.gz?): %v", err)
		}
		defer gr.Close()

		tr := tar.NewReader(gr)
		for {
			hdr, err := tr.Next()
			if err == io.EOF {
				break
			}
			if err != nil {
				return err
			}

			cleanName := filepath.Clean(hdr.Name)
			if strings.HasPrefix(cleanName, "/") || strings.Contains(cleanName, "..") {
				return fmt.Errorf("security boundary violation: tar contains traversal path: %s", hdr.Name)
			}
			targetPath := filepath.Join(tempExtractDir, cleanName)
			if !strings.HasPrefix(targetPath, tempExtractDir) {
				return fmt.Errorf("security boundary violation: tar path outside temp: %s", hdr.Name)
			}

			switch hdr.Typeflag {
			case tar.TypeDir:
				if err := os.MkdirAll(targetPath, 0755); err != nil {
					return err
				}
			case tar.TypeReg:
				if err := os.MkdirAll(filepath.Dir(targetPath), 0755); err != nil {
					return err
				}
				outFile, err := os.OpenFile(targetPath, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, hdr.FileInfo().Mode())
				if err != nil {
					return err
				}
				_, err = io.Copy(outFile, tr)
				outFile.Close()
				if err != nil {
					return err
				}
			}
		}
	}

	f.Close()

	entries, err := os.ReadDir(tempExtractDir)
	if err != nil {
		return err
	}

	sourceDir := tempExtractDir
	if len(entries) == 1 && entries[0].IsDir() {
		sourceDir = filepath.Join(tempExtractDir, entries[0].Name())
	}

	_ = os.RemoveAll(finalSkillDir)

	if err := os.Rename(sourceDir, finalSkillDir); err != nil {
		return copyDir(sourceDir, finalSkillDir)
	}

	return nil
}

// copyDir recursively copies a directory tree
func copyDir(src string, dst string) error {
	return filepath.Walk(src, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if info.IsDir() {
			return os.MkdirAll(target, info.Mode())
		}

		srcFile, err := os.Open(path)
		if err != nil {
			return err
		}
		defer srcFile.Close()

		dstFile, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, info.Mode())
		if err != nil {
			return err
		}
		defer dstFile.Close()

		_, err = io.Copy(dstFile, srcFile)
		return err
	})
}

// InstallSkillFromURL downloads and extracts a skill from an online URL
func InstallSkillFromURL(tarballURL, targetDir, skillName string, taskID string, configDir string) error {
	finalSkillDir := filepath.Join(targetDir, skillName)

	if _, err := VerifySkillPath(finalSkillDir, configDir); err != nil {
		return fmt.Errorf("security validation failed for target path: %v", err)
	}

	if taskID != "" {
		UpdateTaskProgress(taskID, 10)
	}

	tempFile, err := os.CreateTemp(targetDir, "skill_archive_*.tmp")
	if err != nil {
		return fmt.Errorf("failed to create temporary archive file: %v", err)
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(tarballURL)
	if err != nil {
		return fmt.Errorf("failed to download skill archive: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to download skill: server returned status %s", resp.Status)
	}

	contentLength := resp.ContentLength
	var downloaded int64
	buffer := make([]byte, 32*1024)
	for {
		nr, er := resp.Body.Read(buffer)
		if nr > 0 {
			nw, ew := tempFile.Write(buffer[:nr])
			if nw > 0 {
				downloaded += int64(nw)
			}
			if ew != nil {
				return fmt.Errorf("failed to write to temp file: %v", ew)
			}
		}
		if er == io.EOF {
			break
		}
		if er != nil {
			return fmt.Errorf("error while downloading: %v", er)
		}

		if contentLength > 0 && taskID != "" {
			percent := int(10 + (float64(downloaded)/float64(contentLength))*50)
			if percent > 60 {
				percent = 60
			}
			UpdateTaskProgress(taskID, percent)
		}
	}
	tempFile.Close()

	if taskID != "" {
		UpdateTaskProgress(taskID, 70)
	}

	if err := extractArchive(tempFile.Name(), finalSkillDir); err != nil {
		_ = os.RemoveAll(finalSkillDir)
		return fmt.Errorf("failed to extract and install skill: %v", err)
	}

	if taskID != "" {
		UpdateTaskProgress(taskID, 90)
	}

	return nil
}

// InstallSkillFromReader extracts uploaded skill content directly
func InstallSkillFromReader(r io.Reader, targetDir, skillName string, configDir string) error {
	finalSkillDir := filepath.Join(targetDir, skillName)

	if _, err := VerifySkillPath(finalSkillDir, configDir); err != nil {
		return fmt.Errorf("security validation failed for target path: %v", err)
	}

	tempFile, err := os.CreateTemp(targetDir, "uploaded_skill_archive_*.tmp")
	if err != nil {
		return fmt.Errorf("failed to create temporary archive file: %v", err)
	}
	defer os.Remove(tempFile.Name())
	defer tempFile.Close()

	if _, err := io.Copy(tempFile, r); err != nil {
		return fmt.Errorf("failed to save uploaded file stream: %v", err)
	}
	tempFile.Close()

	if err := extractArchive(tempFile.Name(), finalSkillDir); err != nil {
		_ = os.RemoveAll(finalSkillDir)
		return fmt.Errorf("failed to extract uploaded skill archive: %v", err)
	}

	return nil
}
