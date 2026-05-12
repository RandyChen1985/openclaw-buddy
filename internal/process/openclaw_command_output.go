package process

import (
	"bytes"
	"os"
	"os/exec"
)

// openclawCombinedLargeStdout 将子进程 stdout 写入临时文件再读回，避免管道/流控导致超大 JSON
// 被截断（例如恰好 64KiB 时 unexpected EOF）。顺序与 exec.CombinedOutput 一致：stdout 后接 stderr。
func openclawCombinedLargeStdout(bin string, args ...string) ([]byte, error) {
	tf, err := os.CreateTemp("", "openclaw-stdout-*.txt")
	if err != nil {
		return nil, err
	}
	path := tf.Name()
	defer func() { _ = os.Remove(path) }()

	var stderrBuf bytes.Buffer
	cmd := exec.Command(bin, args...)
	cmd.Stdout = tf
	cmd.Stderr = &stderrBuf

	runErr := cmd.Run()
	if cerr := tf.Close(); cerr != nil && runErr == nil {
		runErr = cerr
	}

	stdoutBytes, readErr := os.ReadFile(path)
	if readErr != nil {
		return nil, readErr
	}
	out := append(stdoutBytes, stderrBuf.Bytes()...)
	if runErr != nil {
		return out, runErr
	}
	return out, nil
}
