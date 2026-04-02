package utils

import (
	"fmt"
	"os"
	"time"
)

type FileLock struct {
	path string
	file *os.File
}

var GlobalLock *FileLock

func NewFileLock(path string) *FileLock {
	GlobalLock = &FileLock{
		path: path,
	}
	return GlobalLock
}

func (l *FileLock) Lock() error {
	var f *os.File
	var err error
	
	// 增加重试逻辑，支持自重启时的锁平滑接管 (最多等待 5 秒)
	for i := 0; i < 10; i++ {
		f, err = os.OpenFile(l.path, os.O_RDWR|os.O_CREATE, 0666)
		if err == nil {
			if err = s_lockFile(f); err == nil {
				break
			}
			f.Close()
		}
		time.Sleep(500 * time.Millisecond)
	}

	if err != nil {
		return fmt.Errorf("failed to acquire lock after retries: %v. %s", err, l.path)
	}
	
	l.file = f

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
