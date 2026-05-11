package process

import (
	"encoding/json"
	"fmt"
	"strings"
)

type OpenClawSession struct {
	Key           string `json:"key"`
	AgentID       string `json:"agentId"`
	Model         string `json:"model"`
	Kind          string `json:"kind"`
	AgeMs         int64  `json:"ageMs"`
	InputTokens   int    `json:"inputTokens"`
	OutputTokens  int    `json:"outputTokens"`
	TotalTokens   int    `json:"totalTokens"`
	ContextTokens int    `json:"contextTokens"`
	SessionID     string `json:"sessionId"`
	UpdatedAt     int64  `json:"updatedAt"`
}

func GetOpenClawSessions() ([]OpenClawSession, error) {
	out, err := openclawCombinedLargeStdout(GetOpenClawBinary(), "sessions", "--all-agents", "--json")
	if err != nil {
		return nil, fmt.Errorf("failed to list sessions: %v. Output: %s", err, string(out))
	}

	// 清理 ANSI 颜色代码，防止 JSON 解析失败
	cleanOut := StripANSI(string(out))
	cleanOut = ExtractJSON(cleanOut)

	var data struct {
		Sessions []OpenClawSession `json:"sessions"`
	}
	decoder := json.NewDecoder(strings.NewReader(cleanOut))
	if err := decoder.Decode(&data); err != nil {
		return nil, fmt.Errorf("failed to parse sessions json: %v", err)
	}
	return data.Sessions, nil
}
