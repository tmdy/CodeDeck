# 修复站点已登录但浏览器账号未识别

## Goal

让用户在 Profile 选择“新建会话”并通过“打开 Base URL”进入站点完成登录后，后续“浏览器登录”检测同一个持久浏览器身份分区，从而正确识别、保存并绑定旧版 New API 账号；禁止因两个入口使用不同分区而出现“页面已登录、检测仍 403”的假失败。

## Background

- 既有任务 `08-15-site-auth-session-routing` 已支持旧版 New API：严格同源读取 `localStorage.user.id/token` 或 `uid`，再以 `/api/user/self` 返回的匹配用户 ID 作为成功依据。
- 2026-08-16 的现场日志先记录 `profile:open-base-url("https://muyuan.do/v1", null)`，11 秒后记录 `browser-auth:login("https://muyuan.do/v1", 1)`。
- `openProfileSiteBrowser()` 在没有已保存 `balanceSessionId` 时使用通用 `DEFAULT_PROFILE_BROWSER_PARTITION`；`loginBrowserAccount()` 则为新账号使用 `persist:codedeck-newapi-*` 待绑定分区。两个窗口不共享 Cookie、localStorage、IndexedDB 或登录态。
- 后续登录探测已正确进入 `authMode: browser_cookie`，但账号分区的 `/api/user/self` 持续返回 403，最终在关闭时以 `window_close_unverified` 取消。这与“用户在另一个分区已经登录”完全一致。
- 当前日志不足以证明站点存在新的旧版存储格式或 `Session.fetch` 兼容问题；在修复分区路由并复测前，不扩大协议兼容范围。

## Requirements

1. 当当前后台会话选择为“新建会话”且认证类型为 `browser_session` 时，“打开 Base URL”必须使用该草稿所选浏览器身份对应的分区，不得使用通用 Profile 浏览器分区。
2. 若草稿选择复用已有“账号N”，打开站点必须使用该全局 `BrowserIdentitySlot` 的既有 opaque partition；后续浏览器登录必须继续复用同一 slot，不得分配新身份。
3. 若草稿选择“新身份（账号N）”，主进程必须预分配或复用按规范化 Base URL 保存的 pending browser reference，并立即为其启动有限 TTL；后续 `loginBrowserAccount()` 必须取得同一 reference。
4. 预打开的新身份如果未完成保存，必须继续遵守现有 pending reference 生命周期：重复操作复用、成功后消费、超时或应用退出时清理整个未持久分区。
5. 已选择并保存的 `browser_session` 继续使用其账号分区；`API Key 自动`、PAT 或没有浏览器认证意图的普通打开操作继续使用独立通用分区。
6. 不得在分区之间复制、导出或合并 Cookie、Bearer、localStorage、IndexedDB、LinuxDO 状态或其他浏览器数据。
7. 旧版 New API 的成功判定保持不变：页面状态不是证据，仍必须通过同源后端身份接口返回匹配的正整数用户 ID。
8. Renderer 到 Electron main 的打开请求必须使用明确、可校验的目标类型，而不是靠空字符串、数字哨兵或 UI 文案推断分区。
9. 无效 slot、Base URL 不匹配、已删除账号或畸形打开请求必须拒绝，不得静默回退到通用分区造成新的身份串线。
10. 现代 AuthBundle、Sub2API、已有保存账号、浏览器槽位隔离、退出/删除清理和 Profile 普通浏览行为不得回归。
11. 当用户切换到“新建会话”且存在已有浏览器身份槽位时，浏览器身份下拉框必须默认选择编号最小的现有槽位；仅在没有任何现有槽位时默认选择“新身份（账号N）”。用户后续手动选择必须继续受到尊重。

## Acceptance Criteria

- [x] “新建会话 + 新身份”下先打开站点、完成旧版 New API 登录，再点击“浏览器登录”时，两个动作使用相同 `persist:codedeck-newapi-*` 分区，登录可进入 `ready` 并保存账号。
- [x] “新建会话 + 复用账号1”下打开站点与登录检测均使用账号1既有 opaque partition，不创建账号2或新的 partition reference。
- [x] 已保存的 browser session 打开站点仍使用自身分区；API Key 自动/PAT 打开站点仍使用通用独立分区。
- [x] 预打开但未保存的新身份在 TTL 到期或应用退出后被清理；重复打开和随后登录在 TTL 内复用同一 reference。
- [x] 无效/不存在 slot 和错误 origin 请求明确失败，不会回退到通用分区。
- [x] 登录识别仍要求 `/api/user/self` 或平台身份端点返回匹配 ID，不根据公告弹窗、头像、用户名、URL 或 DOM 文案判断。
- [x] 已有账号1等浏览器身份时，新建会话默认复用编号最小的现有槽位；没有已有身份时才默认新身份。
- [x] 不新增任何 Cookie、Token、SID、localStorage 内容到 renderer IPC、日志或持久配置。
- [x] pending registry、主进程分区路由、renderer 打开意图和既有 browser manager 回归测试通过。
- [x] `npm run typecheck` 通过。

## Out of Scope

- 不为 `muyuan.do`、公告弹窗或特定 DOM 选择器写硬编码。
- 不在分区之间迁移用户已经产生的浏览器数据。
- 不改变旧版 New API 已支持的 localStorage 字段或身份接口；只有分区对齐后仍可复现时才另行扩展协议兼容。
- 不改变 Profile API Key 自动模式、余额协议发现或签到业务规则。
- 未经单独授权，不对生产站点发送诊断 API 请求或执行真实账号自动化测试。
