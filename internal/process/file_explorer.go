package process

import (
	"encoding/json"
	"fmt"
	"io/fs"
	"openclaw-buddy/internal/utils"
	"os"
	"path/filepath"
	"strings"
)

const maxExplorerSearchVisits = 20000

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

func pathWithinBase(path, base string) bool {
	rel, err := filepath.Rel(base, path)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)))
}

func evalAllowedBase(base string) (string, error) {
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

func evalPathForExplorer(path string) (string, error) {
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

func cleanExplorerChildName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("name is required")
	}
	if name != filepath.Base(name) || name == "." || name == ".." || strings.Contains(name, "..") {
		return "", fmt.Errorf("invalid name")
	}
	return name, nil
}

// VerifyExplorerPath checks if the given path is within any allowed directories
// and returns the absolute, expanded path.
func VerifyExplorerPath(path, configDir string) (string, error) {
	if path == "" {
		return "", fmt.Errorf("path is empty")
	}

	cleanPath, err := evalPathForExplorer(utils.ExpandPath(path))
	if err != nil {
		return "", fmt.Errorf("failed to get absolute path: %v", err)
	}

	allowedBases, err := GetAllowedExplorerPaths(configDir)
	if err != nil {
		return "", err
	}

	isAllowed := false
	for _, base := range allowedBases {
		absBase, err := evalAllowedBase(base)
		if err != nil {
			continue
		}
		if pathWithinBase(cleanPath, absBase) {
			isAllowed = true
			break
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

// UploadExplorerFile writes uploaded bytes to the target directory
func UploadExplorerFile(dirPath, filename string, data []byte, configDir string) (string, error) {
	absDir, err := VerifyExplorerPath(dirPath, configDir)
	if err != nil {
		return "", err
	}

	info, err := os.Stat(absDir)
	if err != nil {
		return "", fmt.Errorf("target directory does not exist: %v", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("target path is not a directory")
	}

	filename, err = cleanExplorerChildName(filename)
	if err != nil {
		return "", err
	}

	destPath := filepath.Join(absDir, filename)
	if _, err := VerifyExplorerPath(destPath, configDir); err != nil {
		return "", err
	}
	if err := os.WriteFile(destPath, data, 0644); err != nil {
		return "", err
	}
	return destPath, nil
}

// ReadExplorerFileBytes returns the raw bytes of a file for download
func ReadExplorerFileBytes(path, configDir string) ([]byte, string, error) {
	absPath, err := VerifyExplorerPath(path, configDir)
	if err != nil {
		return nil, "", err
	}

	info, err := os.Stat(absPath)
	if err != nil {
		return nil, "", err
	}
	if info.IsDir() {
		return nil, "", fmt.Errorf("cannot download a directory")
	}
	if info.Size() > 100*1024*1024 {
		return nil, "", fmt.Errorf("file is too large (max 100MB)")
	}

	data, err := os.ReadFile(absPath)
	if err != nil {
		return nil, "", err
	}
	return data, filepath.Base(absPath), nil
}

// CreateExplorerFile creates a new empty file
func CreateExplorerFile(dirPath, filename, content, configDir string) (string, error) {
	absDir, err := VerifyExplorerPath(dirPath, configDir)
	if err != nil {
		return "", err
	}
	filename, err = cleanExplorerChildName(filename)
	if err != nil {
		return "", err
	}

	destPath := filepath.Join(absDir, filename)
	if _, err := VerifyExplorerPath(destPath, configDir); err != nil {
		return "", err
	}
	// Check if already exists
	if _, err := os.Stat(destPath); err == nil {
		return "", fmt.Errorf("file already exists")
	}

	if err := os.WriteFile(destPath, []byte(content), 0644); err != nil {
		return "", err
	}
	return destPath, nil
}

// RenameExplorerFile renames or moves a file or directory
func RenameExplorerFile(oldPath, newPath, configDir string) error {
	absOld, err := VerifyExplorerPath(oldPath, configDir)
	if err != nil {
		return err
	}

	absNew, err := VerifyExplorerPath(newPath, configDir)
	if err != nil {
		return err
	}

	// Safety: don't allow renaming the root of an allowed base
	allowedBases, _ := GetAllowedExplorerPaths(configDir)
	for _, base := range allowedBases {
		if absOld == base {
			return fmt.Errorf("cannot rename root allowed directory")
		}
	}

	// Check if destination already exists
	if _, err := os.Stat(absNew); err == nil {
		return fmt.Errorf("destination already exists")
	}

	return os.Rename(absOld, absNew)
}

// SearchExplorerFiles performs a recursive search for files matching the query
func SearchExplorerFiles(rootPath, query, configDir string) ([]ExplorerFileEntry, error) {
	absRoot, err := VerifyExplorerPath(rootPath, configDir)
	if err != nil {
		return nil, err
	}

	var results []ExplorerFileEntry
	query = strings.ToLower(query)
	visited := 0

	err = filepath.Walk(absRoot, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // Skip errors
		}
		visited++
		if visited > maxExplorerSearchVisits {
			return filepath.SkipAll
		}
		if info.IsDir() {
			switch info.Name() {
			case ".git", "node_modules", "dist", "build", ".next", ".cache":
				if path != absRoot {
					return filepath.SkipDir
				}
			}
			if mode := info.Mode(); mode&fs.ModeSymlink != 0 {
				return filepath.SkipDir
			}
		}

		if strings.Contains(strings.ToLower(info.Name()), query) {
			verifiedPath, verifyErr := VerifyExplorerPath(path, configDir)
			if verifyErr != nil {
				if info.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			results = append(results, ExplorerFileEntry{
				Name:    info.Name(),
				Path:    verifiedPath,
				IsDir:   info.IsDir(),
				Size:    info.Size(),
				ModTime: info.ModTime().Format("2006-01-02 15:04:05"),
			})
		}

		// Limit results to 1000
		if len(results) >= 1000 {
			return filepath.SkipDir
		}

		return nil
	})

	return results, err
}

// CreateExplorerDir creates a new directory
func CreateExplorerDir(dirPath, dirname, configDir string) (string, error) {
	absDir, err := VerifyExplorerPath(dirPath, configDir)
	if err != nil {
		return "", err
	}
	dirname, err = cleanExplorerChildName(dirname)
	if err != nil {
		return "", err
	}

	destPath := filepath.Join(absDir, dirname)
	if _, err := VerifyExplorerPath(destPath, configDir); err != nil {
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
