package guardian

import (
	"context"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"
	"openclaw-buddy/internal/analyzer"
	"openclaw-buddy/internal/config"
	"openclaw-buddy/internal/process"
	"openclaw-buddy/internal/scheduler"
	"openclaw-buddy/internal/utils"
	"crypto/md5"
	"encoding/hex"
	"sort"
	"net/http"
	"strings"
	"math/rand"
)

type Guardian struct {
	config        *config.Config
	feishu        *utils.Feishu
	lastConfigMD5 string
}

func NewGuardian(cfg *config.Config) *Guardian {
	g := &Guardian{config: cfg}
	if cfg.FeishuEnabled {
		g.feishu = utils.NewFeishu(cfg.FeishuAppID, cfg.FeishuAppSecret)
	}
	return g
}

func (g *Guardian) Run(ctx context.Context) {
	ticker := time.NewTicker(time.Duration(g.config.CheckIntervalSeconds) * time.Second)
	defer ticker.Stop()

	// 每天清理一次旧数据 (保留7天)
	cleanupTicker := time.NewTicker(24 * time.Hour)
	defer cleanupTicker.Stop()

	// 每 10 分钟同步一次业务数据缓存 (虾兵蟹将、设备、渠道)
	cacheTicker := time.NewTicker(10 * time.Minute)
	defer cacheTicker.Stop()

	// 每 12 小时检查一次版本更新
	versionTicker := time.NewTicker(12 * time.Hour)
	defer versionTicker.Stop()

	// 启动时立即执行一次清理和全量同步，并检查更新
	go func() {
		rows, err := utils.CleanupOldData(7)
		if err == nil && rows > 0 {
			log.Printf("🧹 [DB] 已自动清理超过 7 天的旧监控数据 (共 %d 条).", rows)
		}
		process.CleanupOrphanedTasks()
		if g.config.CacheSyncOnStartup {
			process.SyncAllWithConcurrency(g.config.OpenClawConfigDir, g.config.CacheSyncConcurrency)
		} else {
			log.Printf("ℹ️ [Cache] 启动时全量同步已关闭 (CACHE_SYNC_ON_STARTUP=false)")
		}
		g.CheckVersionUpdate()
	}()

	// 启动飞书 WebSocket 长链接
	if g.feishu != nil {
		g.feishu.StartLongConnection(ctx)
		hostname, _ := os.Hostname()
		status := process.GetGatewayStatus()
		utils.RecordSystemEvent("INFO", "🛡️ OpenClaw Buddy 监控服务已启动")
		g.notifyFeishu(context.Background(), "🛡️ OpenClaw Buddy 监控服务已启动", fmt.Sprintf("节点: %s\n状态: ✅ 监控运行中\n版本: 🦞 OpenClaw Buddy\n\n---\n**OpenClaw 状态详情:**\n%s", hostname, status))
	}

	log.Printf("🛡️ OpenClaw Buddy 监控服务巡检循环已启动. Every %d seconds.", g.config.CheckIntervalSeconds)

	// 启动时检查：健康端口在监听即视为服务可用（不调用 openclaw health），按开关决定是否备份
	isSelfHealingEnabled := utils.GetSetting("self_healing_enabled", "false") == "true"
	
	// 尝试从配置获取所有可能的 host
	hosts := []string{"127.0.0.1"}
	if gw, err := process.GetOpenClawGatewayConfig(g.config.OpenClawConfigDir); err == nil {
		hosts = gw.GetGatewayHosts()
	}

	if process.IsAnyPortListening(hosts, g.config.HealthPort) {
		if isSelfHealingEnabled {
			log.Printf("📦 Gateway port %d is listening on startup. Performing initial backup...", g.config.HealthPort)
			g.backupConfig()
		} else {
			log.Printf("ℹ️ [自愈服务] 当前开关已关闭，启动时跳过配置备份流程。")
		}
	}
	for {
		select {
		case <-ticker.C:
			g.check()
		case <-cleanupTicker.C:
			rows, _ := utils.CleanupOldData(7)
			if rows > 0 {
				log.Printf("🧹 [DB] 定时清理任务：已移除 %d 条过期监控数据.", rows)
			}
		case <-cacheTicker.C:
			log.Printf("🔄 [Cache] 执行定时业务数据全量同步...")
			process.SyncAll(g.config.OpenClawConfigDir)
		case <-versionTicker.C:
			log.Printf("🌐 [Update] 执行定时版本更新检查...")
			g.CheckVersionUpdate()
		case <-ctx.Done():
			hostname, _ := os.Hostname()
			g.notifyFeishu(context.Background(), "👋 OpenClaw Buddy 监控服务已停止", fmt.Sprintf("节点: %s\n状态: ⏹️ 服务已正常退出", hostname))
			return
		}
	}
}

