# ClawHub 技能商城双模一键热装配系统实现方案

本方案旨在为 OpenClaw Buddy 聊天界面侧栏抽屉（`V3SkillsDrawer`）实现完整的 **ClawHub 技能商城双模一键热装配（ClawHub Hot-Plug）** 功能。该功能让用户可以极速发现商城技能，并在在线或离线环境下智能自适应装配到专属 Bot 工作区或全局路径中，重载后即刻可用。

---

## User Review Required

> [!IMPORTANT]
> - **双模自适应设计**：
>   1. **在线模式**：后端直连 `https://api.clawhub.ai/v1/skills` 获取市场列表；一键安装通过 `POST /skills/install` 由后端异步拉取、解压、校验、物理装配。
>   2. **离线自愈模式**：若后端无外网（隔离环境），后端仍会提供离线缓存/预设的市场技能列表，	但声明 `network_status: "offline"`。
>   3. 此时用户点击装配，前端自动通过**浏览器网桥中转**：由拥有互联网访问权的浏览器静默 `fetch(tarball_url)` 下载二进制 blob，再通过 `POST /skills/upload`（`multipart/form-data`）推送给后端，由后端解压并校验。
>   4. 两种模式下，装配完成后均会触发技能重载，并全局广播 `'openclaw:skills-updated'`，秒级实现 UI 自动同步刷新。

> [!CAUTION]
> - **安全边界防护 (Zero-Trust Path Audit)**：
>   - 在流式解压缩（支持 `.tar.gz` 和 `.zip`）时，为防止**恶意技能包通过目录穿越漏洞（Directory Traversal）入侵系统**，后端必须实施高强度前缀对账：
>   - `VerifySkillPath` 校对：解压释放的每个子文件，其绝对路径必须在已授权的技能根目录（`allowedPrefix`）之下。
>   - 任何越界行为（如路径含 `../`）将直接触发**熔断自愈**：删除所有已解压的临时残留，强行清场并向上抛出 `403 Forbidden`。

---

## Open Questions

无。方案与用户之前的讨论完全对齐，本计划将作为下一步执行的具体依据。

---

## Proposed Changes

### 后端 Business Logic 层 (Backend Business Logic)

#### [NEW] [openclaw_skill_market.go](file:///Users/chenxiaolong/资料/有孚网络/1云枢中台/openclaw-buddy/internal/process/openclaw_skill_market.go)
- 定义商城技能结构体 `MarketSkill`，包含名、描述、Emoji、版本、Tarball地址、作者、评分、依赖环境（bins, env）等元数据。
- 实现 `FetchSkillMarket(configDir string) (string, []MarketSkill, error)`：
  - 发送 GET 请求至 `https://api.clawhub.ai/v1/skills`，超时限制为 8 秒。
  - 若请求成功且连通，返回 `network_status: "online"` 和商城技能列表。
  - 若请求失败（如网络超时/隔离），设 `network_status: "offline"`，并返回精美的预设常用技能列表（供离线网桥模式中转展示）。

#### [MODIFY] [openclaw_skills.go](file:///Users/chenxiaolong/资料/有孚网络/1云枢中台/openclaw-buddy/internal/process/openclaw_skills.go)
- 新增 `InstallSkillFromURL(tarballURL, targetDir, skillName string, taskID string) error`：
  - 流式 HTTP GET 请求拉取 `tarballURL`。
  - 实时更新 Task 进度（从 0% 到 60%）。
  - 调用 `extractArchive` 将流式解压并写入 `filepath.Join(targetDir, skillName)`。
- 新增 `InstallSkillFromReader(r io.Reader, targetDir, skillName string) error`：
  - 处理 `multipart` 文件流上传解压，调用 `extractArchive`。
- 新增私有辅助函数 `extractArchive(r io.Reader, targetDir, skillName string) error`：
  - 支持 `.tar.gz` 与 `.zip` 自动辨识及流式解压。
  - 核心安全防越权：针对解压缩出来的每一项，强行剔除穿越字符并执行 `VerifySkillPath` / 绝对前缀校验（`strings.HasPrefix`）。
  - 若判定非法入侵，自动调用 `os.RemoveAll(filepath.Join(targetDir, skillName))` 物理回滚清场，并熔断报错。

---

### 后端 API 与 路由层 (Backend API & Router)

#### [MODIFY] [skill_handlers.go](file:///Users/chenxiaolong/资料/有孚网络/1云枢中台/openclaw-buddy/internal/api/skill_handlers.go)
- 新增 `getSkillMarket`：
  - 调用 `process.FetchSkillMarket` 获取连通状态与商城技能列表，返回统一 API 包装。
- 新增 `installSkill`：
  - 接收 JSON 参数 `name`, `tarball_url`, `scope`, `bot_id`。
  - 异步 `s.runAsyncTask` 提交到任务队列。
  - 在异步任务中：
    1. 解析并确保合法的安装目标物理根路径 `targetDir`（私有则取 Bot 专属 workspace，全局则取全局公共 skills）。
    2. 物理创建 `targetDir` 目录。
    3. 调用 `process.InstallSkillFromURL`。
    4. 执行完成后，强行触发 `SyncKeySingle("skills", s.cfg.OpenClawConfigDir)` 清除列表缓存，并调用 `ReloadOpenClawSkills()` 重载技能引擎。
- 新增 `uploadSkill`：
  - 处理离线自愈网桥模式。
  - 解析 `multipart/form-data` 获取 `file` 二进制流，以及 `name`, `scope`, `bot_id`。
  - 异步 `s.runAsyncTask` 处理流式解包装配：
    1. 解析获取合法的安装目标路径 `targetDir`。
    2. 调用 `process.InstallSkillFromReader` 安全解压缩。
    3. 重载引擎并同步缓存。

