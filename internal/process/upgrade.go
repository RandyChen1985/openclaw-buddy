package process

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"net/http"
	"openclaw-buddy/internal/utils"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

func SelfRestart() error {
	execPath, err := os.Executable()
	if err != nil {
		return err
	}

	// 核心修复：处理升级场景下的路径偏移
	// 如果当前正在运行的是 .old 备份文件，说明我们刚完成物理替换
	// 重启时应该拉起那个“去掉 .old 后缀”的新二进制文件
	if strings.HasSuffix(execPath, ".old") {
		newPath := strings.TrimSuffix(execPath, ".old")
		if _, err := os.Stat(newPath); err == nil {
			log.Printf("🚀 [System] 检测到升级备份模式运行，正在切换到新版本二进制: %s", newPath)
			execPath = newPath
		}
	}

	// 准备启动新进程的参数和环境变量
	args := os.Args
	cmd := exec.Command(execPath, args[1:]...)
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()

	// 在启动新进程前，主动释放文件锁
	// 这样新进程可以立即获得锁，而不需要等待旧进程退出，实现真正意义上的“无缝接力”
	if utils.GlobalLock != nil {
		log.Printf("🔓 [System] 正在主动释放文件锁，准备移交控制权...")
		utils.GlobalLock.Unlock()
	}

	// 启动新进程
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("无法拉起新进程: %v", err)
	}

	log.Printf("👋 [System] Buddy 服务器正在重启，新进程 (PID: %d) 已启动，原进程即将退出...", cmd.Process.Pid)

	// 给 HTTP 响应留出返回时间，1秒后优雅退出
	// 配合 Lock() 的重试逻辑，新进程会等待旧进程退出后自动获得文件锁
	go func() {
		time.Sleep(1 * time.Second)
		os.Exit(0)
	}()

	return nil
}

func copyFile(src, dst string) error {
	sourceFile, err := os.Open(src)
	if err != nil {
		return err
	}
	defer sourceFile.Close()

	destFile, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer destFile.Close()

	_, err = io.Copy(destFile, sourceFile)
	return err
}

// DownloadAndUpgrade 执行自动化升级核心流程
// 只替换 ./lib/openclaw-buddy 即可，其他不用动
func DownloadAndUpgrade(version, taskID string) (string, error) {
	// 1. 确定平台标识
	platform := ""
	switch runtime.GOOS {
	case "darwin":
		platform = "mac"
	case "linux":
		platform = "linux"
	case "windows":
		platform = "windows"
	default:
		return "", fmt.Errorf("不支持的操作系统: %s", runtime.GOOS)
	}

	// 2. 构造下载链接
	// 格式：https://github.com/RandyChen1985/openclaw-buddy/releases/download/{version}/openclaw-buddy-{platform}-{version}.tar.gz
	version = strings.TrimPrefix(version, "v")
	fileName := fmt.Sprintf("openclaw-buddy-%s-%s.tar.gz", platform, version)
	
	// 使用 GitHub 代理加速下载（针对国内网络环境，避免丢包或无限卡死）
	githubUrl := fmt.Sprintf("https://github.com/RandyChen1985/openclaw-buddy/releases/download/%s/%s", version, fileName)
	url := "https://ghproxy.net/" + githubUrl

	log.Printf("🌐 [Upgrade] 正在从 GitHub (代理) 下载更新包: %s", githubUrl)
	utils.RecordSystemEvent("UPDATE", fmt.Sprintf("正在下载版本 v%s (%s)", version, platform))

	// 3. 创建临时工作目录
	tempDir, err := os.MkdirTemp("", "buddy-upgrade-*")
	if err != nil {
		return "", fmt.Errorf("无法创建临时目录: %v", err)
	}
	defer os.RemoveAll(tempDir) // 核心防呆：无论成功失败，退出时自动核爆临时目录

	archivePath := filepath.Join(tempDir, fileName)

	// 4. 执行下载（带进度上报）
	if err := downloadFile(url, archivePath, taskID); err != nil {
		return "", fmt.Errorf("下载失败: %v", err)
	}

	// 5. 解压并提取 lib/openclaw-buddy
	UpdateTaskProgress(taskID, 90)
	log.Printf("📦 [Upgrade] 下载完成，正在解压提取二进制文件...")
	newBinaryPath := filepath.Join(tempDir, "openclaw-buddy-new")
	if err := extractBinaryFromTarGz(archivePath, newBinaryPath); err != nil {
		return "", fmt.Errorf("解压提取失败: %v", err)
	}

	// 6. 执行物理替换
	UpdateTaskProgress(taskID, 95)
	if err := applyBinaryUpgrade(newBinaryPath); err != nil {
		return "", fmt.Errorf("物理替换失败: %v", err)
	}

	UpdateTaskProgress(taskID, 100)
	msg := fmt.Sprintf("⚡️ 版本 v%s 核心二进制文件已替换就绪！请立即在首页点击“重启生效”按钮。", version)
	utils.RecordSystemEvent("UPDATE", msg)
	return msg, nil
}

