package utils

import (
	"os"
	"path/filepath"
	"strings"
)

// ExpandPath 将路径中的 ~ 展开为当前用户的主目录。
// 注意：必须用 ~/ 前缀；旧实现使用 filepath.Join(home, path[1:]) 会在 path[1:] 以 / 开头时丢弃 home。
func ExpandPath(path string) string {
	path = strings.TrimSpace(path)
	if strings.HasPrefix(path, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return filepath.Join(home, path[2:])
	}
	if path == "~" {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		return home
	}
	return path
}
