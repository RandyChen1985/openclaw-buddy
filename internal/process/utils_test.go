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
