# Research: auth routing root cause

- Query: 研究两条故障链：BrowserAccountSessionManager 在 New API/LinuxDO 登录成功后可能持续不判定 ready，以及 App.tsx 在未保存后台会话时检测余额为何归一化为 auto 并使用 Profile API key。
- Scope: mixed
- Date: 2026-08-15

## Findings

### 结论摘要

1. **浏览器页面成功不等于 manager ready。** 管理器不消费 OAuth 成功事件，只轮询 `POST /api/user/auth/refresh`，再请求 `/api/user/self` 并提取数字用户 ID。刷新协议、Origin/Cookie、响应形状或 self 身份任一失败都会被静默吞掉并继续轮询，所以用户已看到 LinuxDO/New API 成功页时，CodeDeck 仍可能停在 `authenticating`。
2. **手动关闭窗口不会确认成功。** `closed` 把任务完成为 `canceled`，运行态改成 `login_required`，迟到结果被拒绝，主进程不保存 `SiteBalanceSession`。新账号临时分区通常保留 15 分钟供重试；已有浏览器账号分区保持；迁移时新分配的失败分区立即清理。
3. **空的新后台会话在检测余额前被通用保存流程归一化。** `handleTestBalance()` 先处理未保存变更；空 `new` 被 `saveCurrentProfile()` 改成 `auto`，不创建会话并保存 `balance_session_id: undefined`。随后主进程解析为 `no_session`，把 `null` session 交给 `BalanceService.query()`，最终使用 `profile.key`。

### 故障链 1：New API/LinuxDO 登录成功但一直不 ready

#### ready 的唯一权威信号是“refresh + self”，不是页面状态

- `openLogin()` 创建任务、设为 `authenticating` 并进入队列：`src/shared/electron/browser-account-session-manager.ts:150`、`:171`、`:173`。
- 初始站点导航结束后才开始 poll：`src/shared/electron/browser-account-session-manager.ts:515`、`:527`、`:531`。
- 每轮调用 `resolveRequestContext(..., true)`：`src/shared/electron/browser-account-session-manager.ts:582`、`:590`。
- 现代模式必须解析到非空 `access_token`、`token_type=Bearer`、正数 `access_expires_at` 和 `session.sid`：`src/shared/electron/browser-account-session-manager.ts:293`、`:298`、`:740`、`:748`。
- 之后还必须请求 `${browserOrigin}/api/user/self` 并提取正整数 ID：`src/shared/electron/browser-account-session-manager.ts:596`、`:604`、`:754`。
- 只有 ID 存在且匹配，才 flush Cookie、设置 `ready` 并完成：`src/shared/electron/browser-account-session-manager.ts:605`、`:616`、`:618`、`:619`。

因此 LinuxDO 或 New API 前端显示“登录成功”只是浏览器 UI 成功；CodeDeck 仍要求后台 Session.fetch 的 refresh Cookie、Origin、AuthBundle 和 self 身份链全部成功。

#### 验证失败被静默转换成持续重试

- refresh 网络异常返回普通 `error`：`src/shared/electron/browser-account-session-manager.ts:327`、`:353`。
- 非预期现代响应或无法解析的成功体最终成为普通错误：`src/shared/electron/browser-account-session-manager.ts:356`、`:377`。
- `refreshOrDetect()` 只把状态改成 `unknown` 后抛错：`src/shared/electron/browser-account-session-manager.ts:323`。
- `pollLogin()` 捕获所有错误，没有保存原因、计数或终止分类，然后继续定时 poll：`src/shared/electron/browser-account-session-manager.ts:622`、`:627`、`:628`。
- self 网络错误被压缩为 `{ status: 0, payload: null }`：`src/shared/electron/browser-account-session-manager.ts:831`、`:844`。
- self 返回 401/403、HTML、空 JSON 或缺少可识别 ID 时，没有显式失败分支，直接落到下一轮：`src/shared/electron/browser-account-session-manager.ts:596`、`:604`、`:627`。

下列问题因此都会呈现为“页面已登录但 manager 一直未完成”：refresh Cookie 未附带；OriginGuard/WAF 拒绝；部署版本 AuthBundle 与固定结构不同；refresh 成功但 self 失败或无数字 ID；代理把 JSON 替换成 HTML。

