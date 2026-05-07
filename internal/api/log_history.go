package api

import (
	"io"
	"os"
	"strings"
)

// readLastLines reads up to n complete lines from the end of path by scanning at most maxScanBytes from EOF.
// If the file is smaller than maxScanBytes, reads the whole file. Lines may be fewer than n if the file is tiny.
func readLastLines(path string, n int, maxScanBytes int64) ([]string, error) {
	if n <= 0 {
		return nil, nil
	}
	f, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer f.Close()

	st, err := f.Stat()
	if err != nil {
		return nil, err
	}
	size := st.Size()
	if size == 0 {
		return nil, nil
	}

	readSize := maxScanBytes
	if readSize > size {
		readSize = size
	}
	start := size - readSize
	if _, err := f.Seek(start, io.SeekStart); err != nil {
		return nil, err
	}

	buf := make([]byte, readSize)
	if _, err := io.ReadFull(f, buf); err != nil && err != io.ErrUnexpectedEOF {
		return nil, err
	}

	text := string(buf)
	if start > 0 {
		if idx := strings.Index(text, "\n"); idx >= 0 {
			text = text[idx+1:]
		}
	}
	text = strings.TrimSuffix(text, "\n")
	if text == "" {
		return nil, nil
	}
	lines := strings.Split(text, "\n")
	if len(lines) > n {
		lines = lines[len(lines)-n:]
	}
	return lines, nil
}