func (g *Guardian) check() {
	var lastErr error
	var reason string

	isSelfHealingEnabled := utils.GetSetting("self_healing_enabled", "false") == "true"
	if !isSelfHealingEnabled {
		log.Printf("🔍 [巡检] 自愈服务开关目前处于【关闭】状态，本次巡检将仅记录监控数据，不触发自动修复。")
	}

	for i := 1; i <= g.config.MaxRetries; i++ {
		// 1. Port Check
		// 尝试从配置获取所有可能的 host
		hosts := []string{"127.0.0.1"}
		if gw, err := process.GetOpenClawGatewayConfig(g.config.OpenClawConfigDir); err == nil {
			hosts = gw.GetGatewayHosts()
		}

		if !process.IsAnyPortListening(hosts, g.config.HealthPort) {
			reason = "Port Down"
			lastErr = fmt.Errorf("port %d is not listening on any candidate hosts", g.config.HealthPort)
		} else {
			// 端口在监听即视为健康，不再执行 openclaw health（避免 CLI 退出码与网关实际可用不一致）
			responseTimeMs := 0
			metrics := process.GetSystemMetrics()
			g.recordHealthCheck("Healthy", responseTimeMs, metrics.CPUUsage, metrics.MemoryUsage, "")
			if isSelfHealingEnabled {
				log.Printf("✅ Gateway port %d is listening (openclaw health skipped). Updating configuration backup... (CPU: %.1f%%, Mem: %.1f%%)",
					g.config.HealthPort, metrics.CPUUsage, metrics.MemoryUsage)
				g.backupConfig()
			} else {
				log.Printf("✅ Gateway port %d is listening (openclaw health skipped). [自愈流程已跳过] (CPU: %.1f%%, Mem: %.1f%%)",
					g.config.HealthPort, metrics.CPUUsage, metrics.MemoryUsage)
			}
			return
		}

		if i < g.config.MaxRetries {
			// [优化] 阶梯式递增重试: 1st: 3s, 2nd: 10s, 3rd: 30s
			waits := []int{3, 10, 30}
			waitSec := 2 // 默认兜底
			if i-1 < len(waits) {
				waitSec = waits[i-1]
			}
			// 引入 0-2000ms 的随机抖动 (Jitter)，防止惊群效应
			jitter := time.Duration(rand.Intn(2001)) * time.Millisecond
			totalWait := time.Duration(waitSec)*time.Second + jitter

			log.Printf("⚠️ Check failed (attempt %d/%d): %v. Retrying in %v...", i, g.config.MaxRetries, lastErr, totalWait)
			metrics := process.GetSystemMetrics()
			g.recordHealthCheck("Degraded", 0, metrics.CPUUsage, metrics.MemoryUsage, lastErr.Error())
			time.Sleep(totalWait)
		}
	}

	// If we reach here, all retries failed
	log.Printf("🚨 All %d checks failed. Last error: %v", g.config.MaxRetries, lastErr)
	metrics := process.GetSystemMetrics()
	g.recordHealthCheck("Down", 0, metrics.CPUUsage, metrics.MemoryUsage, lastErr.Error())
	
	// Only trigger healing if switch is enabled
	if isSelfHealingEnabled {
		// [加固] 优先级检测：如果用户任务队列中有 gateway 相关的任务 (排队中或执行中)，自愈彻底跳过
		if scheduler.GetScheduler().IsModuleBusy("gateway") {
			log.Printf("⚠️  [自愈服务] 检测到用户队列中有活跃或排队中的网关控制任务，系统将彻底跳过自愈，由用户手动完成恢复。")
			utils.RecordSystemEvent("WARN", "检测到用户网关操作排队中，自愈逻辑已主动跳过")
			return
		}

		// [加固] 升级/维护避让：openclaw-update、openclaw-doctor、npm/pnpm/yarn 安装 openclaw 等均视为安装中，跳过自愈
		if process.IsOpenClawUpgradeOrInstallBusy() {
			log.Printf("⚠️  [自愈服务] 检测到系统正在升级或维护（openclaw-update / openclaw-doctor / 包管理器安装 openclaw 等），为避免与安装流程冲突，自愈逻辑已主动跳过。")
			utils.RecordSystemEvent("WARN", "检测到系统正在升级、doctor 或依赖安装中，自愈逻辑已主动跳过")
			return
		}

		log.Printf("🛠️ Initiating self-healing process.")
		g.heal(reason)
	} else {
		log.Printf("ℹ️ [自愈服务] 当前开关已关闭，忽略本次自愈服务流程。")
	}
}

