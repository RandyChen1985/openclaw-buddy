package process

import (
	"fmt"
	"os/exec"
)

func ForceStartGateway() error {
	cmd := exec.Command("openclaw", "gateway", "--force")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to force start gateway: %v", err)
	}
	return nil
}

func RunDoctorFix() error {
	cmd := exec.Command("openclaw", "doctor", "--fix")
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to run openclaw doctor --fix: %v", err)
	}
	return nil
}
