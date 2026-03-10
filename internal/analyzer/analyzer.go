package analyzer

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/pmezard/go-difflib/difflib"
)

func GenerateReport(reportDir, configDir, errorFile, backupFile string) (string, error) {
	if err := os.MkdirAll(reportDir, 0755); err != nil {
		return "", fmt.Errorf("failed to create report directory: %v", err)
	}

	diff, err := GetDiff(backupFile, errorFile)
	if err != nil {
		diff = fmt.Sprintf("Failed to generate diff: %v", err)
	}

	timestamp := time.Now().Format("20060102_150405")
	reportPath := filepath.Join(reportDir, fmt.Sprintf("fault_report_%s.md", timestamp))

	content := fmt.Sprintf(`# 🦞 小龙虾故障诊断报表 (Fault Report)

- **发生时间**: %s
- **判定原因**: 配置修改导致启动失败

## 🔍 配置差异对比 (Diff)
相比于上一个稳定版本（openclaw.json.bak），当前的改动如下：

%s

## 🛡️ 自愈动作
- [x] 备份错误配置至 openclaw.json.err
- [x] 回滚配置至 openclaw.json.bak
- [x] 强行重启网关进程
`, time.Now().Format("2006-01-02 15:04:05"), "```diff\n"+diff+"\n```")

	if err := os.WriteFile(reportPath, []byte(content), 0644); err != nil {
		return "", fmt.Errorf("failed to write report: %v", err)
	}

	return reportPath, nil
}

func GetDiff(fileA, fileB string) (string, error) {
	textA, err := os.ReadFile(fileA)
	if err != nil {
		return "", err
	}
	textB, err := os.ReadFile(fileB)
	if err != nil {
		return "", err
	}

	diff := difflib.UnifiedDiff{
		A:        difflib.SplitLines(string(textA)),
		B:        difflib.SplitLines(string(textB)),
		FromFile: "backup",
		ToFile:   "error",
		Context:  3,
	}

	return difflib.GetUnifiedDiffString(diff)
}
