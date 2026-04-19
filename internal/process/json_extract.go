package process

import (
	"bytes"
	"encoding/json"
	"strings"
)

// ExtractFirstJSONValue tries to locate and extract the first complete JSON value (object/array)
// from a mixed output string (e.g. logs + JSON). It is resilient to leading/trailing noise.
//
// It scans for '{' or '[' positions that look like a value start (line-start / whitespace),
// then uses json.Decoder to find the exact end offset.
func ExtractFirstJSONValue(input string) (string, bool) {
	s := strings.TrimSpace(input)
	if s == "" {
		return "", false
	}

	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch != '{' && ch != '[' {
			continue
		}
		// Only consider starts that are at the beginning of a line, or preceded by whitespace.
		if !isAtLineStart(s, i) {
			prev := s[i-1]
			if prev != ' ' && prev != '\t' && prev != '\n' && prev != '\r' {
				continue
			}
		}

		r := bytes.NewReader([]byte(s[i:]))
		dec := json.NewDecoder(r)
		dec.UseNumber()

		var v any
		if err := dec.Decode(&v); err != nil {
			continue
		}

		end := int(dec.InputOffset())
		if end <= 0 || i+end > len(s) {
			continue
		}
		return s[i : i+end], true
	}

	return "", false
}

