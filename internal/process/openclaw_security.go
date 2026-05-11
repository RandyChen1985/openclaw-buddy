package process

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

type OpenClawPolicyValue struct {
	Requested       string `json:"requested"`
	RequestedSource string `json:"requestedSource"`
	Host            string `json:"host,omitempty"`
	HostSource      string `json:"hostSource,omitempty"`
	Effective       string `json:"effective"`
	Note            string `json:"note,omitempty"`
}

type OpenClawPolicyScope struct {
	ScopeLabel    string               `json:"scopeLabel"`
	ConfigPath    string               `json:"configPath"`
	AgentID       string               `json:"agentId,omitempty"`
	Security      OpenClawPolicyValue  `json:"security"`
	Ask           OpenClawPolicyValue  `json:"ask"`
	AskFallback   *OpenClawPolicyValue `json:"askFallback,omitempty"`
	RuntimeSource string               `json:"runtimeApprovalsSource,omitempty"`
}

type OpenClawExecPolicyResponse struct {
	ConfigPath      string `json:"configPath"`
	ApprovalsPath   string `json:"approvalsPath"`
	ApprovalsExists bool   `json:"approvalsExists"`
	EffectivePolicy struct {
		Note   string                `json:"note"`
		Scopes []OpenClawPolicyScope `json:"scopes"`
	} `json:"effectivePolicy"`
}

type OpenClawApprovalsSnapshot struct {
	Path            string `json:"path"`
	Exists          bool   `json:"exists"`
	EffectivePolicy struct {
		Scopes []OpenClawPolicyScope `json:"scopes"`
	} `json:"effectivePolicy"`
	File struct {
		Version int `json:"version"`
		Agents  map[string]struct {
			Allowlist []struct {
				Pattern    string `json:"pattern"`
				LastUsedAt int64  `json:"lastUsedAt"`
				ID         string `json:"id"`
			} `json:"allowlist"`
		} `json:"agents"`
	} `json:"file"`
}

type SecurityStatusData struct {
	Policy        *OpenClawExecPolicyResponse `json:"policy"`
	Snapshot      *OpenClawApprovalsSnapshot  `json:"snapshot"`
	VersionTooLow bool                        `json:"versionTooLow"`
}

func ExecPolicyShow() (*OpenClawExecPolicyResponse, error) {
	cmd := exec.Command("openclaw", "exec-policy", "show", "--json")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to show exec policy: %v. Output: %s", err, string(out))
	}

	cleanOut := StripANSI(string(out))
	cleanOut = ExtractJSON(cleanOut)

	var res OpenClawExecPolicyResponse
	decoder := json.NewDecoder(strings.NewReader(cleanOut))
	if err := decoder.Decode(&res); err != nil {
		return nil, fmt.Errorf("failed to unmarshal exec policy: %v", err)
	}

	return &res, nil
}

func GetApprovalsSnapshot() (*OpenClawApprovalsSnapshot, error) {
	cmd := exec.Command("openclaw", "approvals", "get", "--json")
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("failed to get approvals snapshot: %v. Output: %s", err, string(out))
	}

	cleanOut := StripANSI(string(out))
	cleanOut = ExtractJSON(cleanOut)

	var res OpenClawApprovalsSnapshot
	decoder := json.NewDecoder(strings.NewReader(cleanOut))
	if err := decoder.Decode(&res); err != nil {
		return nil, fmt.Errorf("failed to unmarshal approvals snapshot: %v", err)
	}

	return &res, nil
}

func ApplyExecPreset(preset string) error {
	cmd := exec.Command("openclaw", "exec-policy", "preset", preset)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to apply preset %s: %v. Output: %s", preset, err, string(out))
	}
	return nil
}

func SetExecPolicy(ask, security string) error {
	args := []string{"exec-policy", "set"}
	if ask != "" {
		args = append(args, "--ask", ask)
	}
	if security != "" {
		args = append(args, "--security", security)
	}
	cmd := exec.Command("openclaw", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to set exec policy: %v. Output: %s", err, string(out))
	}
	return nil
}

func AddAllowlistPattern(agentID, pattern string) error {
	args := []string{"approvals", "allowlist", "add"}
	if agentID != "" && agentID != "*" {
		args = append(args, "--agent", agentID)
	} else if agentID == "*" {
		args = append(args, "--agent", "*")
	}
	args = append(args, pattern)
	cmd := exec.Command("openclaw", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to add allowlist pattern: %v. Output: %s", err, string(out))
	}
	return nil
}

func RemoveAllowlistPattern(agentID, pattern string) error {
	args := []string{"approvals", "allowlist", "remove"}
	if agentID != "" && agentID != "*" {
		args = append(args, "--agent", agentID)
	} else if agentID == "*" {
		args = append(args, "--agent", "*")
	}
	args = append(args, pattern)
	cmd := exec.Command("openclaw", args...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to remove allowlist pattern: %v. Output: %s", err, string(out))
	}
	return nil
}

func SetApprovals(content string) error {
	// Create a temporary file to hold the JSON content
	tmpFile, err := os.CreateTemp("", "exec-approvals-*.json")
	if err != nil {
		return fmt.Errorf("failed to create temp file: %v", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.WriteString(content); err != nil {
		return fmt.Errorf("failed to write to temp file: %v", err)
	}
	if err := tmpFile.Close(); err != nil {
		return fmt.Errorf("failed to close temp file: %v", err)
	}

	cmd := exec.Command("openclaw", "approvals", "set", tmpFile.Name())
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to set approvals: %v. Output: %s", err, string(out))
	}
	return nil
}

func GetSecurityStatusData() (*SecurityStatusData, error) {
	policy, err := ExecPolicyShow()
	if err != nil {
		// 容错设计：如果 openclaw 版本过低，不支持 exec-policy 命令，则返回特定标志
		if strings.Contains(err.Error(), "unknown command") {
			return &SecurityStatusData{
				Policy:        nil,
				Snapshot:      nil,
				VersionTooLow: true,
			}, nil
		}
		return nil, err
	}

	snapshot, err := GetApprovalsSnapshot()
	if err != nil {
		// 如果获取快照失败（例如 approvals 文件不存在），依然返回 policy
		return &SecurityStatusData{
			Policy:   policy,
			Snapshot: nil,
		}, nil
	}

	return &SecurityStatusData{
		Policy:   policy,
		Snapshot: snapshot,
	}, nil
}
