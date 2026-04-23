package process

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestOpenClawConfigEnv_empty(t *testing.T) {
	_, err := OpenClawConfigEnv("   ")
	if err == nil {
		t.Fatal("expected error for empty dir")
	}
}

func TestOpenClawConfigEnv_tildeExpansion(t *testing.T) {
	// 使用临时 HOME，避免在 CI/沙箱中无法写入真实用户主目录
	fakeHome := t.TempDir()
	t.Setenv("HOME", fakeHome)

	sub := fmt.Sprintf("oc_cfg_%d", time.Now().UnixNano())
	wantDir := filepath.Join(fakeHome, sub)
	if err := os.MkdirAll(wantDir, 0o755); err != nil {
		t.Fatal(err)
	}

	env, err := OpenClawConfigEnv("~/"+sub)
	if err != nil {
		t.Fatal(err)
	}
	var gotDir, gotPath string
	for _, e := range env {
		if strings.HasPrefix(e, "OPENCLAW_CONFIG_DIR=") {
			gotDir = strings.TrimPrefix(e, "OPENCLAW_CONFIG_DIR=")
		}
		if strings.HasPrefix(e, "OPENCLAW_CONFIG_PATH=") {
			gotPath = strings.TrimPrefix(e, "OPENCLAW_CONFIG_PATH=")
		}
	}
	if gotDir == "" || gotPath == "" {
		t.Fatalf("missing env: %#v", env)
	}
	if gotDir != wantDir {
		t.Fatalf("OPENCLAW_CONFIG_DIR=%q want %q", gotDir, wantDir)
	}
	if want := filepath.Join(wantDir, "openclaw.json"); gotPath != want {
		t.Fatalf("OPENCLAW_CONFIG_PATH=%q want %q", gotPath, want)
	}
}

func TestRunCommandWithEnvAndTimeout_nonZeroExit(t *testing.T) {
	res, err := RunCommandWithEnvAndTimeout(3*time.Second, nil, "sh", "-c", "echo oops >&2; exit 7")
	if err == nil {
		t.Fatal("expected error")
	}
	if res == nil || res.Success {
		t.Fatalf("expected failure result, got %+v err=%v", res, err)
	}
	if res.ReturnCode != 7 {
		t.Fatalf("return code=%d want 7", res.ReturnCode)
	}
}

func TestRunCommandWithEnvAndTimeout_success(t *testing.T) {
	res, err := RunCommandWithEnvAndTimeout(3*time.Second, nil, "sh", "-c", "echo ok")
	if err != nil {
		t.Fatal(err)
	}
	if !res.Success || !strings.Contains(res.Output, "ok") {
		t.Fatalf("unexpected %+v", res)
	}
}