func (g *Guardian) recordHealthCheck(status string, responseTime int, cpuUsage, memUsage float64, errorMsg string) {
	if utils.DB == nil {
		return
	}
	_, err := utils.DB.Exec(`
		INSERT INTO health_checks (status, response_time_ms, cpu_usage, mem_usage, error_msg)
		VALUES (?, ?, ?, ?, ?)
	`, status, responseTime, cpuUsage, memUsage, errorMsg)
	if err != nil {
		log.Printf("❌ Failed to record health check to DB: %v", err)
	}
}

func (g *Guardian) backupConfig() {
	configPath := filepath.Join(g.config.OpenClawConfigDir, "openclaw.json")

	// 1. 在备份前执行深层配置校验 (Prevent backing up broken config)
	isValid, problem, _ := process.CheckConfig(g.config.OpenClawConfigDir)
	if !isValid {
		log.Printf("⚠️  配置深度校验未通过，跳过备份以防污染。原因: %s", problem)
		return
	}

	// 2. 计算当前配置的 MD5
	currentMD5, err := calculateMD5(configPath)
	if err != nil {
		log.Printf("⚠️ 无法计算配置文件的 MD5: %v", err)
		return
	}

	// 2. 如果 MD5 没变，跳过备份
	if currentMD5 == g.lastConfigMD5 {
		return
	}

	// 3. 确保备份目录存在
	if err := os.MkdirAll(g.config.BackupDir, 0755); err != nil {
		log.Printf("❌ Failed to create backup directory: %v", err)
		return
	}

	// 4. 创建带时间戳的备份文件
	timestamp := time.Now().Format("20060102-150405")
	timestampBackupPath := filepath.Join(g.config.BackupDir, fmt.Sprintf("openclaw.json.%s.bak", timestamp))
	
	// 5. 同时维护一个最新的固定备份文件 (供自愈逻辑使用)
	latestBackupPath := filepath.Join(g.config.BackupDir, "openclaw.json.bak")

	if err := copyFile(configPath, timestampBackupPath); err != nil {
		log.Printf("❌ Failed to create timestamped backup: %v", err)
		return
	}
	
	// 更新“最新”备份
	_ = copyFile(configPath, latestBackupPath)

	g.lastConfigMD5 = currentMD5
	log.Printf("✅ 配置已变更，新备份已生成: %s (MD5: %s)", filepath.Base(timestampBackupPath), currentMD5)

	// 6. 清理旧备份 (保留最近 5 个)
	g.rotateBackups(5)
}

