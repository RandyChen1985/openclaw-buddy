package utils

import (
	"os"
	"path/filepath"
)

// ExpandPath 将路径中的 ~ 展开为当前用户的主目录
func ExpandPath(path string) string {
	if len(path) > 0 && path[0] == '~' {
		home, err := os.UserHomeDir()
		if err != nil {
			return path
		}
		// 使用 filepath.Join 确保跨平台路径分隔符正确
		return filepath.Join(home, path[1:])
	}
	return path
}
