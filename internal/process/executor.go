package process

import (
	"bytes"
	"context"
	"io"
	"os"
	"os/exec"
	"time"
)

type CommandResult struct {
	Success    bool   `json:"success"`
	Output     string `json:"output"` // Combined output (legacy)
	Stdout     string `json:"stdout"`
	Stderr     string `json:"stderr"`
	ReturnCode int    `json:"return_code"`
	Error      string `json:"error,omitempty"`
}

// RunCommandWithTimeout executes a command and captures its output with a timeout.
func RunCommandWithTimeout(timeout time.Duration, name string, args ...string) (*CommandResult, error) {
	return RunCommandWithEnvAndTimeout(timeout, nil, name, args...)
}

// RunCommandWithEnvAndTimeout executes a command with custom environment variables and captures its output with a timeout.
func RunCommandWithEnvAndTimeout(timeout time.Duration, env []string, name string, args ...string) (*CommandResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, name, args...)
	if env != nil {
		cmd.Env = append(os.Environ(), env...)
	}
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	stdoutStr := StripANSI(stdout.String())
	stderrStr := StripANSI(stderr.String())
	combinedOutput := stdoutStr + stderrStr

	if ctx.Err() == context.DeadlineExceeded {
		return &CommandResult{
			Success: false,
			Output:  combinedOutput,
			Stdout:  stdoutStr,
			Stderr:  stderrStr,
			Error:   "Command timed out",
		}, nil
	}

	result := &CommandResult{
		Success: err == nil,
		Output:  combinedOutput,
		Stdout:  stdoutStr,
		Stderr:  stderrStr,
	}

	if exitErr, ok := err.(*exec.ExitError); ok {
		result.ReturnCode = exitErr.ExitCode()
	} else if err != nil {
		result.Error = err.Error()
	}

	return result, nil
}

// StreamCommand runs a command and pipes its output to the provided writer.
func StreamCommand(ctx context.Context, w io.Writer, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	
	// Create a writer that strips ANSI codes before writing to the output
	ansiStripper := &ansiStrippingWriter{w: w}
	
	cmd.Stdout = ansiStripper
	cmd.Stderr = ansiStripper

	return cmd.Run()
}

type ansiStrippingWriter struct {
	w io.Writer
}

func (asw *ansiStrippingWriter) Write(p []byte) (n int, err error) {
	stripped := StripANSI(string(p))
	return asw.w.Write([]byte(stripped))
}
