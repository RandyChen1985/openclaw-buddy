package process

import (
	"bytes"
	"context"
	"io"
	"os/exec"
	"time"
)

type CommandResult struct {
	Success    bool   `json:"success"`
	Output     string `json:"output"`
	ReturnCode int    `json:"return_code"`
	Error      string `json:"error,omitempty"`
}

// RunCommandWithTimeout executes a command and captures its output with a timeout.
func RunCommandWithTimeout(timeout time.Duration, name string, args ...string) (*CommandResult, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, name, args...)
	PrepareSilentCommand(cmd)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	err := cmd.Run()
	output := StripANSI(stdout.String() + stderr.String())

	if ctx.Err() == context.DeadlineExceeded {
		return &CommandResult{
			Success: false,
			Output:  output,
			Error:   "Command timed out",
		}, nil
	}

	result := &CommandResult{
		Success: err == nil,
		Output:  output,
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
	PrepareSilentCommand(cmd)
	
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
