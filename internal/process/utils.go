package process

import (
	"regexp"
)

var ansiRegex = regexp.MustCompile(`\x1b\[[0-9;]*[a-zA-Z]`)

// StripANSI removes ANSI escape codes from a string.
func StripANSI(input string) string {
	return ansiRegex.ReplaceAllString(input, "")
}
