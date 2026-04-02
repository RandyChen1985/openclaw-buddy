## ADDED Requirements

### Requirement: Token 身份验证 (Token Authentication)
系统必须支持基于静态 Token 的身份验证。Token 应从环境变量 `GUARDIAN_TOKEN` 或配置文件中读取。

#### Scenario: 携带有效 Token 访问 API
- **WHEN** 客户端请求 API 并在 `Authorization` 头部携带正确的 `Bearer <token>`
- **THEN** 系统应允许访问并返回 200 OK

#### Scenario: 携带无效 Token 访问 API
- **WHEN** 客户端请求 API 但 Token 错误或缺失
- **THEN** 系统应拒绝访问并返回 401 Unauthorized

#### Scenario: Web 登录页面校验
- **WHEN** 用户首次访问 Web 界面
- **THEN** 系统应重定向至登录页面，提示输入 Token
