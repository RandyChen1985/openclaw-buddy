package api

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadLastLines(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "t.log")
	content := "a\nb\nc\nd\ne\n"
	if err := os.WriteFile(p, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	lines, err := readLastLines(p, 2, 1024)
	if err != nil {
		t.Fatal(err)
	}
	if len(lines) != 2 || lines[0] != "d" || lines[1] != "e" {
		t.Fatalf("got %#v", lines)
	}
	lines, err = readLastLines(p, 0, 1024)
	if err != nil || lines != nil {
		t.Fatalf("n=0: got %#v err %v", lines, err)
	}
}
