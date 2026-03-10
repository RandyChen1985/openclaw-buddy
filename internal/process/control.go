package process

import (
	"fmt"
	"os/exec"
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

func RunDoctorFix() error {
	// doctor --fix 通常是一次性执行的命令，可以使用 Run()
	cmd := exec.Command("openclaw", "doctor", "--fix")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to run openclaw doctor --fix: %v", err)
	}
	return nil
}
