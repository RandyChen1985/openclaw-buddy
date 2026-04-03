package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func AuthMiddleware(token string, tickets *TicketStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		hasHeaderAuth := false
		hasQueryAuth := false
		hasTicketAuth := false
		hasCookieAuth := false

		// 1. Check Authorization header
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			parts := strings.Split(authHeader, " ")
			if len(parts) == 2 && parts[0] == "Bearer" {
				if strings.TrimSpace(parts[1]) == token {
					hasHeaderAuth = true
				}
			}
		}

		// 2. Check token from query parameter
		queryToken := strings.TrimSpace(c.Query("token"))
		if queryToken == token {
			hasQueryAuth = true
		}

		// 3. Check ticket from query parameter (for WebSockets)
		if tickets != nil {
			queryTicket := strings.TrimSpace(c.Query("ticket"))
			if queryTicket != "" && tickets.Consume(queryTicket) {
				hasTicketAuth = true
			}
		}

		// 4. Check cookie
		cookieToken, err := c.Cookie("guardian_token")
		if err == nil && cookieToken == token {
			hasCookieAuth = true
		}

		// Validation logic
		isAuthorized := hasHeaderAuth || hasQueryAuth || hasTicketAuth || hasCookieAuth
		if !isAuthorized {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized: Invalid or missing token"})
			c.Abort()
			return
		}

		// CSRF Protection: Block write operations that ONLY rely on Cookies
		// (Headers, Query Tokens, and Tickets are explicit and thus safe from silent CSRF)
		if !hasHeaderAuth && !hasQueryAuth && !hasTicketAuth && hasCookieAuth {
			method := c.Request.Method
			if method != http.MethodGet && method != http.MethodHead && method != http.MethodOptions {
				c.JSON(http.StatusForbidden, gin.H{
					"error": "CSRF Protected: Write operations must use Authorization header or explicit token/ticket",
				})
				c.Abort()
				return
			}
		}

		c.Next()
	}
}
