package process

import (
	"regexp"
	"strings"
)

var (
	ansiRegex = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)
	logRegex  = regexp.MustCompile(`^(\d{4}/\d{2}/\d{2} )?\d{2}:\d{2}:\d{2}`)
)

// StripANSI removes ANSI escape codes from a string.
func StripANSI(input string) string {
	return ansiRegex.ReplaceAllString(input, "")
}

// IsLogLine checks if a line looks like a log line (timestamped or containing specific keywords).
func IsLogLine(line string) bool {
	line = strings.TrimSpace(StripANSI(line))
	if line == "" {
		return true
	}
	// Check for timestamp like 20:37:22
	if logRegex.MatchString(line) {
		return true
	}
	// Check for common log markers
	if strings.Contains(line, "[plugins]") || strings.Contains(line, "[oh-my-openclaw]") || strings.HasPrefix(line, "Config warnings") {
		return true
	}
	return false
}

// isAtLineStart checks if the character at index idx is preceded only by whitespace in its line.
func isAtLineStart(s string, idx int) bool {
	if idx < 0 || idx >= len(s) {
		return false
	}
	for i := idx - 1; i >= 0; i-- {
		if s[i] == '\n' {
			return true
		}
		if s[i] != ' ' && s[i] != '\t' && s[i] != '\r' {
			return false
		}
	}
	return true
}

// ExtractJSON finds the first '{' or '[' that looks like the start of a JSON block.
// It prioritizes occurrences at the beginning of a line to avoid being fooled by log tags like [plugins].
// If no line-start occurrence is found, it falls back to prioritizing '{' over '[' for legacy support.
func ExtractJSON(input string) string {
	start := -1
	// 1. Try to find the first '{' or '[' that is at the start of a line
	for i := 0; i < len(input); i++ {
		if input[i] == '{' || input[i] == '[' {
			if isAtLineStart(input, i) {
				start = i
				break
			}
		}
	}

	// 2. Fallback: If no line-start occurrence, use legacy priority: '{' first
	if start == -1 {
		startBrace := strings.Index(input, "{")
		startBracket := strings.Index(input, "[")
		if startBrace != -1 {
			start = startBrace
		} else {
			start = startBracket
		}
	}

	if start == -1 {
		return input
	}

	var end int
	if input[start] == '{' {
		end = strings.LastIndex(input, "}")
	} else {
		end = strings.LastIndex(input, "]")
	}

	if end == -1 || end < start {
		return input[start:]
	}

	return input[start : end+1]
}
