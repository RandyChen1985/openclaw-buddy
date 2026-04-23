package analyzer

import (
	"path/filepath"
	"testing"
	"time"
	"openclaw-buddy/internal/utils"
)

func TestParseAndSaveLine(t *testing.T) {
	// Initialize a temporary DB for testing
	dbPath := filepath.Join(t.TempDir(), "test_audit.db")
	_, err := utils.InitDB(dbPath, "test-token")
	if err != nil {
		t.Fatalf("Failed to init DB: %v", err)
	}

	testFilePath := "/tmp/agents/test-agent/sessions/session1.jsonl"

	// 1. Test Usage Event
	usageLine := `{"type":"message","timestamp":"2026-04-23T10:00:00Z","message":{"role":"assistant","model":"gpt-4","usage":{"input":100,"output":200},"inboundMetadata":{"channel":"feishu"}}}`
	parseAndSaveLine(testFilePath, usageLine)

	var count int
	utils.DB.QueryRow("SELECT COUNT(*) FROM audit_usage WHERE agent_id = 'test-agent' AND model_id = 'gpt-4'").Scan(&count)
	if count != 1 {
		t.Errorf("Expected 1 usage record, got %d", count)
	}

	// 2. Test Tool Call Event
	toolLine := `{"type":"message","timestamp":"2026-04-23T10:01:00Z","message":{"role":"assistant","content":[{"type":"toolCall","name":"web_search","arguments":{}}]}}`
	parseAndSaveLine(testFilePath, toolLine)

	utils.DB.QueryRow("SELECT COUNT(*) FROM audit_tool_calls WHERE tool_name = 'web_search'").Scan(&count)
	if count != 1 {
		t.Errorf("Expected 1 tool call record, got %d", count)
	}

	// 3. Test Dangerous Command
	cmdLine := `{"type":"message","timestamp":"2026-04-23T10:02:00Z","message":{"role":"assistant","content":[{"type":"toolCall","name":"exec","arguments":{"command":"rm -rf /"}}]}}`
	parseAndSaveLine(testFilePath, cmdLine)

	var risk string
	utils.DB.QueryRow("SELECT risk_level FROM audit_security_events WHERE agent_id = 'test-agent'").Scan(&risk)
	if risk != "high" {
		t.Errorf("Expected high risk for rm -rf, got %s", risk)
	}
}

func TestCleanupAuditData(t *testing.T) {
	// Initialize a temporary DB for testing
	dbPath := filepath.Join(t.TempDir(), "test_cleanup.db")
	_, err := utils.InitDB(dbPath, "test-token")
	if err != nil {
		t.Fatalf("Failed to init DB: %v", err)
	}

	// Insert old data
	oldTs := time.Now().AddDate(0, 0, -10).Format("2006-01-02 15:04:05")
	newTs := time.Now().Format("2006-01-02 15:04:05")

	utils.DB.Exec("INSERT INTO audit_usage (agent_id, timestamp) VALUES (?, ?)", "old", oldTs)
	utils.DB.Exec("INSERT INTO audit_usage (agent_id, timestamp) VALUES (?, ?)", "new", newTs)

	CleanupAuditData()

	var count int
	utils.DB.QueryRow("SELECT COUNT(*) FROM audit_usage").Scan(&count)
	if count != 1 {
		t.Errorf("Expected 1 record after cleanup, got %d", count)
	}
}
