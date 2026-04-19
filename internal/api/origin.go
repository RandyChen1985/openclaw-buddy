package api

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

func parseOrigin(origin string) (*url.URL, bool) {
	u, err := url.Parse(origin)
	if err != nil || u == nil || u.Scheme == "" || u.Host == "" {
		return nil, false
	}
	return u, true
}

func splitCSV(s string) []string {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	parts := strings.Split(s, ",")
	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p != "" {
			out = append(out, p)
		}
	}
	return out
}

// isOriginAllowed implements a conservative allowlist strategy:
// - Always allow empty Origin (non-browser clients).
// - Always allow same-host Origin (by Host header).
// - Allow localhost/127.0.0.1 origins for the configured web port.
// - Allow explicitly configured origins via cfg.CORSAllowOrigins (CSV).
func (s *Server) isOriginAllowed(r *http.Request, origin string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return true
	}
	ol := strings.ToLower(origin)
	if strings.HasPrefix(ol, "wails://") || strings.Contains(ol, "wails.localhost") {
		return true
	}
	u, ok := parseOrigin(origin)
	if !ok {
		return false
	}

	// Same-host allow
	reqHost := strings.TrimSpace(r.Host)
	if reqHost != "" && strings.EqualFold(u.Host, reqHost) {
		return true
	}

	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if host == "localhost" || host == "127.0.0.1" {
		if port == "" {
			// default port is only safe if we're also on default; be conservative
			return false
		}
		if p, err := strconv.Atoi(port); err == nil && p == s.cfg.WebPort {
			return true
		}
	}

	// Explicit allowlist
	for _, allowed := range splitCSV(s.cfg.CORSAllowOrigins) {
		if strings.EqualFold(allowed, origin) {
			return true
		}
	}
	return false
}