#### 与认证规范的偏差

- 规范要求现代形状的 401/409/429、撤销或协议错误为终态，不得降级：`.trellis/spec/frontend/management-auth-contract.md:83`、`:85`。当前 poll 会吞掉普通现代协议错误并继续尝试。
- 规范要求账号绑定请求 `redirect: "manual"`：`.trellis/spec/frontend/management-auth-contract.md:71`。普通 bound fetch 已设置：`src/shared/electron/browser-account-session-manager.ts:442`、`:450`、`:453`；refresh 请求没有：`src/shared/electron/browser-account-session-manager.ts:340`。
- 规范禁止关闭期间的迟到结果恢复 ready：`.trellis/spec/frontend/management-auth-contract.md:87`；当前 `task.finished` 检查正确实现：`src/shared/electron/browser-account-session-manager.ts:591`、`:603`、`:617`。

#### 手动关闭后的精确行为

- `closed` 完成任务为 `canceled`：`src/shared/electron/browser-account-session-manager.ts:575`、`:577`。
- `completeLogin()` 设置 `finished`、清理 timer/映射；非 ready 改成 `login_required`：`src/shared/electron/browser-account-session-manager.ts:658`、`:661`、`:663`、`:667`。
- 主进程收到非 ready 后抛错，不保存会话：`electron/main.ts:2091`、`:2097`、`:2104`；只有 ready 才执行保存：`electron/main.ts:2108`。
- 首次新建账号走 pending registry：`electron/main.ts:2046`。失败后引用保留并复用：`src/shared/electron/browser-account-pending-references.ts:49`、`:98`、`:105`；默认 TTL 15 分钟：`:3`。
- 已有 browser_session 重新登录复用引用，不因关闭清空分区：`electron/main.ts:2058`、`:2066`、`:2078`。
- 已有非浏览器账号迁移到新引用时 `discardReferenceOnRejected=true`，关闭会立即清理新分区：`electron/main.ts:2078`、`:2098`。

### 故障链 2：空的新会话在检测余额时变成 auto 并走 Profile API key

#### UI 默认与空草稿判断

- 选择项包含 `auto`（API Key 自动）和 `new`（新建会话）：`src/components/profiles/SiteBalanceSessionPanel.tsx:78`、`:84`。
- `new` 默认解释为 `browser_session`：`src/components/profiles/SiteBalanceSessionPanel.tsx:63`、`:65`。
- 切换到 `new` 时 App 建立空 browser_session 草稿；切到 `auto` 时建立空 access_token 草稿：`src/App.tsx:3563`、`:3567`、`:3568`。
- `isEmptyNewBalanceSessionDraft()` 只检查 `access_token`、`refresh_token`、`user_id`，不检查 `auth_kind`、`browser_session_id` 或登录任务：`src/App.tsx:302`、`:306`、`:307`、`:309`。
- `normalizeEmptyNewBalanceSessionDraft()` 把它改为 `balanceSessionSelection: "auto"` 和空 access_token 草稿：`src/App.tsx:312`、`:318`、`:319`。

#### 点击检测余额时的调用链

- `handleTestBalance()` 在 IPC 前先执行 `resolveUnsavedProfileChanges()`：`src/App.tsx:2148`、`:2150`。
- 选择 `new` 相对 baseline 属于 balance-session-only change，因此进入 `persistBalanceSessionOnlyChange()`：`src/App.tsx:1804`、`:1805`。
- 该函数调用 `saveCurrentProfile()`，未关闭空草稿归一化：`src/App.tsx:1729`、`:1736`。
- `saveCurrentProfile()` 默认执行 `normalizeEmptyNewBalanceSessionDraft()`：`src/App.tsx:1601`、`:1614`、`:1616`。
- 归一化后 selection 已是 `auto`，不会创建会话，也不会设置 `balanceSessionId`：`src/App.tsx:1618`、`:1620`、`:1626`。
- Profile 持久化为 `balance_session_id: undefined`：`src/App.tsx:1649`、`:1659`、`:1666`。
- `refreshAll(true)` 从持久化状态同步编辑器，UI 也变为 auto：`src/App.tsx:1671`、`:1445`、`:1465`。

#### 主进程为何使用 Profile API key

