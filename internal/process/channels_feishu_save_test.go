package process

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// TestSaveChannelSecret_Feishu_mockOpenclaw 用 PATH 里的假 openclaw 验证：
// 1) 会带上 OPENCLAW_CONFIG_DIR / OPENCLAW_CONFIG_PATH；
// 2) 会依次调用 config set channels.feishu.* 与 enabled。
// 不依赖本机安装的真实 openclaw。
func TestSaveChannelSecret_Feishu_mockOpenclaw(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("mock shell script is unix-only")
	}

	cfgRoot := t.TempDir()
	if err := os.WriteFile(filepath.Join(cfgRoot, "openclaw.json"), []byte(`{"channels":{}}`), 0o644); err != nil {
		t.Fatal(err)
	}

	binDir := filepath.Join(cfgRoot, "mockbin")
	if err := os.MkdirAll(binDir, 0o755); err != nil {
		t.Fatal(err)
	}
	logFile := filepath.Join(cfgRoot, "openclaw-invocations.log")
	script := filepath.Join(binDir, "openclaw")
	body := "#!/bin/sh\n" +
		"{\n" +
		"  echo \"INV:$*\"\n" +
		"  echo \"DIR=$OPENCLAW_CONFIG_DIR\"\n" +
		"  echo \"CFG=$OPENCLAW_CONFIG_PATH\"\n" +
		"  echo \"STATE=$OPENCLAW_STATE_DIR\"\n" +
		"  echo \"---\"\n" +
		"} >>\"" + logFile + "\"\n" +
		"if [ \"$1\" = \"config\" ] && [ \"$2\" = \"set\" ]; then\n" +
		"  exit 0\n" +
		"fi\n" +
		"exit 99\n"
	if err := os.WriteFile(script, []byte(body), 0o755); err != nil {
		t.Fatal(err)
	}

	oldPath := os.Getenv("PATH")
	t.Cleanup(func() { _ = os.Setenv("PATH", oldPath) })
	_ = os.Setenv("PATH", binDir+string(os.PathListSeparator)+oldPath)

	wantAbs, err := filepath.Abs(cfgRoot)
	if err != nil {
		t.Fatal(err)
	}

	if err := SaveChannelSecret(cfgRoot, "feishu", map[string]string{"appId": "cli_test", "appSecret": "sec_test"}); err != nil {
		t.Fatal(err)
	}

	raw, err := os.ReadFile(logFile)
	if err != nil {
		t.Fatal(err)
	}
	log := string(raw)
	if !strings.Contains(log, "DIR="+wantAbs) {
		t.Fatalf("log missing expected CONFIG_DIR:\n%s", log)
	}
	wantCfg := filepath.Join(wantAbs, "openclaw.json")
	if !strings.Contains(log, "CFG="+wantCfg) {
		t.Fatalf("log missing expected CONFIG_PATH:\n%s", log)
	}
	if !strings.Contains(log, "STATE="+wantAbs) {
		t.Fatalf("log missing STATE_DIR:\n%s", log)
	}
	for _, needle := range []string{
		"INV:config set channels.feishu.appId cli_test",
		"INV:config set channels.feishu.appSecret sec_test",
		"INV:config set channels.feishu.enabled true",
	} {
		if !strings.Contains(log, needle) {
			t.Fatalf("log missing %q:\n%s", needle, log)
		}
	}
}
