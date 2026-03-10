package guardian

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"
	"yovole-openclaw-monitor/internal/analyzer"
	"yovole-openclaw-monitor/internal/config"
	"yovole-openclaw-monitor/internal/process"
	"yovole-openclaw-monitor/internal/utils"
)

type Guardian struct {
	config   *config.Config
	dingTalk *utils.DingTalk
}

func NewGuardian(cfg *config.Config) *Guardian {
	g := &Guardian{config: cfg}
	if cfg.DingTalkEnabled {
		g.dingTalk = utils.NewDingTalk(cfg.DingTalkToken, cfg.DingTalkSecret)
	}
	return g
}

func (g *Guardian) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(g.config.CheckIntervalSeconds) * time.Second)
	defer ticker.Stop()

	log.Printf("🛡️ Guardian monitor loop started. Every %d seconds.", g.config.CheckIntervalSeconds)

	for {
		select {
		case <-ticker.C:
			g.check()
		case <-ctx.Done():
			return
		}
	}
}

func (g *Guardian) check() {
	if !process.IsPortListening(g.config.HealthPort) {
		log.Printf("⚠️ Port %d is not listening! Service might be down.", g.config.HealthPort)
		g.heal("Port Down")
		return
	}

	if err := process.CheckHealth(); err != nil {
		log.Printf("⚠️ Health check failed: %v", err)
		g.heal("Health Check Failure")
		return
	}

	log.Printf("✅ OpenClaw is healthy.")
}

func (g *Guardian) heal(reason string) {
	log.Printf("🛠️ Initiating self-healing process for reason: %s", reason)

	hostname, _ := os.Hostname()
	g.notifyDingTalk("⚠️ 小龙虾故障报警", fmt.Sprintf("### 🦞 小龙虾故障报警\n\n- **节点**: %s\n- **状态**: ⚠️ 检测到服务宕机\n- **原因**: %s\n- **正在尝试自愈...**", hostname, reason))

	configPath := filepath.Join(g.config.OpenClawConfigDir, "openclaw.json")
	backupPath := filepath.Join(g.config.OpenClawConfigDir, "openclaw.json.bak")
	errorPath := filepath.Join(g.config.OpenClawConfigDir, "openclaw.json.err")

	// 1. Backup current broken config
	_ = copyFile(configPath, errorPath)

	// 2. Generate Report
	reportPath, err := analyzer.GenerateReport(g.config.ReportDir, g.config.OpenClawConfigDir, configPath, backupPath)
	reportMsg := ""
	if err == nil {
		reportMsg = fmt.Sprintf("\n- **诊断报表**: %s", reportPath)
	}

	// 3. Rollback config or Doctor Fix
	log.Printf("🔄 Attempting to recover service...")
	recovered := false

	// Tier 1: Try Rollback
	if _, err := os.Stat(backupPath); err == nil {
		log.Printf("🔄 Rolling back configuration from backup...")
		if err := copyFile(backupPath, configPath); err == nil {
			recovered = true
			log.Printf("✅ Config rollback successful.")
		} else {
			log.Printf("❌ Failed to rollback config: %v", err)
		}
	} else {
		log.Printf("⚠️ Backup config not found. Skipping rollback.")
	}

	// Tier 2: Doctor Fix if rollback skipped or failed
	if !recovered {
		log.Printf("🩺 Running 'openclaw doctor --fix' as secondary recovery strategy...")
		if err := process.RunDoctorFix(); err == nil {
			recovered = true
			log.Printf("✅ 'openclaw doctor --fix' completed successfully.")
		} else {
			log.Printf("❌ 'openclaw doctor --fix' failed: %v", err)
		}
	}

	// 4. Force restart
	log.Printf("🚀 Attempting to force start gateway...")
	if err := process.ForceStartGateway(); err != nil {
		log.Printf("❌ Failed to restart gateway: %v", err)
		g.notifyDingTalk("❌ 小龙虾自愈失败", fmt.Sprintf("### 🦞 小龙虾自愈失败\n\n- **节点**: %s\n- **严重级别**: ERROR\n- **原因**: 进程拉起失败: %v", hostname, err))
		return
	}

	log.Printf("✨ Self-healing completed.")
	recoveryMethod := "配置回滚"
	if !recovered {
		recoveryMethod = "强行重启 (未执行配置恢复)"
	} else if _, err := os.Stat(backupPath); err != nil {
		recoveryMethod = "Doctor 修复"
	}
	
	g.notifyDingTalk("✅ 小龙虾自愈成功", fmt.Sprintf("### 🦞 小龙虾自愈成功\n\n- **节点**: %s\n- **状态**: ✅ 已自动恢复上线\n- **操作**: %s 并强行重启%s", hostname, recoveryMethod, reportMsg))
}

func (g *Guardian) notifyDingTalk(title, text string) {
	if g.dingTalk != nil {
		go func() {
			if err := g.dingTalk.SendMarkdown(title, text); err != nil {
				log.Printf("❌ Failed to send DingTalk notification: %v", err)
			}
		}()
	}
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