- 保存后 `handleTestBalance()` 重新 `loadData()`，再调用 `testBalance(key)`：`src/App.tsx:2153`、`:2159`、`:2160`。
- 没有 `balance_session_id` 时，`resolveBalanceAuth()` 返回 `{ kind: "none", reason: "no_session" }`：`src/shared/balance/site-balance-sessions.ts:288`、`:294`、`:312`。
- `runBalanceCheck()` 只有 explicit_session 才传保存会话，否则给 `BalanceService` 传 `null`：`electron/main.ts:1801`、`:1888`、`:1891`、`:1893`。
- `BalanceService.query()` 在 `resolvedSession = null` 时使用 `profile.key.trim()`：`src/shared/services/balance-service.ts:1154`、`:1157`、`:1161`。
- 服务测试已覆盖无显式会话使用 Profile key：`src/shared/__tests__/services/balance-service.test.ts:157`、`:169`；显式会话覆盖 Profile key：`:187`、`:199`。

结论：主进程和 BalanceService 对“已持久化 Profile 没有绑定会话”的行为是自洽的。根因发生在 renderer 动作边界：用户明确选择 `new`，但余额检测前的通用 silent autosave 将意图改写成 `auto`。

### Files Found

- `src/shared/electron/browser-account-session-manager.ts` — 登录窗口、刷新协议、身份探测、轮询、关闭和状态机。
- `src/shared/electron/browser-account-pending-references.ts` — 新账号失败后的临时分区重试 TTL 与清理。
- `electron/main.ts` — 浏览器登录 IPC、会话保存、余额认证解析和 manager 接线。
- `src/App.tsx` — Profile 草稿、空新会话归一化、未保存变更和检测余额动作。
- `src/components/profiles/SiteBalanceSessionPanel.tsx` — `auto`/`new` UI 语义及 browser_session 默认值。
- `src/shared/balance/site-balance-sessions.ts` — `balance_session_id` 到 explicit_session/no_session 的路由。
- `src/shared/services/balance-service.ts` — 无 resolved session 时使用 `profile.key`。
- `src/shared/__tests__/electron/browser-account-session-manager.test.ts` — 现代/旧版 happy path、关闭和迟到身份结果测试。
- `src/shared/__tests__/electron/browser-account-pending-references.test.ts` — 重试复用、TTL 与 shutdown 清理测试。
- `src/shared/__tests__/components/app-balance-session-save.test.tsx` — 空新会话保存为 auto、PAT 在检测前自动保存测试。
- `src/shared/__tests__/services/balance-service.test.ts` — Profile key 与显式会话的优先级测试。
- `scripts/test-browser-auth-smoke.mjs`、`scripts/browser-auth-smoke-worker.cjs` — Session.fetch、Strict Cookie、Origin、持久化与清理的合成 smoke。
- `.trellis/spec/frontend/management-auth-contract.md` — 浏览器认证、现代错误终态、导航、分区保留与关闭竞态规范。

### Existing Tests and Gaps

#### 已覆盖

- 现代登录 mock happy path：完整 AuthBundle + self 数字 ID 最终 ready：`src/shared/__tests__/electron/browser-account-session-manager.test.ts:335`。
- 初始导航未完成时关闭窗口，返回 canceled 且不发请求：`src/shared/__tests__/electron/browser-account-session-manager.test.ts:296`。
- 身份请求中关闭窗口，迟到成功不能恢复 ready：`src/shared/__tests__/electron/browser-account-session-manager.test.ts:495`。
- 当前 URL 在 LinuxDO 时不读取 localStorage：`src/shared/__tests__/electron/browser-account-session-manager.test.ts:414`。
- 新账号失败重试复用分区、TTL 到期清理：`src/shared/__tests__/electron/browser-account-pending-references.test.ts:32`、`:85`。
- 空 `new` 点击“保存”变成 API key auto 且不创建会话：`src/shared/__tests__/components/app-balance-session-save.test.tsx:615`。
- 非空 PAT `new` 点击“检测余额”先保存会话/Profile，再检测：`src/shared/__tests__/components/app-balance-session-save.test.tsx:641`。

#### 覆盖缺口

