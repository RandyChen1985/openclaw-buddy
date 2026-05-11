package process

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

type OpenClawCronSchedule struct {
	Expr string `json:"expr"`
	Kind string `json:"kind"`
	TZ   string `json:"tz"`
}

type OpenClawCronPayload struct {
	Kind    string `json:"kind"`
	Message string `json:"message"`
	Model   string `json:"model"`
}

type OpenClawCronDelivery struct {
	Mode    string `json:"mode"`
	To      string `json:"to"`
	Channel string `json:"channel"`
}

type OpenClawCronState struct {
	NextRunAtMs        int64  `json:"nextRunAtMs"`
	LastRunAtMs        int64  `json:"lastRunAtMs"`
	LastRunStatus      string `json:"lastRunStatus"`
	LastStatus         string `json:"lastStatus"`
	LastDurationMs     int64  `json:"lastDurationMs"`
	LastDelivered      bool   `json:"lastDelivered"`
	LastDeliveryStatus string `json:"lastDeliveryStatus"`
	ConsecutiveErrors  int    `json:"consecutiveErrors"`
}

type OpenClawCronJob struct {
	ID            string               `json:"id"`
	AgentID       string               `json:"agentId"`
	SessionKey    string               `json:"sessionKey"`
	Name          string               `json:"name"`
	Enabled       bool                 `json:"enabled"`
	CreatedAtMs   int64                `json:"createdAtMs"`
	UpdatedAtMs   int64                `json:"updatedAtMs"`
	Schedule      OpenClawCronSchedule `json:"schedule"`
	SessionTarget string               `json:"sessionTarget"`
	WakeMode      string               `json:"wakeMode"`
	Payload       OpenClawCronPayload  `json:"payload"`
	Delivery      OpenClawCronDelivery `json:"delivery"`
	State         OpenClawCronState    `json:"state"`
}

type OpenClawCronJobsResponse struct {
	Jobs       []OpenClawCronJob `json:"jobs"`
	Total      int               `json:"total"`
	Offset     int               `json:"offset"`
	Limit      int               `json:"limit"`
	HasMore    bool              `json:"hasMore"`
	NextOffset *int              `json:"nextOffset"`
}

func GetOpenClawCronJobs() (any, error) {
	cmd := exec.Command("openclaw", "cron", "list", "--all", "--json")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to list cron jobs: %v. Output: %s", err, string(out))
	}

	cleanOut := StripANSI(string(out))
	if jsonStr, ok := ExtractFirstJSONValue(cleanOut); ok {
		cleanOut = jsonStr
	} else {
		cleanOut = ExtractJSON(cleanOut) // legacy fallback
	}

	var data OpenClawCronJobsResponse
	decoder := json.NewDecoder(strings.NewReader(cleanOut))
	if err := decoder.Decode(&data); err != nil {
		preview := cleanOut
		if len(preview) > 400 {
			preview = preview[:400] + "...(truncated)"
		}
		return nil, fmt.Errorf("failed to parse cron jobs json: %v. Output: %s", err, preview)
	}

	return data, nil
}

func EnableOpenClawCronJob(id string) error {
	cmd := exec.Command("openclaw", "cron", "enable", id)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to enable cron job %s: %v. Output: %s", id, err, string(out))
	}
	return nil
}

func DisableOpenClawCronJob(id string) error {
	cmd := exec.Command("openclaw", "cron", "disable", id)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to disable cron job %s: %v. Output: %s", id, err, string(out))
	}
	return nil
}

func RemoveOpenClawCronJob(id string) error {
	cmd := exec.Command("openclaw", "cron", "rm", id)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to remove cron job %s: %v. Output: %s", id, err, string(out))
	}
	return nil
}
