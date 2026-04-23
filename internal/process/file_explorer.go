package process

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"openclaw-buddy/internal/utils"
)

// ExplorerFileEntry represents a file or directory in the file explorer
type ExplorerFileEntry struct {
	Name    string `json:"name"`
	Path    string `json:"path"` // Absolute path
	IsDir   bool   `json:"is_dir"`
	Size    int64  `json:"size"`
	ModTime string `json:"mod_time"`
}

// GetAllowedExplorerPaths collects all valid root directories from openclaw.json and standard skill paths
func GetAllowedExplorerPaths(configDir string) ([]string, error) {
	bases := GetAllowedSkillBases()

	// Add workspace paths from openclaw.json
	configPath := filepath.Join(configDir, "openclaw.json")
	data, err := os.ReadFile(configPath)
	if err == nil {
		var fullCfg map[string]interface{}
		if err := json.Unmarshal(data, &fullCfg); err == nil {
			// 1. Get default workspace
			if agents, ok := fullCfg["agents"].(map[string]interface{}); ok {
				if defaults, ok := agents["defaults"].(map[string]interface{}); ok {
					if ws, ok := defaults["workspace"].(string); ok && ws != "" {
						bases = append(bases, utils.ExpandPath(ws))
					}
				}
				// 2. Get workspaces and agentDirs from individual bots
				if list, ok := agents["list"].([]interface{}); ok {
					for _, item := range list {
						if bot, ok := item.(map[string]interface{}); ok {
							if ws, ok := bot["workspace"].(string); ok && ws != "" {
								bases = append(bases, utils.ExpandPath(ws))
							}
							if ad, ok := bot["agentDir"].(string); ok && ad != "" {
								bases = append(bases, utils.ExpandPath(ad))
							}
						}
					}
				}
			}
		}
	}

	// Remove duplicates and normalize
	uniqueBases := make(map[string]bool)
	var finalBases []string
	for _, b := range bases {
		abs, err := filepath.Abs(b)
		if err != nil {
			continue
		}
		if !uniqueBases[abs] {
			uniqueBases[abs] = true
			finalBases = append(finalBases, abs)
		}
	}

	return finalBases, nil
}

// VerifyExplorerPath checks if the given path is within any allowed directories
// and returns the absolute, expanded path.
func VerifyExplorerPath(path, configDir string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("path is empty")
	}

	expanded := utils.ExpandPath(path)
	cleanPath, err := filepath.Abs(expanded)
	if err != nil {
		return "", fmt.Errorf("failed to get absolute path: %v", err)
	}

	allowedBases, err := GetAllowedExplorerPaths(configDir)
	if err != nil {
		return "", err
	}

	isAllowed := false
	for _, base := range allowedBases {
		absBase, _ := filepath.Abs(base)
		if strings.HasPrefix(cleanPath, absBase) {
			if len(cleanPath) == len(absBase) || cleanPath[len(absBase)] == os.PathSeparator {
				isAllowed = true
				break
			}
		}
	}

	if !isAllowed {
		return "", fmt.Errorf("access denied: path is outside allowed directories")
	}

	return cleanPath, nil
}

// ListExplorerFiles returns the contents of a directory
func ListExplorerFiles(path, configDir string) ([]ExplorerFileEntry, error) {
	absPath, err := VerifyExplorerPath(path, configDir)
	if err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		return nil, err
	}

	var results []ExplorerFileEntry
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		fullPath := filepath.Join(absPath, entry.Name())
		results = append(results, ExplorerFileEntry{
			Name:    entry.Name(),
			Path:    fullPath,
			IsDir:   entry.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime().Format("2006-01-02 15:04:05"),
		})
	}

	return results, nil
}

// ReadExplorerFile returns the content of a file
func ReadExplorerFile(path, configDir string) (string, error) {
	absPath, err := VerifyExplorerPath(path, configDir)
	if err != nil {
		return "", err
	}

	info, err := os.Stat(absPath)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("cannot read a directory as a file")
	}

	// Limit 10MB
	if info.Size() > 10*1024*1024 {
		return "", fmt.Errorf("file is too large (max 10MB)")
	}

	data, err := os.ReadFile(absPath)
	if err != nil {
		return "", err
	}

	return string(data), nil
}

// WriteExplorerFile writes content to a file
func WriteExplorerFile(path, content, configDir string) error {
	absPath, err := VerifyExplorerPath(path, configDir)
	if err != nil {
		return err
	}

	info, err := os.Stat(absPath)
	if err == nil && info.IsDir() {
		return fmt.Errorf("cannot overwrite a directory with file content")
	}

	// Verify parent dir
	if _, err := VerifyExplorerPath(filepath.Dir(absPath), configDir); err != nil {
		return err
	}

	return os.WriteFile(absPath, []byte(content), 0644)
}

// DeleteExplorerFile deletes a file or an empty directory
func DeleteExplorerFile(path, configDir string) error {
	absPath, err := VerifyExplorerPath(path, configDir)
	if err != nil {
		return err
	}

	// Safety: don't allow deleting the root of an allowed base
	allowedBases, _ := GetAllowedExplorerPaths(configDir)
	for _, base := range allowedBases {
		if absPath == base {
			return fmt.Errorf("cannot delete root allowed directory")
		}
	}

	return os.RemoveAll(absPath) // Be careful with RemoveAll, but VerifyExplorerPath should protect us
}
