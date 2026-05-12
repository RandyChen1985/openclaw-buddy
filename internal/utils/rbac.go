package utils

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"
)

// User 系统用户记录
type User struct {
	ID           int64  `json:"id"`
	Username     string `json:"username"`
	RealName     string `json:"real_name"`
	Remark       string `json:"remark"`
	PasswordHash string `json:"-"`
	Status       int    `json:"status"`
	CreatedAt    string `json:"created_at"`
	UpdatedAt    string `json:"updated_at"`
}

// Role 角色定义
type Role struct {
	ID        int64  `json:"id"`
	Key       string `json:"key"`
	Name      string `json:"name"`
	Remark    string `json:"remark"`
	IsBuiltin bool   `json:"is_builtin"`
}

// Permission 权限点定义
type Permission struct {
	ID      int64  `json:"id"`
	Key     string `json:"key"`
	Type    string `json:"type"`
	Name    string `json:"name"`
	MenuKey string `json:"menu_key"`
	Remark  string `json:"remark"`
}

// UserWithRoles 用户列表展示用结构
type UserWithRoles struct {
	User
	RoleKeys    []string `json:"role_keys"`
	HasAPIToken bool     `json:"has_api_token"`
}

// 默认会话有效期（天）
const sessionTokenTTLDays = 7

// HashPassword 用 bcrypt 生成密码散列。
func HashPassword(plain string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(plain), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(h), nil
}

// CheckPassword 校验明文与 bcrypt 散列是否匹配。
func CheckPassword(hash, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(plain)) == nil
}

// GenerateSessionToken 生成随机会话令牌。
func GenerateSessionToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return "sess_" + hex.EncodeToString(b)
}

// GenerateUserAPIToken 生成用户长期访问令牌（与 sess_、环境 BUDDY_TOKEN 区分前缀，避免误匹配）。
func GenerateUserAPIToken() string {
	b := make([]byte, 24)
	_, _ = rand.Read(b)
	return "buddyu_" + hex.EncodeToString(b)
}

