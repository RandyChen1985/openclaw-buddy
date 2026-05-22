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
	Name    string `json:"name"`
	Path    string `json:"path"` // Absolute path
	IsDir   bool   `json:"is_dir"`
	Size    int64  `json:"size"`
	ModTime string `json:"mod_time"`
}

// GetAllowedSkillBases returns the list of allowed root directories for skills
func GetAllowedSkillBases(configDir ...string) []string {
	cfg := ""
	if len(configDir) > 0 {
		cfg = configDir[0]
	}
	bases := GetDynamicSkillDirs(cfg)

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

func pathWithinSkillBase(path, base string) bool {
	rel, err := filepath.Rel(base, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)))
}

func evalSkillBase(base string) (string, error) {
	absBase, err := filepath.Abs(base)
	if err != nil {
		return "", err
	}
	evaluated, err := filepath.EvalSymlinks(absBase)
	if err != nil {
		return absBase, nil
	}
	return evaluated, nil
}

func evalSkillPath(path string) (string, error) {
	if evaluated, err := filepath.EvalSymlinks(path); err == nil {
		return filepath.Abs(evaluated)
	}

	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	parts := strings.Split(filepath.Clean(absPath), string(os.PathSeparator))
	for i := len(parts); i > 0; i-- {
		prefix := filepath.Join(parts[:i]...)
		if filepath.IsAbs(absPath) {
			prefix = string(os.PathSeparator) + prefix
		}
		if st, err := os.Stat(prefix); err == nil && st.IsDir() {
			evaluatedPrefix, err := filepath.EvalSymlinks(prefix)
			if err != nil {
				return "", err
			}
			remainder := filepath.Join(parts[i:]...)
			if remainder == "." || remainder == "" {
				return filepath.Abs(evaluatedPrefix)
			}
			return filepath.Abs(filepath.Join(evaluatedPrefix, remainder))
		}
	}
	return absPath, nil
}

func cleanSkillChildName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("name is required")
	}
	if name != filepath.Base(name) || name == "." || name == ".." || strings.Contains(name, "..") {
		return "", fmt.Errorf("invalid name")
	}
	return name, nil
}

// VerifySkillPath checks if the given path is within any of the allowed skill directories
// and returns the absolute, expanded path.
func VerifySkillPath(path string, configDir ...string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("path is empty")
	}

	cleanPath, err := evalSkillPath(utils.ExpandPath(path))
	if err != nil {
		return "", fmt.Errorf("failed to get absolute path: %v", err)
	}

	allowedBases := GetAllowedSkillBases(configDir...)
	isAllowed := false
	for _, base := range allowedBases {
		absBase, err := evalSkillBase(base)
		if err != nil {
			continue
		}
		if pathWithinSkillBase(cleanPath, absBase) {
			isAllowed = true
			break
		}
	}

	if !isAllowed {
		return "", fmt.Errorf("access denied: path '%s' is outside allowed skill directories", path)
	}

	return cleanPath, nil
}

// ListSkillResources returns the contents of a directory within the skill boundaries
func ListSkillResources(path string, configDir ...string) ([]FileEntry, error) {
	absPath, err := VerifySkillPath(path, configDir...)
	if err != nil {
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
func ReadSkillResource(path string, configDir ...string) (string, error) {
	absPath, err := VerifySkillPath(path, configDir...)
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
func SaveSkillResource(path, content string, configDir ...string) error {
	absPath, err := VerifySkillPath(path, configDir...)
	if err != nil {
		return err
	}

	info, err := os.Stat(absPath)
	if err == nil && info.IsDir() {
		return fmt.Errorf("cannot overwrite a directory with file content")
	}

	// Double check the parent directory as well
	if _, err := VerifySkillPath(filepath.Dir(absPath), configDir...); err != nil {
		return err
	}

	return os.WriteFile(absPath, []byte(content), 0644)
}

func CreateSkillResourceFile(dirPath, filename, content string, configDir ...string) (string, error) {
	absDir, err := VerifySkillPath(dirPath, configDir...)
	if err != nil {
		return "", err
	}
	filename, err = cleanSkillChildName(filename)
	if err != nil {
		return "", err
	}
	destPath := filepath.Join(absDir, filename)
	if _, err := VerifySkillPath(destPath, configDir...); err != nil {
		return "", err
	}
	if _, err := os.Stat(destPath); err == nil {
		return "", fmt.Errorf("file already exists")
	}
	if err := os.WriteFile(destPath, []byte(content), 0644); err != nil {
		return "", err
	}
	return destPath, nil
}

func CreateSkillResourceDir(dirPath, dirname string, configDir ...string) (string, error) {
	absDir, err := VerifySkillPath(dirPath, configDir...)
	if err != nil {
		return "", err
	}
	dirname, err = cleanSkillChildName(dirname)
	if err != nil {
		return "", err
	}
	destPath := filepath.Join(absDir, dirname)
	if _, err := VerifySkillPath(destPath, configDir...); err != nil {
		return "", err
	}
	if _, err := os.Stat(destPath); err == nil {
		return "", fmt.Errorf("directory already exists")
	}
	if err := os.MkdirAll(destPath, 0755); err != nil {
		return "", err
	}
	return destPath, nil
}
