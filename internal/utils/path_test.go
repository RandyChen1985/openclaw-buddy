package utils

import (
	"path/filepath"
	"testing"
)

func TestExpandPath_tildeSlash(t *testing.T) {
	fake := t.TempDir()
	t.Setenv("HOME", fake)
	got := ExpandPath("~/my-openclaw")
	want := filepath.Join(fake, "my-openclaw")
	if got != want {
		t.Fatalf("ExpandPath(~/my-openclaw)=%q want %q", got, want)
	}
}

func TestExpandPath_tildeOnly(t *testing.T) {
	fake := t.TempDir()
	t.Setenv("HOME", fake)
	if got := ExpandPath("~"); got != fake {
		t.Fatalf("got %q want %q", got, fake)
	}
}

func TestExpandPath_noTilde(t *testing.T) {
	abs := filepath.Join(t.TempDir(), "noclob")
	if got := ExpandPath(abs); got != abs {
		t.Fatalf("got %q want %q", got, abs)
	}
}
