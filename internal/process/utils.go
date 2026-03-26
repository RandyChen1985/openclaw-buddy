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
