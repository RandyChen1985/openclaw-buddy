//go:build windows

package utils

import (
	"os"

	"golang.org/x/sys/windows"
)

func s_lockFile(f *os.File) error {
	h := windows.Handle(f.Fd())
	return windows.LockFileEx(h, windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, &windows.Overlapped{})
}

func s_unlockFile(f *os.File) {
	h := windows.Handle(f.Fd())
	_ = windows.UnlockFileEx(h, 0, 1, 0, &windows.Overlapped{})
}