- 没有“LinuxDO/New API 页面完成登录，但 refresh/self 持续失败”的状态机测试。
- LinuxDO 单元测试直接 mock `refresh=404`、`self=200`；它只证明不读取 LinuxDO localStorage，不证明真实 OAuth callback、Cookie、OriginGuard 或现代 AuthBundle：`src/shared/__tests__/electron/browser-account-session-manager.test.ts:414`。
- Electron smoke 手工写入 `new_api_refresh`，未调用 `BrowserAccountSessionManager.openLogin()`，无法发现“页面成功但 manager 不结束”：`scripts/browser-auth-smoke-worker.cjs:124`、`:133`。
- 没有现代 403/429/协议错误、2xx 缺 SID/expiry、self 401/403、self HTML、self 无 ID 的测试。
- 没有“空 browser_session new + 直接检测余额”测试；现有测试分别覆盖点击保存和非空 PAT，恰好漏掉该组合。
- 没有 App 级断言保证用户明确选择 `new` 时不得静默改为 `auto` 或调用 Profile API key。

### Recommended Fixes

#### BrowserAccountSessionManager

1. **让 probe 失败可观察并分类。** 保存结构化 `lastProbeFailure`（阶段、HTTP 状态、现代错误码、消息），区分“用户尚未完成登录，可重试”和“协议/Origin/响应结构错误，必须终止”；不要用空 catch 吞掉全部错误。
2. **落实现代错误终态。** `AUTH_ORIGIN_INVALID`、429、无法解析的现代 2xx、明确协议错误应完成为 `failed` 并显示可操作消息。仅登录前的匿名/无 refresh cookie 状态可继续等待；若无法可靠判断 callback 时点，可在返回账户 origin 后切换为有限次数验证。
3. **显式处理 self 状态。** 网络错误、401/403、非 JSON、无 ID 应产生诊断结果，不能全部等价为“尚未登录”。
4. **refresh 设置 `redirect: "manual"`。** 与 `buildBoundFetch()` 和认证规范保持一致，避免重定向后误分类。
5. **保留关闭竞态保护。** `task.finished` 和迟到结果拒绝是正确行为；窗口关闭后不能根据先前页面成功推断 ready。
6. **可选 UX 优化。** 监听账户 origin 的 `did-navigate`/`did-navigate-in-page` 作为立即验证提示，但最终仍以 refresh+self 身份验证为准。

#### App 余额认证路由

1. **在 `handleTestBalance()` 先解析当前草稿意图。** selection 为 `new` 且默认 browser_session 尚未登录保存时，阻止检测并提示“请先完成浏览器登录”；不得 silent autosave 后回退 auto。
2. **禁止显式认证动作静默归一化。** `normalizeEmptyNewBalanceSessionDraft()` 可继续服务普通 Profile 保存/离页兼容，但“检测余额”“签到”“浏览器登录”等动作应携带 intent，保留 `new` 或返回校验错误。
3. **非空 PAT 保持现有行为。** 有 PAT/User ID 时继续先保存会话、绑定 Profile、刷新数据，再调用 `testBalance`。
4. **不要在主进程猜 UI 意图。** `resolveBalanceAuth()` 与 `BalanceService.query()` 对持久化 Profile 是自洽的；修复应位于 App 动作边界，而不是让服务层把 `no_session` 猜成未保存会话。

### Recommended Tests

#### Browser manager unit

- 已返回账户 origin/观察到 callback 后，`AUTH_ORIGIN_INVALID` 应完成 `failed`，不持续 poll。
- 现代 2xx 缺 `session.sid` 或 `access_expires_at` 应明确 protocol failure。
- refresh 成功但 self 返回 401/403、HTML、无数字 ID，应按策略终止或有限重试并保留诊断。
- refresh 请求断言 `redirect: "manual"`。
- 窗口关闭与 refresh/self 并发时只完成一次 canceled，状态保持 `login_required`，不 flush、不保存身份。

#### Electron integration/smoke

- 扩展 `test:electron-auth`：通过真实 `BrowserAccountSessionManager.openLogin()` 和本地 OAuth callback 页面写入 HttpOnly refresh cookie，验证 callback 后自动 ready，而不是只手工 `cookies.set()`。
- 增加“页面显示成功但 refresh 返回 Origin 错误”的 fixture，断言明确失败而非等待 10 分钟超时。
- 保留跨进程持久化、Strict Cookie、LinuxDO-origin storage 复用及关闭后分区重试验证。