// downloadFile 下载文件并上报进度到 Task Center
func downloadFile(url, dst string, taskID string) error {
	// 配置 15 分钟全局超时时间的 HTTP Client，防止底层死锁
	client := &http.Client{
		Timeout: 15 * time.Minute,
	}

	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return err
	}

	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("服务器返回异常状态码: %d", resp.StatusCode)
	}

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	total := resp.ContentLength
	var downloaded int64

	// 创建带进度的 Reader
	buf := make([]byte, 32*1024)
	lastReport := time.Now()

	for {
		n, err := resp.Body.Read(buf)
		if n > 0 {
			_, writeErr := out.Write(buf[:n])
			if writeErr != nil {
				return writeErr
			}
			downloaded += int64(n)

			// 每 500ms 或下载完成时上报一次进度，避免过于频繁
			if total > 0 && (time.Since(lastReport) > 500*time.Millisecond || downloaded == total) {
				progress := int(float64(downloaded) / float64(total) * 85) // 下载进度占总进度的 0-85%
				UpdateTaskProgress(taskID, progress)
				lastReport = time.Now()
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}

	return nil
}

// extractBinaryFromTarGz 从压缩包中寻找并提取 lib/openclaw-buddy
func extractBinaryFromTarGz(src, dst string) error {
	f, err := os.Open(src)
	if err != nil {
		return err
	}
	defer f.Close()

	gzr, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gzr.Close()

	tr := tar.NewReader(gzr)
	targetFound := false

	for {
		header, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		// 适配解压后的路径，通常是 openclaw-buddy-{platform}-{version}/lib/openclaw-buddy
		// 或者直接是 lib/openclaw-buddy
		if strings.HasSuffix(header.Name, "lib/openclaw-buddy") || strings.HasSuffix(header.Name, "lib/openclaw-buddy.exe") {
			out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY, 0755)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return err
			}
			out.Close()
			targetFound = true
			break
		}
	}

	if !targetFound {
		return fmt.Errorf("在压缩包中未找到 lib/openclaw-buddy 二进制文件")
	}
	return nil
}

// applyBinaryUpgrade 执行原子级文件替换
func applyBinaryUpgrade(newBinaryPath string) error {
	// 1. 直接获取当前正在运行的二进制文件绝对路径
	targetBinary, err := os.Executable()
	if err != nil {
		return fmt.Errorf("无法获取当前执行路径: %v", err)
	}
	
	targetBinary, _ = filepath.Abs(targetBinary)

	// 安全校验：目标文件必须包含 openclaw-buddy 关键字，防止误操作系统核心文件
	if !strings.Contains(strings.ToLower(filepath.Base(targetBinary)), "openclaw-buddy") {
		return fmt.Errorf("安全熔断：当前执行路径 [%s] 不包含预期关键字，为了系统安全，自动升级已中止", targetBinary)
	}

	oldBinary := targetBinary + ".old"

	log.Printf("🔐 [Upgrade] 正在准备替换二进制: %s", targetBinary)

	// 1. 如果旧备份存在，先删除
	// 安全校验：确保 oldBinary 是我们预期的文件，不是根目录
	if len(oldBinary) > 10 && strings.HasSuffix(oldBinary, ".old") {
		_ = os.Remove(oldBinary)
	}

	// 2. 将当前运行的二进制重命名
	if _, err := os.Stat(targetBinary); err == nil {
		if err := os.Rename(targetBinary, oldBinary); err != nil {
			return fmt.Errorf("重命名旧二进制失败: %v (请检查权限)", err)
		}
	}

	// 3. 将新二进制复制到目标位置
	if err := copyFile(newBinaryPath, targetBinary); err != nil {
		// 如果失败，尝试回滚
		_ = os.Rename(oldBinary, targetBinary)
		return fmt.Errorf("物理替换失败: %v (尝试回滚成功)", err)
	}

	// 4. 确保可执行权限
	_ = os.Chmod(targetBinary, 0755)

	log.Printf("✨ [Upgrade] 二进制文件替换成功！")
	return nil
}
