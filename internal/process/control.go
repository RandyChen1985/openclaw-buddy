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
		if IsPortListening("", port) {
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
	_ = cmd.Run() 

	// 2. 等待一小会儿让进程自行退出
	time.Sleep(1500 * time.Millisecond)

	// 3. 检查端口是否还在。如果在，强制 kill
	if IsPortListening("", port) {
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
	// 使用 restart 确保官方逻辑介入清理
	cmd := exec.Command(GetOpenClawBinary(), "gateway", "restart")

	// 启动进程
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start gateway: %v", err)
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
	cmd := exec.Command(GetOpenClawBinary(), "doctor", "--fix", "--yes")
	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("failed to run openclaw doctor --fix --yes: %v", err)
	}
	return nil
}

func RunDoctorFixWithOutput() (string, error) {
	cmd := exec.Command(GetOpenClawBinary(), "doctor", "--fix", "--yes")
	output, err := cmd.CombinedOutput()
	return string(output), err
}

