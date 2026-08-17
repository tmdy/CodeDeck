# 修复旧版浏览器页面会话识别

## Goal

让旧版 New API 站点在页面已登录、但 Electron `Session.fetch` 被站点拒绝时，能够通过严格同源页面请求正确识别、保存并用于余额和签到。

## Background

- `muyuan.do` 的登录窗口已进入账号页面，但运行日志显示探测始终为 `browser_cookie`，`/api/user/self` 连续返回 403。
- 站点当前前端从 `localStorage.user.id` 生成 `New-API-User`，普通 Axios 管理请求不附加 Bearer。
- CodeDeck 当前读取 `localStorage.user.id/token` 后同时发送 Bearer 与 `New-Api-User`，没有在 Bearer 被拒绝时尝试 Cookie + 用户 ID 的同源身份验证。
- 之前的修复只对齐了打开页面与登录探测的浏览器分区；本次日志证明分区对齐后仍存在协议兼容问题。
- 去除 Bearer 后现场仍持续 403，而同一 BrowserWindow 中的账号页能够正常加载余额和签到数据，证明页面请求通道与 `Session.fetch` 不是等价信号。

## Requirements

1. 旧版 New API 身份候选包含 Bearer 时，首次身份验证继续使用现有 Bearer + 用户 ID 头。
2. 首次请求返回 401 或 403 时，只允许对同一身份端点重试一次，移除 Bearer但保留候选用户 ID 头和浏览器 Cookie。
3. 无 Bearer 重试成功且返回相同正整数用户 ID时，登录进入 `ready`，运行时身份切换为 Cookie + 用户 ID，不再把被拒绝的 Bearer用于余额或签到。
4. 无 Bearer重试仍失败、返回无效身份或用户 ID 不匹配时，保持 `login_required` / `account_mismatch`，不得把页面展示状态当作登录证据。
5. Sub2API 的 Bearer/Refresh Token 刷新协议保持不变，不得应用 New API 的无 Bearer回退。
6. 不记录或持久化 Cookie、Bearer、localStorage 原文或其他秘密；诊断只保留鉴权模式、HTTP 状态和结果。
7. 冷启动恢复与交互登录必须共用同一验证策略，避免两个入口再次漂移。
8. 当旧版 New API 的 `Session.fetch` 身份请求仍返回 401/403 时，允许在当前严格同源登录页中重试；成功仍必须返回匹配的正整数用户 ID。
9. 已保存账号的余额或签到请求若被 `Session.fetch` 以 401/403 拒绝，应通过同一持久分区的隐藏同源页面重试，不能只修登录按钮状态。
10. 页面请求禁止跨来源、自动重定向和秘密诊断；页面窗口由 Electron main 管理，并在注销、删除或退出时关闭。

## Acceptance Criteria

- [x] 带旧版 Bearer 的 New API 首次 403、无 Bearer重试 200 且 ID 匹配时，登录结果为 `ready`。
- [x] `Session.fetch` 持续 403、同源页面身份请求 200 且 ID 匹配时，登录结果为 `ready`。
- [x] 成功回退后生成的请求上下文不再带 `Authorization`，仍带正确的 `New-Api-User`。
- [x] 保存后的管理请求在 `Session.fetch` 403 后可由隐藏同源页面返回真实响应。
- [x] 页面请求失败、无 Bearer重试失败或 ID 不匹配时不会保存账号。
- [x] Sub2API 行为及既有现代 AuthBundle 行为不回归。
- [x] 浏览器账号管理器定向测试和 TypeScript 检查通过。

## Out of Scope

- 不针对 `muyuan.do` 域名硬编码。
- 不从 DOM、用户名、头像或页面路由推断身份。
- 不改变余额接口发现、签到业务规则或全局串行队列。
- 不复制或迁移浏览器分区数据。
