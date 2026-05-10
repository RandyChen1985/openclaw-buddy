package api

import (
	"net/http"
	"strings"

	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

// resolveBearerPrincipal 把一个 Bearer token 解析为认证主体；
// 优先匹配 BUDDY_TOKEN（superadmin），其次查 user_sessions。
func resolveBearerPrincipal(rawToken, superToken string) *Principal {
	rawToken = strings.TrimSpace(rawToken)
	if rawToken == "" {
		return nil
	}
	if superToken != "" && rawToken == superToken {
		return &Principal{IsSuperAdmin: true}
	}
	user, err := utils.LookupSession(rawToken)
	if err != nil || user == nil {
		return nil
	}
	perms, _ := utils.GetUserPermissionKeys(user.ID)
	return &Principal{User: user, Permissions: perms}
}

func AuthMiddleware(token string, tickets *TicketStore) gin.HandlerFunc {
	return func(c *gin.Context) {
		var principal *Principal

		hasHeaderAuth := false
		hasQueryAuth := false
		hasTicketAuth := false
		hasCookieAuth := false

		// 1. Authorization Header（同时支持 BUDDY_TOKEN 与 session token）
		authHeader := c.GetHeader("Authorization")
		if authHeader != "" {
			parts := strings.Split(authHeader, " ")
			if len(parts) == 2 && parts[0] == "Bearer" {
				if p := resolveBearerPrincipal(parts[1], token); p != nil {
					principal = p
					hasHeaderAuth = true
				}
			}
		}

		// 2. Query 参数 token（兼容老用法 / WS）
		if principal == nil {
			queryToken := strings.TrimSpace(c.Query("token"))
			if queryToken != "" {
				if p := resolveBearerPrincipal(queryToken, token); p != nil {
					principal = p
					hasQueryAuth = true
				}
			}
		}

		// 3. 一次性 ticket（仅用于 WS / 显式短期授权，继承签发时的主体权限）
		if principal == nil && tickets != nil {
			queryTicket := strings.TrimSpace(c.Query("ticket"))
			if queryTicket != "" {
				if p, ok := tickets.Consume(queryTicket); ok {
					principal = p
				}
				hasTicketAuth = true
			}
		}

		// 4. Cookie（同时支持 BUDDY_TOKEN 与 session token）
		if principal == nil {
			cookieToken, err := c.Cookie("guardian_token")
			if err == nil && cookieToken != "" {
				if p := resolveBearerPrincipal(cookieToken, token); p != nil {
					principal = p
					hasCookieAuth = true
				}
			}
		}

		if principal == nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized: Invalid or missing token"})
			c.Abort()
			return
		}

		// CSRF 防护：仅依赖 Cookie 时禁止写操作（保留原有策略）
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

		SetPrincipal(c, principal)
		c.Next()
	}
}

// RequireAnyPermission 用于路由级权限校验，任一权限满足即可，superadmin 直通。
// 传空权限列表时退化为“仅需已认证”。
func RequireAnyPermission(keys ...string) gin.HandlerFunc {
	return func(c *gin.Context) {
		p := GetPrincipal(c)
		if p == nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			c.Abort()
			return
		}
		if len(keys) == 0 {
			c.Next()
			return
		}
		for _, key := range keys {
			if p.HasPermission(key) {
				c.Next()
				return
			}
		}
		c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden: missing permission"})
		c.Abort()
	}
}

// RequirePermission 用于路由级权限校验，superadmin 直通；
// 仅在 AuthMiddleware 之后挂载有效。
func RequirePermission(key string) gin.HandlerFunc {
	return func(c *gin.Context) {
		p := GetPrincipal(c)
		if p == nil {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized"})
			c.Abort()
			return
		}
		if !p.HasPermission(key) {
			c.JSON(http.StatusForbidden, gin.H{"error": "Forbidden: missing permission " + key})
			c.Abort()
			return
		}
		c.Next()
	}
}