func (g *Guardian) rotateBackups(keep int) {
	files, err := filepath.Glob(filepath.Join(g.config.BackupDir, "openclaw.json.*.bak"))
	if err != nil {
		return
	}

	if len(files) <= keep {
		return
	}

	// 按名称排序 (时间戳格式保证了名称序即时间序)
	sort.Strings(files)

	// 删除较旧的文件
	for i := 0; i < len(files)-keep; i++ {
		if err := os.Remove(files[i]); err == nil {
			log.Printf("🧹 已自动清理旧备份文件: %s", filepath.Base(files[i]))
		}
	}
}

func calculateMD5(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", err
	}
	defer file.Close()

	hash := md5.New()
	if _, err := io.Copy(hash, file); err != nil {
		return "", err
	}

	return hex.EncodeToString(hash.Sum(nil)), nil
}

func (g *Guardian) heal(reason string) {
	log.Printf("🛠️ Initiating self-healing process for reason: %s", reason)

	hostname, _ := os.Hostname()
	statusBefore := process.GetGatewayStatus()
	utils.RecordSystemEvent("HEAL", fmt.Sprintf("检测到服务宕机 (%s)，启动自愈程序", reason))
	g.notifyFeishu(context.Background(), "⚠️ 小龙虾故障报警", fmt.Sprintf("节点: %s\n状态: ⚠️ 检测到服务宕机\n原因: %s\n正在尝试自愈...\n\n---\n**当前状态详情:**\n%s", hostname, reason, statusBefore))

	configPath := filepath.Join(g.config.OpenClawConfigDir, "openclaw.json")
	ourBackupPath := filepath.Join(g.config.BackupDir, "openclaw.json.bak")
	errorPath := filepath.Join(g.config.OpenClawConfigDir, "openclaw.json.err")

	// 1. Backup current broken config (Save for troubleshooting)
	_ = copyFile(configPath, errorPath)

	// 2. Generate Report (Comparing current config with our validated backup)
	reportPath, err := analyzer.GenerateReport(g.config.ReportDir, g.config.OpenClawConfigDir, configPath, ourBackupPath)
	reportMsg := ""
	if err == nil {
		reportMsg = fmt.Sprintf("\n- **诊断报表**: %s", reportPath)
	}

	// 3. Rollback
	log.Printf("🔄 Attempting to recover service...")
	recovered := false
	recoveryMethodUsed := ""

	// --- 优先尝试从监控生成的、经过校验的备份恢复 ---
	if _, err := os.Stat(ourBackupPath); err == nil {
		if err := copyFile(ourBackupPath, configPath); err == nil {
			recovered = true
			recoveryMethodUsed = "配置回滚 (来自监控校验备份)"
		}
	}

	// --- 如果没有校验备份，则尝试使用官方 Doctor 修复环境 ---
	if !recovered {
		log.Printf("⚠️  未找到校验备份，尝试使用 openclaw doctor --fix 修复...")
		if err := process.RunDoctorFix(); err == nil {
			recovered = true
			recoveryMethodUsed = "Doctor 自动修复"
		}
	}

	// 4. Restart
	_ = process.ForceStartGateway()
	// 闭环验收：等待健康端口监听即视为 Success（与巡检一致，不调用 openclaw health）
	ok := false
	var lastHealthErr error
	backoffs := []time.Duration{1 * time.Second, 2 * time.Second, 3 * time.Second, 5 * time.Second, 8 * time.Second}
	verifyStart := time.Now()
	verifyAttempts := 0
	for i, d := range backoffs {
		time.Sleep(d)
		verifyAttempts = i + 1
		// 仅验收端口是否在监听
		if !process.IsPortListening("", g.config.HealthPort) {
			lastHealthErr = fmt.Errorf("port %d is not listening", g.config.HealthPort)
			log.Printf("⏳ [HEAL] 网关端口仍未监听，继续等待... (%d/%d)", i+1, len(backoffs))
			continue
		}
		// 与巡检一致：端口通即验收通过，不调用 openclaw health
		ok = true
		lastHealthErr = nil
		break
	}
	verifyDurationMs := time.Since(verifyStart).Milliseconds()

	statusAfter := process.GetGatewayStatus()
	if !recovered {
		recoveryMethodUsed = "强行重启 (未执行配置恢复)"
	}

	if ok {
		g.notifyFeishu(context.Background(), "✅ 小龙虾自愈成功", fmt.Sprintf("节点: %s\n状态: ✅ 已自动恢复上线\n操作: %s 并强行重启%s\n\n---\n**恢复后状态详情:**\n%s", hostname, recoveryMethodUsed, reportMsg, statusAfter))
		g.recordHealEvent(reason, recoveryMethodUsed, "Success", reportPath, verifyAttempts, verifyDurationMs, "")
	} else {
		errText := "unknown"
		if lastHealthErr != nil {
			errText = lastHealthErr.Error()
		}
		utils.RecordSystemEvent("ERROR", fmt.Sprintf("自愈验收失败: %s", errText))
		g.notifyFeishu(context.Background(), "❌ 小龙虾自愈失败", fmt.Sprintf("节点: %s\n状态: ❌ 自愈动作已执行，但验收未通过\n原因: %s\n操作: %s%s\n错误: %s\n\n---\n**当前状态详情:**\n%s", hostname, reason, recoveryMethodUsed, reportMsg, errText, statusAfter))
		g.recordHealEvent(reason, recoveryMethodUsed, "Failed", reportPath, verifyAttempts, verifyDurationMs, errText)
	}

	log.Printf("🔄 Returning to monitoring loop...")
}

