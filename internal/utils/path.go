package utils

import (
	"io"
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
// CopyFile 复制文件从 src 到 dst
func CopyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	if err != nil {
		return err
	}
	return out.Close()
}
