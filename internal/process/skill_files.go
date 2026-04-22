package process

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"openclaw-buddy/internal/utils"
)

// FileEntry represents a file or directory in the skill resource explorer
type FileEntry struct {
	Name     string `json:"name"`
	Path     string `json:"path"` // Absolute path
	IsDir    bool   `json:"is_dir"`
	Size     int64  `json:"size"`
	ModTime  string `json:"mod_time"`
}

// GetAllowedSkillBases returns the list of allowed root directories for skills
func GetAllowedSkillBases() []string {
	bases := []string{
		utils.ExpandPath("~/.openclaw/skills"),
		utils.ExpandPath("~/.openclaw/workspace/skills"),
		utils.ExpandPath("~/.agents/skills"),
		utils.ExpandPath("~/.openclaw/lib/skills"),
	}

	// Add bundled skills path if detected
	if bundledPath := GetBundledSkillsPath(); bundledPath != "" {
		bases = append(bases, bundledPath)
	}

	return bases
}

// GetBundledSkillsPath tries to detect the path of bundled skills in the python environment
func GetBundledSkillsPath() string {
	// Try standard python3 detection
	cmd := exec.Command("python3", "-c", "import openclaw; import os; print(os.path.join(os.path.dirname(openclaw.__file__), 'skills', 'bundled'))")
	out, err := cmd.Output()
	if err == nil {
		path := strings.TrimSpace(string(out))
		if info, err := os.Stat(path); err == nil && info.IsDir() {
			return path
		}
	}
	return ""
}

// VerifySkillPath checks if the given path is within any of the allowed skill directories
func VerifySkillPath(absPath string) error {
	if absPath == "" {
		return fmt.Errorf("path is empty")
	}

	cleanPath, err := filepath.Abs(absPath)
	if err != nil {
		return fmt.Errorf("failed to get absolute path: %v", err)
	}

	allowedBases := GetAllowedSkillBases()
	isAllowed := false
	for _, base := range allowedBases {
		absBase, err := filepath.Abs(base)
		if err != nil {
			continue
		}
		// Use HasPrefix with directory boundaries to avoid common traversal/prefix issues
		// e.g. /home/user/.openclaw/skills-secret vs /home/user/.openclaw/skills
		if strings.HasPrefix(cleanPath, absBase) {
			// Ensure it's either the base itself or a child (checking for path separator)
			if len(cleanPath) == len(absBase) || cleanPath[len(absBase)] == os.PathSeparator {
				isAllowed = true
				break
			}
		}
	}

	if !isAllowed {
		return fmt.Errorf("access denied: path '%s' is outside allowed skill directories", absPath)
	}

	return nil
}

// ListSkillResources returns the contents of a directory within the skill boundaries
func ListSkillResources(absPath string) ([]FileEntry, error) {
	if err := VerifySkillPath(absPath); err != nil {
		return nil, err
	}

	entries, err := os.ReadDir(absPath)
	if err != nil {
		return nil, err
	}

	var results []FileEntry
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			continue
		}

		fullPath := filepath.Join(absPath, entry.Name())
		results = append(results, FileEntry{
			Name:    entry.Name(),
			Path:    fullPath,
			IsDir:   entry.IsDir(),
			Size:    info.Size(),
			ModTime: info.ModTime().Format("2006-01-02 15:04:05"),
		})
	}

	return results, nil
}

// ReadSkillResource returns the content of a file within the skill boundaries
func ReadSkillResource(absPath string) (string, error) {
	if err := VerifySkillPath(absPath); err != nil {
		return "", err
	}

	info, err := os.Stat(absPath)
	if err != nil {
		return "", err
	}
	if info.IsDir() {
		return "", fmt.Errorf("cannot read a directory as a file")
	}

	// Limit file size to prevent memory issues (e.g. 10MB)
	if info.Size() > 10*1024*1024 {
		return "", fmt.Errorf("file is too large (max 10MB)")
	}

	data, err := os.ReadFile(absPath)
	if err != nil {
		return "", err
	}

	return string(data), nil
}

// SaveSkillResource writes content to a file within the skill boundaries
func SaveSkillResource(absPath, content string) error {
	if err := VerifySkillPath(absPath); err != nil {
		return err
	}

	info, err := os.Stat(absPath)
	if err == nil && info.IsDir() {
		return fmt.Errorf("cannot overwrite a directory with file content")
	}

	// Double check the parent directory as well
	if err := VerifySkillPath(filepath.Dir(absPath)); err != nil {
		return err
	}

	return os.WriteFile(absPath, []byte(content), 0644)
}
