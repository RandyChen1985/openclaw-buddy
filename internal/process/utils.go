package process

import (
	"regexp"
	"strings"
)

var (
	ansiRegex = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)
	logRegex  = regexp.MustCompile(`^\d{2}:\d{2}:\d{2}`)
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
	if strings.Contains(line, "[plugins]") || strings.Contains(line, "[oh-my-openclaw]") {
		return true
	}
	return false
}

// ExtractJSON finds the first '{' and last '}' and returns the substring between them.
// This is useful for parsing JSON from CLI output that might contain leading or trailing logs.
func ExtractJSON(input string) string {
	start := strings.Index(input, "{")
	if start == -1 {
		// Also try array start if object start not found
		start = strings.Index(input, "[")
		if start == -1 {
			return input
		}
	}
	
	// Find last matching brace/bracket
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
