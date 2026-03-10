package utils

import (
	"fmt"
	"os"
	"syscall"
)

type FileLock struct {
	path string
	file *os.File
}

func NewFileLock(path string) *FileLock {
	return &FileLock{
		path: path,
	}
}

func (l *FileLock) Lock() error {
	f, err := os.OpenFile(l.path, os.O_RDWR|os.O_CREATE, 0666)
	if err != nil {
		return fmt.Errorf("failed to open lock file: %v", err)
	}
	l.file = f

	err = syscall.Flock(int(l.file.Fd()), syscall.LOCK_EX|syscall.LOCK_NB)
	if err != nil {
		if err == syscall.EWOULDBLOCK {
			return fmt.Errorf("guardian is already running (locked by %s)", l.path)
		}
		return fmt.Errorf("failed to lock file: %v", err)
	}

	// Write current PID to the file
	l.file.Truncate(0)
	l.file.Seek(0, 0)
	_, err = fmt.Fprintf(l.file, "%d", os.Getpid())
	if err != nil {
		return fmt.Errorf("failed to write PID to lock file: %v", err)
	}

	return nil
}

func (l *FileLock) Unlock() {
	if l.file != nil {
		syscall.Flock(int(l.file.Fd()), syscall.LOCK_UN)
		l.file.Close()
		os.Remove(l.path)
	}
}