func GetUserByUsername(username string) (*User, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	row := DB.QueryRow(
		`SELECT id, username, real_name, remark, password_hash, status, created_at, updated_at FROM users WHERE username = ?`,
		username,
	)
	u := &User{}
	if err := row.Scan(&u.ID, &u.Username, &u.RealName, &u.Remark, &u.PasswordHash, &u.Status, &u.CreatedAt, &u.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return u, nil
}

func GetUserByID(id int64) (*User, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	row := DB.QueryRow(
		`SELECT id, username, real_name, remark, password_hash, status, created_at, updated_at FROM users WHERE id = ?`,
		id,
	)
	u := &User{}
	if err := row.Scan(&u.ID, &u.Username, &u.RealName, &u.Remark, &u.PasswordHash, &u.Status, &u.CreatedAt, &u.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return u, nil
}

// CreateUser 新建用户并赋角色。
func CreateUser(username, realName, remark, password string, roleKeys []string) (*UserWithRoles, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	username = strings.TrimSpace(username)
	if username == "" {
		return nil, fmt.Errorf("用户名不能为空")
	}
	if len(password) < 6 {
		return nil, fmt.Errorf("密码长度至少 6 位")
	}
	if existing, _ := GetUserByUsername(username); existing != nil {
		return nil, fmt.Errorf("用户名已存在")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return nil, err
	}
	res, err := DB.Exec(
		`INSERT INTO users (username, real_name, remark, password_hash, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		username, realName, remark, hash,
	)
	if err != nil {
		return nil, err
	}
	id, _ := res.LastInsertId()
	if err := AssignRolesToUser(id, roleKeys); err != nil {
		return nil, err
	}
	u, err := GetUserByID(id)
	if err != nil || u == nil {
		return nil, err
	}
	keys, _ := GetUserRoleKeys(id)
	return &UserWithRoles{User: *u, RoleKeys: keys}, nil
}

// UpdateUser 更新用户的非凭据字段。
func UpdateUser(id int64, realName, remark string, status int, roleKeys []string) error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	if _, err := DB.Exec(
		`UPDATE users SET real_name = ?, remark = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		realName, remark, status, id,
	); err != nil {
		return err
	}
	return AssignRolesToUser(id, roleKeys)
}

// SetUserPassword 重置密码并撤销其全部会话。
func SetUserPassword(id int64, password string) error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	if len(password) < 6 {
		return fmt.Errorf("密码长度至少 6 位")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	if _, err := DB.Exec(
		`UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
		hash, id,
	); err != nil {
		return err
	}
	_, _ = DB.Exec(`DELETE FROM user_sessions WHERE user_id = ?`, id)
	return nil
}

func DeleteUser(id int64) error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	_, _ = DB.Exec(`DELETE FROM user_roles WHERE user_id = ?`, id)
	_, _ = DB.Exec(`DELETE FROM user_sessions WHERE user_id = ?`, id)
	_, err := DB.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}

// ListUsers 关键字模糊匹配用户列表（按 id 升序）。
func ListUsers(keyword string) ([]UserWithRoles, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	var rows *sql.Rows
	var err error
	base := `SELECT id, username, real_name, remark, status, created_at, updated_at,
		CASE WHEN IFNULL(api_token, '') <> '' THEN 1 ELSE 0 END AS has_api_token FROM users`
	if strings.TrimSpace(keyword) != "" {
		kw := "%" + keyword + "%"
		rows, err = DB.Query(base+` WHERE username LIKE ? OR real_name LIKE ? OR remark LIKE ? ORDER BY id ASC`, kw, kw, kw)
	} else {
		rows, err = DB.Query(base + ` ORDER BY id ASC`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []UserWithRoles{}
	for rows.Next() {
		u := UserWithRoles{}
		var hasTok int
		if err := rows.Scan(&u.ID, &u.Username, &u.RealName, &u.Remark, &u.Status, &u.CreatedAt, &u.UpdatedAt, &hasTok); err != nil {
			return nil, err
		}
		u.HasAPIToken = hasTok == 1
		keys, _ := GetUserRoleKeys(u.ID)
		u.RoleKeys = keys
		out = append(out, u)
	}
	return out, nil
}

// GetUserAPIToken 返回用户当前访问令牌明文（空字符串表示未配置）；仅管理端使用。
func GetUserAPIToken(userID int64) (string, error) {
	if DB == nil {
		return "", fmt.Errorf("database not initialized")
	}
	var tok sql.NullString
	if err := DB.QueryRow(`SELECT api_token FROM users WHERE id = ?`, userID).Scan(&tok); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", nil
		}
		return "", err
	}
	if !tok.Valid {
		return "", nil
	}
	return strings.TrimSpace(tok.String), nil
}

// SetUserAPIToken 覆盖写入用户访问令牌（传空字符串可清除）。
func SetUserAPIToken(userID int64, token string) error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	_, err := DB.Exec(`UPDATE users SET api_token = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`, strings.TrimSpace(token), userID)
	return err
}

// EnsureUserAPIToken 仅在当前无令牌时生成并保存；若已有令牌则返回错误。
func EnsureUserAPIToken(userID int64) (string, error) {
	existing, err := GetUserAPIToken(userID)
	if err != nil {
		return "", err
	}
	if existing != "" {
		return "", fmt.Errorf("该用户已存在访问令牌，请使用复制或重置")
	}
	tok := GenerateUserAPIToken()
	if err := SetUserAPIToken(userID, tok); err != nil {
		return "", err
	}
	return tok, nil
}

// ResetUserAPIToken 重新生成用户访问令牌并返回新值。
func ResetUserAPIToken(userID int64) (string, error) {
	tok := GenerateUserAPIToken()
	if err := SetUserAPIToken(userID, tok); err != nil {
		return "", err
	}
	return tok, nil
}

// GetUserByAPIToken 按访问令牌解析启用中的用户。
func GetUserByAPIToken(token string) (*User, error) {
	token = strings.TrimSpace(token)
	if DB == nil || token == "" {
		return nil, nil
	}
	row := DB.QueryRow(
		`SELECT id, username, real_name, remark, password_hash, status, created_at, updated_at FROM users WHERE api_token = ? AND IFNULL(api_token,'') <> ''`,
		token,
	)
	u := &User{}
	if err := row.Scan(&u.ID, &u.Username, &u.RealName, &u.Remark, &u.PasswordHash, &u.Status, &u.CreatedAt, &u.UpdatedAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if u.Status == 0 {
		return nil, nil
	}
	return u, nil
}

func GetUserRoleKeys(userID int64) ([]string, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	rows, err := DB.Query(
		`SELECT r.key FROM roles r INNER JOIN user_roles ur ON ur.role_id = r.id WHERE ur.user_id = ? ORDER BY r.id ASC`,
		userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []string{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err == nil {
			keys = append(keys, k)
		}
	}
	return keys, nil
}

// GetUserPermissionKeys 返回用户直接绑定的权限 key 列表（去重）。
func GetUserPermissionKeys(userID int64) ([]string, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	// admin 角色默认拥有全部权限（不依赖 user_permissions）
	roleKeys, _ := GetUserRoleKeys(userID)
	for _, rk := range roleKeys {
		if rk == "admin" {
			rows, err := DB.Query(`SELECT key FROM permissions ORDER BY id ASC`)
			if err != nil {
				return nil, err
			}
			defer rows.Close()
			out := []string{}
			for rows.Next() {
				var k string
				if err := rows.Scan(&k); err == nil {
					out = append(out, k)
				}
			}
			return out, nil
		}
	}
	rows, err := DB.Query(`
		SELECT DISTINCT p.key FROM permissions p
		INNER JOIN user_permissions up ON up.permission_id = p.id
		WHERE up.user_id = ?`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []string{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err == nil {
			keys = append(keys, k)
		}
	}
	return keys, nil
}

func ListRoles() ([]Role, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	rows, err := DB.Query(`SELECT id, key, name, remark, is_builtin FROM roles ORDER BY id ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Role{}
	for rows.Next() {
		r := Role{}
		var b int
		if err := rows.Scan(&r.ID, &r.Key, &r.Name, &r.Remark, &b); err == nil {
			r.IsBuiltin = b == 1
			out = append(out, r)
		}
	}
	return out, nil
}

func ListPermissions(permissionType string) ([]Permission, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	var rows *sql.Rows
	var err error
	if strings.TrimSpace(permissionType) != "" {
		rows, err = DB.Query(`SELECT id, key, type, name, menu_key, remark FROM permissions WHERE type = ? ORDER BY id ASC`, permissionType)
	} else {
		rows, err = DB.Query(`SELECT id, key, type, name, menu_key, remark FROM permissions ORDER BY id ASC`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Permission{}
	for rows.Next() {
		p := Permission{}
		if err := rows.Scan(&p.ID, &p.Key, &p.Type, &p.Name, &p.MenuKey, &p.Remark); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, nil
}

func GetRolePermissionKeys(roleID int64) ([]string, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	rows, err := DB.Query(
		`SELECT p.key FROM permissions p INNER JOIN role_permissions rp ON rp.permission_id = p.id WHERE rp.role_id = ? ORDER BY p.id ASC`,
		roleID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	keys := []string{}
	for rows.Next() {
		var k string
		if err := rows.Scan(&k); err == nil {
			keys = append(keys, k)
		}
	}
	return keys, nil
}

// SetRolePermissions 用给定的 permission keys 覆盖角色权限绑定。
func SetRolePermissions(roleID int64, permissionKeys []string) error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	if _, err := DB.Exec(`DELETE FROM role_permissions WHERE role_id = ?`, roleID); err != nil {
		return err
	}
	for _, k := range permissionKeys {
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		var pid int64
		if err := DB.QueryRow(`SELECT id FROM permissions WHERE key = ?`, k).Scan(&pid); err != nil {
			continue
		}
		_, _ = DB.Exec(`INSERT OR IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)`, roleID, pid)
	}
	return nil
}

func GetUserDirectPermissionKeys(userID int64) ([]string, error) {
	// 兼容命名：外部统一用 GetUserPermissionKeys；这里保留做语义分离
	return GetUserPermissionKeys(userID)
}

// SetUserPermissions 用给定的 permission keys 覆盖用户权限绑定。
func SetUserPermissions(userID int64, permissionKeys []string) error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	if _, err := DB.Exec(`DELETE FROM user_permissions WHERE user_id = ?`, userID); err != nil {
		return err
	}
	for _, k := range permissionKeys {
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		var pid int64
		if err := DB.QueryRow(`SELECT id FROM permissions WHERE key = ?`, k).Scan(&pid); err != nil {
			continue
		}
		_, _ = DB.Exec(`INSERT OR IGNORE INTO user_permissions (user_id, permission_id) VALUES (?, ?)`, userID, pid)
	}
	return nil
}

// GetUserBotIDs 返回用户被授权可见的 bot_id 列表。
// 约定：admin/superadmin 不依赖该表做限制；是否放行由上层判断。
func GetUserBotIDs(userID int64) ([]string, error) {
	if DB == nil {
		return nil, fmt.Errorf("database not initialized")
	}
	rows, err := DB.Query(`SELECT bot_id FROM user_bots WHERE user_id = ? ORDER BY bot_id ASC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err == nil {
			id = strings.TrimSpace(id)
			if id != "" {
				out = append(out, id)
			}
		}
	}
	return out, nil
}

// SetUserBots 覆盖更新用户可见的 bot_id 列表。
func SetUserBots(userID int64, botIDs []string) error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	if _, err := DB.Exec(`DELETE FROM user_bots WHERE user_id = ?`, userID); err != nil {
		return err
	}
	for _, id := range botIDs {
		id = strings.TrimSpace(id)
		if id == "" {
			continue
		}
		_, _ = DB.Exec(`INSERT OR IGNORE INTO user_bots (user_id, bot_id) VALUES (?, ?)`, userID, id)
	}
	return nil
}

// AssignRolesToUser 用给定 role key 列表覆盖用户的角色绑定。
func AssignRolesToUser(userID int64, roleKeys []string) error {
	if DB == nil {
		return fmt.Errorf("database not initialized")
	}
	if _, err := DB.Exec(`DELETE FROM user_roles WHERE user_id = ?`, userID); err != nil {
		return err
	}
	if len(roleKeys) == 0 {
		return nil
	}
	for _, k := range roleKeys {
		k = strings.TrimSpace(k)
		if k == "" {
			continue
		}
		var rid int64
		if err := DB.QueryRow(`SELECT id FROM roles WHERE key = ?`, k).Scan(&rid); err != nil {
			continue
		}
		_, _ = DB.Exec(`INSERT OR IGNORE INTO user_roles (user_id, role_id) VALUES (?, ?)`, userID, rid)
	}
	return nil
}

// CreateSession 为用户签发一条新的会话记录。
func CreateSession(userID int64) (string, error) {
	if DB == nil {
		return "", fmt.Errorf("database not initialized")
	}
	token := GenerateSessionToken()
	expires := time.Now().Add(time.Duration(sessionTokenTTLDays) * 24 * time.Hour).Format("2006-01-02 15:04:05")
	if _, err := DB.Exec(
		`INSERT INTO user_sessions (token, user_id, expires_at, created_at, last_seen_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
		token, userID, expires,
	); err != nil {
		return "", err
	}
	return token, nil
}

// LookupSession 根据 token 取回有效用户。失效会话会被清理。
func LookupSession(token string) (*User, error) {
	if DB == nil || strings.TrimSpace(token) == "" {
		return nil, nil
	}
	var userID int64
	var expiresAt sql.NullString
	if err := DB.QueryRow(`SELECT user_id, expires_at FROM user_sessions WHERE token = ?`, token).Scan(&userID, &expiresAt); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	if expiresAt.Valid && expiresAt.String != "" {
		if exp, err := time.Parse("2006-01-02 15:04:05", expiresAt.String); err == nil {
			if time.Now().After(exp) {
				_, _ = DB.Exec(`DELETE FROM user_sessions WHERE token = ?`, token)
				return nil, nil
			}
		}
	}
	_, _ = DB.Exec(`UPDATE user_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE token = ?`, token)
	user, err := GetUserByID(userID)
	if err != nil {
		return nil, err
	}
	if user == nil || user.Status == 0 {
		_, _ = DB.Exec(`DELETE FROM user_sessions WHERE token = ?`, token)
		return nil, nil
	}
	return user, nil
}

func DeleteSession(token string) error {
	if DB == nil {
		return nil
	}
	_, err := DB.Exec(`DELETE FROM user_sessions WHERE token = ?`, token)
	return err
}
