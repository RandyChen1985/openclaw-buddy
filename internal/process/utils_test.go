package process

import (
	"testing"
)

func TestExtractJSON(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		expected string
	}{
		{
			name:     "Pure JSON",
			input:    `{"a": 1}`,
			expected: `{"a": 1}`,
		},
		{
			name:     "Leading junk",
			input:    `Warning: some log here... {"a": 1}`,
			expected: `{"a": 1}`,
		},
		{
			name:     "Trailing junk",
			input:    `{"a": 1} - End of output`,
			expected: `{"a": 1}`,
		},
		{
			name:     "Leading and trailing junk",
			input:    `2026/04/14 17:07:36 [Usage] Log: {"a": 1} more junk starting with C`,
			expected: `{"a": 1}`,
		},
		{
			name:     "Array JSON",
			input:    `Some logs [1, 2, 3] trail`,
			expected: `[1, 2, 3]`,
		},
		{
			name:     "Empty",
			input:    ``,
			expected: ``,
		},
		{
			name:     "No braces",
			input:    `plain text`,
			expected: `plain text`,
		},
		{
			name: "JSON followed by junk containing extra braces",
			input: `notice line
{"skills":[]}
footer with stray } characters }}}`,
			expected: `{"skills":[]}`,
		},
		{
			name: "Nested skills payload",
			input: `logs…
{"skills":[{"name":"a","meta":{"x":1}}]}
done`,
			expected: `{"skills":[{"name":"a","meta":{"x":1}}]}`,
		},
		{
			name: "OpenClaw Warnings and Logs",
			input: `Config warnings:
- plugins.entries.active-memory: plugin disabled (disabled in config) but config is present
- plugins.entries.oh-my-openclaw: plugin disabled (disabled in config) but config is present
21:11:19 [plugins] plugins.allow is empty; discovered non-bundled plugins may auto-load: oh-my-openclaw (/root/.openclaw/extensions/oh-my-openclaw/dist/index.js), openclaw-weixin (/root/.openclaw/extensions/openclaw-weixin/index.ts). Set plugins.allow to explicit trusted ids.
[
  {
    "id": "main",
    "name": "bot-云枢智维"
  }
]`,
			expected: `[
  {
    "id": "main",
    "name": "bot-云枢智维"
  }
]`,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ExtractJSON(tt.input)
			if got != tt.expected {
				t.Errorf("ExtractJSON() = %v, want %v", got, tt.expected)
			}
		})
	}
}
