package process

import (
	"bufio"
	"strings"
	"testing"
)

func TestStripANSI(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"\x1b[35m[plugins]\x1b[39m", "[plugins]"},
		{"\x1b[35m20:37:22+08:00\x1b[39m", "20:37:22+08:00"},
		{"normal text", "normal text"},
	}

	for _, test := range tests {
		result := StripANSI(test.input)
		if result != test.expected {
			t.Errorf("StripANSI(%q) = %q; expected %q", test.input, result, test.expected)
		}
	}
}

func TestIsLogLine(t *testing.T) {
	tests := []struct {
		input    string
		expected bool
	}{
		{"20:37:22+08:00 [plugins] [oh-my-openclaw]", true},
		{"\x1b[35m20:37:22+08:00\x1b[39m [plugins]", true},
		{"Model Input Ctx", false},
		{"bailian/qwen3.5-plus text+image 977k", false},
		{"", true},
		{"   ", true},
	}

	for _, test := range tests {
		result := IsLogLine(test.input)
		if result != test.expected {
			t.Errorf("IsLogLine(%q) = %v; expected %v", test.input, result, test.expected)
		}
	}
}

func TestParseModelsOutput(t *testing.T) {
	mockOutput := `20:37:22+08:00 [plugins] [oh-my-openclaw] Persona command registered (/omoc)
Model                                      Input      Ctx      Local Auth  Tags
bailian/qwen3.5-plus                       text+image 977k     no    yes   default,configured
yovole/glm-5                               text       200k     no    yes   fallback#1,configured
20:37:22+08:00 [plugins] [oh-my-openclaw] Initializing plugin v0.21.3
`
	scanner := bufio.NewScanner(strings.NewReader(mockOutput))
	isTableStarted := false
	var models []OpenClawModel

	for scanner.Scan() {
		line := scanner.Text()
		if IsLogLine(line) {
			continue
		}
		trimmedLine := strings.TrimSpace(StripANSI(line))

		if strings.HasPrefix(trimmedLine, "Model") && strings.Contains(trimmedLine, "Ctx") {
			isTableStarted = true
			continue
		}

		if isTableStarted && trimmedLine != "" && !strings.Contains(trimmedLine, "OpenClaw") {
			fields := strings.Fields(trimmedLine)
			if len(fields) >= 3 {
				modelID := fields[0]
				tags := ""
				if len(fields) >= 5 {
					tags = fields[len(fields)-1]
				}
				models = append(models, OpenClawModel{
					ID:       modelID,
					Name:     modelID,
					Provider: tags,
				})
			}
		}
	}

	if len(models) != 2 {
		t.Errorf("Expected 2 models, got %d", len(models))
	}
	if models[0].ID != "bailian/qwen3.5-plus" {
		t.Errorf("Expected model[0].ID to be 'bailian/qwen3.5-plus', got %q", models[0].ID)
	}
}
