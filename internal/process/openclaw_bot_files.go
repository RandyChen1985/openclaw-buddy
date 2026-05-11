package process

import (
	"encoding/json"
	"fmt"
	"openclaw-buddy/internal/utils"
	"os"
	"path/filepath"
	"strings"
)

func cleanOpenClawMemoryFilename(filename string) (string, error) {
	filename = strings.TrimSpace(filename)
	if filename == "" {
		return "", fmt.Errorf("filename is required")
	}
	if filename != filepath.Base(filename) || strings.Contains(filename, "..") {
		return "", fmt.Errorf("invalid memory filename")
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if ext != ".md" && ext != ".txt" {
		return "", fmt.Errorf("memory filename must end with .md or .txt")
	}
	return filename, nil
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
		cleanFilename, err := cleanOpenClawMemoryFilename(filename)
		if err != nil {
			return "", err
		}
		filePath = filepath.Join(botWorkspace, "memory", cleanFilename)
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
		cleanFilename, err := cleanOpenClawMemoryFilename(filename)
		if err != nil {
			return err
		}
		memoryDir := filepath.Join(botWorkspace, "memory")
		if err := os.MkdirAll(memoryDir, 0755); err != nil {
			return fmt.Errorf("failed to create memory directory: %w", err)
		}
		filePath = filepath.Join(memoryDir, cleanFilename)
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
	cleanFilename, err := cleanOpenClawMemoryFilename(filename)
	if err != nil {
		return err
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

	filePath := filepath.Join(utils.ExpandPath(botWorkspace), "memory", cleanFilename)
	return os.Remove(filePath)
}

func GetBotWorkspace(configDir, botID string) (string, error) {
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return "", err
	}

	var fullCfg map[string]interface{}
	if err := json.Unmarshal(data, &fullCfg); err != nil {
		return "", err
	}

	agents, ok := fullCfg["agents"].(map[string]interface{})
	if !ok {
		return "", fmt.Errorf("agents not found")
	}

	list, ok := agents["list"].([]interface{})
	if !ok {
		return "", fmt.Errorf("agent list not found")
	}

	for _, item := range list {
		bot, ok := item.(map[string]interface{})
		if !ok {
			continue
		}

		id, _ := bot["id"].(string)
		if id == botID {
			ws, _ := bot["workspace"].(string)
			if ws == "" {
				// 尝试读取默认工作空间
				if defaults, ok := agents["defaults"].(map[string]interface{}); ok {
					ws, _ = defaults["workspace"].(string)
				}
			}
			return utils.ExpandPath(ws), nil
		}
	}

	return "", fmt.Errorf("bot not found")
}
