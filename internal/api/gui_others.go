//go:build !windows

package api

import "fmt"

func (s *Server) RunGUI() error {
	return fmt.Errorf("GUI is not supported on this platform")
}