func (g *Guardian) recordHealEvent(reason, method, result, reportPath string, verifyRetries int, verifyDurationMs int64, verifyError string) {
	if utils.DB == nil {
		return
	}
	_, err := utils.DB.Exec(`
		INSERT INTO heal_events (reason, method, result, report_path, verify_retries, verify_duration_ms, verify_error)
		VALUES (?, ?, ?, ?, ?, ?, ?)
	`, reason, method, result, reportPath, verifyRetries, verifyDurationMs, verifyError)
	if err != nil {
		log.Printf("❌ Failed to record heal event to DB: %v", err)
	}
}

func (g *Guardian) notifyFeishu(ctx context.Context, title, text string) {
	if g.feishu != nil && g.config.FeishuChatID != "" {
		go func() {
			if err := g.feishu.SendInteractiveCard(ctx, g.config.FeishuChatID, title, text); err != nil {
				log.Printf("❌ Failed to send Feishu notification: %v", err)
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

func (g *Guardian) CheckVersionUpdate() {
	url := "https://ghproxy.net/https://raw.githubusercontent.com/RandyChen1985/openclaw-buddy/main/VERSION"
	client := http.Client{
		Timeout: 10 * time.Second,
	}

	resp, err := client.Get(url)
	if err != nil {
		log.Printf("⚠️ [Update] 检查更新失败 (网络错误): %v", err)
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		log.Printf("⚠️ [Update] 检查更新失败 (HTTP %d)", resp.StatusCode)
		return
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		log.Printf("⚠️ [Update] 读取版本响应失败: %v", err)
		return
	}

	latestVersion := strings.TrimPrefix(strings.TrimSpace(string(body)), "v")
	if latestVersion == "" {
		return
	}

	// 存储到本地数据库
	if err := utils.SetSetting("latest_version", latestVersion); err != nil {
		log.Printf("❌ [Update] 存储最新版本号失败: %v", err)
	} else {
		// 记录系统事件，方便在 UI 时间轴看到
		utils.RecordSystemEvent("UPDATE", fmt.Sprintf("同步远程版本库成功: %s", latestVersion))
		log.Printf("📡 [Update] 版本对账完成，远程最新版本: %s", latestVersion)
	}
}
