package utils

import (
	"fmt"
	"os"
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

	if err := s_lockFile(l.file); err != nil {
		return fmt.Errorf("failed to lock file: %v. %s", err, l.path)
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
		s_unlockFile(l.file)
		l.file.Close()
		os.Remove(l.path)
	}
}
