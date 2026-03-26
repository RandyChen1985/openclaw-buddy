package api

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

func AuthMiddleware(token string) gin.HandlerFunc {
	return func(c *gin.Context) {
		// 1. Check Authorization header
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			parts := strings.Split(authHeader, " ")
			if len(parts) == 2 && parts[0] == "Bearer" {
				if parts[1] == token {
					c.Next()
					return
				}
			}
		}

		// 2. Check token from query parameter (optional, for easier testing/specific links)
		queryToken := c.Query("token")
		if queryToken == token {
			c.Next()
			return
		}

		// 3. Check cookie (optional, for web UI)
		cookieToken, err := c.Cookie("guardian_token")
		if err == nil && cookieToken == token {
			c.Next()
			return
		}

		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized: Invalid or missing token"})
		c.Abort()
	}
}
