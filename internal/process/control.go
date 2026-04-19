package process

import (
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"time"
)

// GatewayController 定义了网关控制的标准化接口
type GatewayController interface {
	Restart(port int) error
	Stop(port int) error
	Start() error
}

// DefaultGatewayController 是网关控制的默认实现
type DefaultGatewayController struct{}

var (
	// DefaultController 提供了一个默认的控制器单例，方便直接调用
	DefaultController = &DefaultGatewayController{}
)

// Restart 实现了高可靠的重启逻辑：直接执行 restart 命令，并监控端口状态作为反馈
func (c *DefaultGatewayController) Restart(port int) error {
	// 1. 直接执行官方推荐的 restart 命令
	// 这通常比手动组合 Stop + Start 更健壮，因为 restart 内部会处理锁文件和 PID
	_ = c.Start()

	// 2. 轮询检查端口是否成功启动 (最多等待 10 秒)
	success := false
	for i := 0; i < 10; i++ {
		time.Sleep(1 * time.Second)
		if IsPortListening(port) {
			success = true
			break
		}
	}

	// 3. 兜底逻辑：如果端口仍未监听到，说明 restart 可能失败（例如旧进程死锁）
	// 此时执行暴力清理并再次尝试启动
	if !success {
		fmt.Printf("⚠️  Gateway port %d not responding after restart, executing force recovery...\n", port)
		_ = c.Stop(port)
		time.Sleep(500 * time.Millisecond)
		return c.Start()
	}

	return nil
}

// Stop 尝试停止网关进程，如果无法优雅停止则执行强制杀进程
func (c *DefaultGatewayController) Stop(port int) error {
	// 1. 尝试标准停止命令
	cmd := exec.Command(GetOpenClawBinary(), "gateway", "stop")
	PrepareSilentCommand(cmd)
	_ = cmd.Run() // 忽略错误，因为可能是散装进程

	// 2. 等待一小会儿让进程自行退出
	time.Sleep(1500 * time.Millisecond)

	// 3. 检查端口是否还在。如果在，强制 kill
	if IsPortListening(port) {
		pid, err := GetPIDByPort(port)
		if err == nil && pid > 0 {
			// 安全防护：检查是否是 Buddy 进程自身
			myPid := os.Getpid()
			if pid == myPid {
				return nil
			}

			var killCmd *exec.Cmd
			if runtime.GOOS == "windows" {
				killCmd = exec.Command("taskkill", "/F", "/PID", fmt.Sprintf("%d", pid))
				PrepareSilentCommand(killCmd)
			} else {
				killCmd = exec.Command("kill", "-9", fmt.Sprintf("%d", pid))
			}
			_ = killCmd.Run()
		}
	}

	return nil
}

// Start 在后台执行网关的重启/启动命令
func (c *DefaultGatewayController) Start() error {
	// 在 Windows 下即便点击的是“开始”，底层也通过 restart 来执行
	// 因为 restart 会处理“已存在任务”的停止和清理，比 start 更稳健。
	action := "restart"
	cmd := exec.Command(GetOpenClawBinary(), "gateway", action)
	PrepareSilentCommand(cmd)

	// 启动进程
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to execute gateway %s: %v", action, err)
	}

	// 立即释放对该进程的控制权
	go func() {
		_ = cmd.Wait()
	}()

	return nil
}

// --- 为了保持向下兼容，保留包级函数，内部调用 DefaultController ---

func RestartGateway(port int) error {
	return DefaultController.Restart(port)
}

func StopGateway(port int) error {
	return DefaultController.Stop(port)
}

func ForceStartGateway() error {
	return DefaultController.Start()
}
func RunDoctorFix() error {
	// 1. 系统级修复：尝试重新安装网关服务（解决 schtasks 缺失问题）
	if runtime.GOOS == "windows" {
		_ = InstallGatewayService()
	}

	// 2. OpenClaw 内部修复
	cmd := exec.Command(GetOpenClawBinary(), "doctor", "--fix", "--yes")
	PrepareSilentCommand(cmd)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to run openclaw doctor --fix --yes: %v", err)
	}
	return nil
}

// InstallGatewayService 尝试安装网关服务。在 Windows 下会通过 PowerShell 触发 UAC 提权。
func InstallGatewayService() error {
	bin := GetOpenClawBinary()
	if runtime.GOOS == "windows" {
		// 使用 PowerShell 的 Start-Process -Verb RunAs 来请求管理员权限
		// 这将弹出一个系统 UAC 对话框
		psCmd := fmt.Sprintf("Start-Process '%s' -ArgumentList 'gateway','install' -Verb RunAs -Wait", bin)
		cmd := exec.Command("powershell", "-Command", psCmd)
		PrepareSilentCommand(cmd)
		return cmd.Run()
	}

	// Unix 系统直接运行
	cmd := exec.Command(bin, "gateway", "install")
	PrepareSilentCommand(cmd)
	return cmd.Run()
}

func RunDoctorFixWithOutput() (string, error) {
	cmd := exec.Command(GetOpenClawBinary(), "doctor", "--fix", "--yes")
	PrepareSilentCommand(cmd)
	output, err := cmd.CombinedOutput()
	return string(output), err
}