#### App component

- 选择 `new`、默认 browser_session 未登录，点击检测：`saveProfile`、`saveSiteBalanceSession`、`testBalance` 均不调用；selection 不变 auto；显示“请先浏览器登录”。
- 选择 `new`、切 PAT 但 token 为空，点击检测：不回退 Profile key，显示 PAT 必填错误。
- 选择 `new`、填写 PAT：保持现有先保存会话/Profile、再 testBalance 的顺序。
- 选择已保存 browser_session：不改写 binding，IPC 使用保存 session。
- 显式选择 `auto`：仍允许使用 Profile key，保证 auto 基线不受影响。

### External References

- QuantumNous/new-api `main`，检查时提交 `e2c7aa7b102c2075eae2377df3508658d45e88dc`：
  - `controller/user.go:152-203`：`setupLogin()` 创建 AuthBundle、写 refresh cookie，并返回 access token/session/user。
  - `web/src/features/auth/hooks/use-oauth-login.ts:145-155`：LinuxDO 登录使用当前窗口 `_self` 导航。
  - `web/src/routes/oauth/$provider.tsx:189-205`：OAuth callback 请求 `/api/oauth/:provider`、应用 AuthBundle、导航 Dashboard 并显示成功。
  - `controller/auth_session.go:17-42`：refresh 从 cookie 读取 token、旋转 cookie 并返回 AuthBundle。
  - Repository: `https://github.com/QuantumNous/new-api`
- Electron Session API（CodeDeck 使用 `electron ^39.8.5`）：`session.fetch()` 使用 Chromium 网络栈；Cookie 持久化由 Session/Cookies 管理，`cookies.flushStore()` 强制写盘。官方文档：`https://www.electronjs.org/docs/latest/api/session`、`https://www.electronjs.org/docs/latest/api/cookies`。

### Related Specs

- `.trellis/spec/frontend/management-auth-contract.md:56` — PAT 与 browser_session 隔离。
- `.trellis/spec/frontend/management-auth-contract.md:58` — 现代 refresh 的 partition、Origin、mutex、Bearer/SID 生命周期。
- `.trellis/spec/frontend/management-auth-contract.md:60` — 旧版身份候选只能在账户 origin 读取，LinuxDO storage 不可读。
- `.trellis/spec/frontend/management-auth-contract.md:62` — 窗口关闭后持久 Chromium storage 应保留。
- `.trellis/spec/frontend/management-auth-contract.md:71` — 账号绑定请求必须 manual redirect。
- `.trellis/spec/frontend/management-auth-contract.md:72` — 新账号失败后的有限重试分区复用。
- `.trellis/spec/frontend/management-auth-contract.md:83` — 匿名/过期/撤销 browser session 为 login_required，不降级 PAT。
- `.trellis/spec/frontend/management-auth-contract.md:85` — 现代协议错误应为终态，不降级。
- `.trellis/spec/frontend/management-auth-contract.md:87` — 关闭期间迟到结果不能恢复 ready。
- `.trellis/spec/guides/cross-layer-thinking-guide.md:21` — Source → Transform → Store → Retrieve → Transform → Display；第二条故障发生在 UI 草稿意图到持久化 Profile 认证路由的边界。

## Caveats / Not Found

- 未获得现场 Electron 网络日志、New API 版本、HTTP 状态、`AUTH_*` 错误码或反向代理配置，不能断言现场一定是 Cookie、OriginGuard、AuthBundle 形状或 self 身份中的哪一个；可以确定这些失败都会被当前 poll catch 静默化，表现一致。
- 上游参考基于 2026-08-15 的 New API `main`，不代表所有部署版本；版本差异应成为显式诊断信息。
- 未运行测试。研究角色仅允许写当前任务 `research/`，Electron smoke 会创建/清理 `app-data/electron-auth-smoke-user-data`，因此本次只检查代码和测试实现。
- 未找到覆盖“空 browser_session new + 直接检测余额”的现有测试，也未找到通过真实 `openLogin()` 驱动 OAuth callback 的 Electron 集成测试。
