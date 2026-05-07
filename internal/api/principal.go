package api

import (
	"openclaw-buddy/internal/utils"

	"github.com/gin-gonic/gin"
)

// principalContextKey 用于在 gin.Context 中传递认证主体。
const principalContextKey = "auth_principal"

// Principal 表示当前请求的认证主体。
//   - IsSuperAdmin=true 时来自 BUDDY_TOKEN，拥有全部权限；
//   - 否则来自 user_sessions，对应一个具体的用户。
type Principal struct {
	IsSuperAdmin bool
	User         *utils.User
	Permissions  []string
}

// HasPermission superadmin 永远返回 true，其他用户根据角色权限集合判断。
func (p *Principal) HasPermission(key string) bool {
	if p == nil {
		return false
	}
	if p.IsSuperAdmin {
		return true
	}
	for _, k := range p.Permissions {
		if k == key {
			return true
		}
	}
	return false
}

// SetPrincipal 将主体写入 gin.Context。
func SetPrincipal(c *gin.Context, p *Principal) {
	c.Set(principalContextKey, p)
}

// GetPrincipal 从 gin.Context 中取出主体；若没有则返回 nil。
func GetPrincipal(c *gin.Context) *Principal {
	v, ok := c.Get(principalContextKey)
	if !ok {
		return nil
	}
	if p, ok := v.(*Principal); ok {
		return p
	}
	return nil
}