#### [MODIFY] [router.go](file:///Users/chenxiaolong/资料/有孚网络/1云枢中台/openclaw-buddy/internal/api/router.go)
- 在已有 `/skills` 路由区块下注册三个新接口：
  ```go
  oc.GET("/skills/market", RequirePermission(permSkills), s.getSkillMarket)
  oc.POST("/skills/install", RequirePermission(permSkills), s.installSkill)
  oc.POST("/skills/upload", RequirePermission(permSkills), s.uploadSkill)
  ```

---

### 前端 UI 极客交互与 i18n (Frontend UI & i18n)

#### [MODIFY] [V3SkillsDrawer.tsx](file:///Users/chenxiaolong/资料/有孚网络/1云枢中台/openclaw-buddy/web/src/views/chatV3/V3SkillsDrawer.tsx)
- 在 `filterType` 属性类型中，新增 `'market'` (探索市场) 选项。
- 在 `Segmented` 中，末尾追加 `{ label: '🔍 探索市场', value: 'market' }`。
- 新增状态：`marketSkills`, `networkStatus`, `marketLoading`, `installingTasks` (记录每个技能的异步安装任务ID及进度)。
- 当 `filterType === 'market'` 时：
  - 渲染科幻感十足的商城技能卡片（包含推荐度评分、原作者、版本号、Emoji 图标及醒目的“一键装配”按钮）。
  - 支持按技能名/描述进行实时搜索。
  - **极客级 WOW 进度按钮**：
    - 点击一键装配后，按钮进入 Loading，状态渐变流转：`[ ⏳ 校验中 ]` ➔ `[ 📥 下载中 (X%) ]` ➔ `[ 🔒 安全提取中 ]` ➔ `[ 🔄 同步引擎 ]` ➔ `[ ✨ 装配成功 ]`。
    - 颜色采用 HSL 动态渐变（从 Teal 青色渐变至 Indigo 蓝靛色，再到 Purple 极客紫，成功后变为带呼吸动画的 Green 绿色）。
  - **自适应双模切流逻辑**：
    - 若 `networkStatus === "online"`，直接调用 `POST /v1/openclaw/skills/install`，返回 `taskID` 后启动 `setInterval` 轮询 `/v1/tasks/status`，同步更新进度条。
    - 若 `networkStatus === "offline"`，前端静默触发本地网桥：在浏览器中 `fetch(tarball_url)` 将包下载为 `Blob`，接着以 `FormData` 异步 `POST /v1/openclaw/skills/upload` 送达后端，后端解压后自动返回成功。
  - 装配成功后，发送全局广播事件 `'openclaw:skills-updated'`，技能面板即时自动从缓存刷新，商城装配的技能秒级出现在可用技能列表中！

#### [MODIFY] [zh.json](file:///Users/chenxiaolong/资料/有孚网络/1云枢中台/openclaw-buddy/web/src/locales/zh.json) & [en.json](file:///Users/chenxiaolong/资料/有孚网络/1云枢中台/openclaw-buddy/web/src/locales/en.json)
- 追加所需的国际化 Key，包括：
  - 商城、探索市场、环境检测、在线模式、离线网桥模式、校验中、下载中、提取中、引擎重载、同步成功、装配成功、防目录穿越熔断错误等友好翻译。

---

### 自动化测试清单同步 (Tests Checklist)

#### [MODIFY] [CHECKLIST.md](file:///Users/chenxiaolong/资料/有孚网络/1云枢中台/openclaw-buddy/tests/CHECKLIST.md)
- 在技能与插件同步（`## 12. 技能与插件管理同步`）下方，追加“ClawHub 一键热装配与商城拉取”相关的测试用例，涵盖在线 API 代理拉取、离线网桥中转上传、目录穿越安全熔断、异步任务进度条回写以及 UI 事件同步刷新。

---

## Verification Plan

### 自动化构建与测试
1. 在终端前台运行 `./dev.sh`，验证前后端 TS/Go 能够 0 Error 编译通过。
2. 观察隔离目录 `temp-dev-test/` 自动重建，以及服务在此环境下顺利拉起。
3. （在用户指示下）可运行 `./tests/run_tests.sh` 确保系统原有核心功能无任何 Regression。

### 手动验收路径 (在线与离线双重对账)
1. **在线模式测试**：
   - 打开 V3SkillsDrawer 右侧抽屉，点击右上角 “🔍 探索市场”。
   - 验证成功拉取商城技能列表，顶部提示“在线连接就绪”。
   - 选择 `EchartsPlotter` 技能，点击“一键装配”。
   - 验证一键装配按钮动态色彩渐变（Teal➔Indigo➔Purple➔Green），文字和百分比进度正确轮询推进。
   - 装配成功后，切换回“全部属性”或“私有技能”Tab，验证 `EchartsPlotter` 已直接出现在列表中，无需强刷。
2. **离线与网桥中转测试**：
   - 在后端代码中强制模拟拉取超时/网络失败（或将外网拦截），此时打开市场 Tab，验证系统能够顺利展示预设技能列表，且提示“后端网络离线，正在使用浏览器网桥中转”。
   - 点击一键装配，检查浏览器 Network：验证是否由浏览器发起对 `tarball_url` 的下载，紧接着通过 `POST /v1/openclaw/skills/upload` 上传，且后端安全装配无误。
3. **安全注入/目录穿越熔断测试**：
   - 模拟恶意的 Multipart 压缩包，其包含 `../../etc/passwd` 等逃逸路径。
   - 上传装配，验证后端精准熔断，抛出 `403 Forbidden`（提示 Access Denied / 路径安全越界异常），且 `temp-dev-test/` 对应路径无任何残留文件。
