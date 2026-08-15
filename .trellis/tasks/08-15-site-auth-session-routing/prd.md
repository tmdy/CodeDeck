# 修复站点登录态丢失与余额检测会话串线

## Goal

让 New API 站点的浏览器登录形成完整、可观察、可持久化的闭环：用户在站点或 LinuxDO 完成登录后，CodeDeck 必须验证并保存浏览器账号，将其绑定到当前已有 Profile，并确保后续“检测余额”只使用该明确绑定的后台账号，而不会静默回退到 Profile API Key。

## Background

- 用户在 `https://x666.me` 的浏览器登录窗口中已看到站点“登录成功”和已登录用户，但关闭窗口后 CodeDeck 仍停留在“新建会话”。
- `app-data/logs/codedeck.log` 在 2026-08-15 记录多次 `browser-auth:login failed`，错误为“已取消浏览器登录”；紧接着 `balance:test` 的 `authKind` 为 `none`，最终提示检查 API Key。
- `src/shared/electron/browser-account-session-manager.ts:575` 当前把登录窗口关闭直接解释为取消；只有轮询 `/api/user/auth/refresh` 和 `/api/user/self` 成功后才会保存账号。
- `src/App.tsx:1988` 的浏览器登录成功路径先保存独立后台账号，但不会立即把该账号绑定到当前 Profile；绑定依赖之后的草稿保存。
- `src/App.tsx:312` 会把空的“新建会话”草稿规范化为 `auto`；`src/App.tsx:2148` 的余额检测会先保存该规范化结果，因此登录失败/取消后会转到 API Key 自动检测。

## Requirements

1. 浏览器登录成功判定必须以同源、同账号的后端验证为准，不得仅依据页面文案、URL 或渲染状态。
2. 交互登录探测必须兼容现代 New API AuthBundle 与旧版浏览器会话模式。旧版允许 Electron 主进程从严格匹配账号 origin 的 `localStorage.user` 提取正整数 `id` 和非空 `token`，并兼容 `localStorage.uid`/Cookie 回退；不得读取 LinuxDO 或其他 origin 的站点存储。
3. 用户关闭登录窗口时，不得无条件丢弃已经完成但尚未被轮询观察到的登录；关闭流程必须等待当前探测或执行一次最终探测，再决定成功或取消。
4. 新建浏览器账号验证成功后，账号记录与浏览器身份槽位必须持久化，LinuxDO 与站点浏览器存储继续由稳定的 `persist:` partition 保存。
5. 当用户正在编辑一个已保存 Profile 时，成功登录的新后台账号必须立即绑定到该 Profile；UI 随后显示已保存账号而不是“新建会话”。
6. 当用户正在创建尚未保存的新 Profile 时，只保存后台账号并保持草稿选择；不得隐式创建 Profile 或保存其他尚未确认的 Profile 字段。
7. 选择“新建会话”但浏览器账号尚未验证完成时，点击“检测余额”必须停止并给出明确提示，不得把选择静默转换为 `API Key 自动`。
8. 已明确选择 `API Key 自动` 的 Profile 保持现有余额检测行为；PAT、旧版账号迁移、自动签到和现有多账号槽位语义不得回归。
9. 不自动复用任意已有浏览器身份槽位，避免多 LinuxDO 账号之间的身份串用；仅复用用户明确选择的槽位或当前账号已有槽位。
10. 旧版 Bearer 只能存在于 Electron 主进程运行时内存，不得写入账号记录、日志、诊断事件或 renderer IPC；应用重启后应从该账号持久 partition 的隐藏同源页面恢复候选，并再次通过 `/api/user/self` 验证。
11. 无论现代或旧版模式，只有同源 `/api/user/self` 返回与候选一致的用户 ID 后才能进入 `ready`，身份不匹配、畸形存储或跨 origin 读取必须拒绝。
12. Sub2API 浏览器登录必须从严格同源页面读取 `auth_user.id`、`auth_token` 与可选 `refresh_token`，通过 `/api/v1/auth/me` 根级 `id` 验证身份；Access/Refresh Token 仅保存在 Electron 主进程运行时，并发 401 只能触发一次有效刷新。
13. Profile 的 Base URL“打开”操作必须使用 CodeDeck 内置 BrowserWindow；当前选择浏览器后台账号时复用该账号的持久 partition，其他情况使用独立的应用内持久 partition，不得调用系统默认浏览器。

## Acceptance Criteria

- [ ] 在现代 AuthBundle 站点完成登录后，登录窗口自动结束，账号持久化，并且当前已有 Profile 的 `balance_session_id` 指向该账号。
- [ ] 在旧版站点完成登录后，可使用 `localStorage.user.id/token` 或 `localStorage.uid`/Cookie 候选完成同源验证，账号持久化且不把 Cookie/Token 发送到 renderer 或写入配置文件。
- [ ] 用户在页面已完成登录后立即关闭窗口，CodeDeck 会等待/执行最终探测；验证成功则按成功处理，验证失败才返回取消。
- [ ] 真正取消登录不会创建账号、不会绑定 Profile，也不会把迟到的探测结果恢复为 `ready`。
- [ ] 成功登录后后台会话下拉框显示保存后的“账号N”，状态显示“已登录”，不再停留于“新建会话”。
- [ ] 成功绑定后点击“检测余额”，主进程解析到 `explicit_session` / `browser_session`，不会使用 `authKind: none` 或 Profile API Key 路径。
- [ ] 未完成浏览器登录且下拉框仍为“新建会话”时，点击“检测余额”不会调用 `balance:test`，并提示先完成浏览器登录。
- [ ] 明确选择“API Key 自动”时仍可正常调用现有余额检测。
- [ ] 关闭成功登录窗口和正常应用重启不会清理已保存 partition；取消的新账号引用仍遵守现有有限 TTL 与退出清理规则。
- [ ] 应用重启后，旧版账号可从其持久 partition 的隐藏同源页面恢复内存认证候选，并在验证成功后继续检测余额，无需重新打开交互登录窗口。
- [ ] 诊断事件、日志、IPC 返回值和持久记录均不包含旧版 Token 或完整 `localStorage.user` 内容。
- [ ] 相关 Vitest 用例与 TypeScript 类型检查通过。
- [ ] Sub2API 登录后可由浏览器账号检测余额；应用重启后可恢复同源运行时凭据，401 刷新不会因延迟响应清除新登录态。
- [ ] Profile 网址在 CodeDeck 内置浏览器中打开；已选择的浏览器账号共享同一 partition 和登录态。

## Out of Scope

- 不自动选择或合并不同浏览器身份槽位。
- 不读取、复制、导出或记录 LinuxDO 存储、Cookie、refresh token、SID；旧版站点 Bearer 仅允许按上述严格同源规则读取并保存在 Electron 主进程内存中。
- 不改变站点签到业务规则、余额接口发现策略或 Profile API Key 本身。
- 不修复本次日志中独立出现的“免口令密钥无法由当前系统账户解密”问题。
