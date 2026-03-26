package process

import (
	"fmt"
	"os/exec"
	"time"
)

func ForceStartGateway() error {
	// 使用 nohup 方式或直接 Start() 且不等待，确保网关在后台启动
	cmd := exec.Command("openclaw", "gateway", "--force")
	
	// 我们不使用 Run()，因为 gateway 是一个常驻进程，Run() 会一直阻塞直到进程退出
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start gateway: %v", err)
	}

	// 启动成功后，我们立即释放对该进程的控制权（不等待它结束）
	go func() {
		_ = cmd.Wait()
	}()
	
	return nil
}

func StopGateway(port int) error {
	// 1. 尝试标准停止命令
	cmd := exec.Command("openclaw", "gateway", "stop")
	_ = cmd.Run() // 忽略错误，因为可能是散装进程

	// 2. 等待一小会儿让进程自行退出
	time.Sleep(1500 * time.Millisecond)

	// 3. 检查端口是否还在。如果在，强制 kill
	if IsPortListening(port) {
		pid, err := GetPIDByPort(port)
		if err == nil && pid > 0 {
			killCmd := exec.Command("kill", "-9", fmt.Sprintf("%d", pid))
			_ = killCmd.Run()
		}
	}

	return nil
}

func RestartGateway(port int) error {
	// 1. 先执行带强杀逻辑的停止
	_ = StopGateway(port)

	// 2. 确保旧进程释放资源 (StopGateway 内部已有等待，这里加 500ms 缓冲)
	time.Sleep(500 * time.Millisecond)

	// 3. 重新启动
	return ForceStartGateway()
}

func RunDoctorFix() error {
	// doctor --fix 通常是一次性执行的命令，可以使用 Run()
	cmd := exec.Command("openclaw", "doctor", "--fix")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to run openclaw doctor --fix: %v", err)
	}
	return nil
}
