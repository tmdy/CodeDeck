# 自定义网页元素余额与签到兼容

## Goal

让非标准站点也能在 CodeDeck 中完成余额读取和签到：用户可以明确指定管理 API、签到页面/API，以及网页中的余额字段和签到控件；签到遇到验证码、Turnstile 或其他人工挑战时，继续交给内置浏览器处理。标准站点仍走现有自动识别路径，用户不需要为已有配置重新设置规则。

## Confirmed repository facts

- `SiteBalanceSession` 当前以站点根地址为主，保存 Access Token、浏览器会话引用和用户 ID，但没有独立的余额 API 地址、签到地址或网页规则字段（`src/shared/balance/site-balance-sessions.ts`）。
- `BalanceService` 通过站点 URL/响应内容推断平台族，并尝试固定管理端点及常见 JSON 字段；非标准响应会落到“暂未识别余额字段”（`src/shared/services/balance-service.ts`）。
- `CheckinService` 主要尝试固定的 `/api/user/checkin`、`/api/user/sign_in`、VoAPI 路径，并已有路径学习、鉴权候选、nonce、手动验证分类（`src/shared/services/checkin-service.ts`、`src/shared/site-capability-cache.ts`）。
- `CheckinVerificationService` 已能复用浏览器会话、打开站点页面、点击常见“签到”按钮并等待状态，但当前人工页面默认是站点固定路径，元素识别是内置文本匹配，浏览器导航通常绑定账号 origin（`src/shared/electron/checkin-verification-service.ts`）。
- 现有浏览器账号、验证码/人工验证、自动签到调度和 PAT 兼容行为已有测试与 UI，不应被新规则路径破坏。

## Product requirements

1. 为后台账号增加可选的“自定义兼容规则”，默认关闭；没有规则时行为与当前版本一致。
2. 规则至少能分别指定：
   - Profile 推理 API 之外的管理/身份 origin 与浏览器登录 URL；
   - 余额请求目标（可与官网/浏览器登录 origin 不同）；
   - 签到请求目标或签到页面 URL（可与官网和余额 API 地址不同）；
   - 余额读取方式：JSON 字段路径或网页元素定位；
   - 签到动作：API 方法/请求体，或网页元素点击；
   - 成功/已签到判定方式（响应字段、文本或网页元素）。
3. 网页元素定位必须支持用户明确选择或填写稳定定位信息，至少覆盖 CSS selector；不得依赖猜测任意页面元素。余额元素支持文本、属性或正则/数值提取，并能配置单位、总额/已用/剩余的映射。
4. 提供在 CodeDeck 内置 BrowserWindow 中的规则辅助流程：打开指定页面、允许用户确认元素/动作、保存规则前展示预览；不调用系统默认浏览器。规则辅助流程不得读取或导出 Cookie、Token、验证码答案等敏感内容。
5. 独立 API 请求必须沿用现有明确鉴权边界：PAT/Access Token、浏览器会话 Cookie/运行时 Bearer 不互相猜测或回退；跨 origin 请求只允许由用户保存的规则明确声明，并在主进程执行。
6. 自定义浏览器规则允许两种身份来源：优先保留现有后端身份验证；当站点不存在可验证的标准身份接口时，允许用户在高级兼容流程中明确确认当前浏览器身份。用户确认模式不得生成伪造 User ID，也不得进入标准自动探测路径。
7. 网页签到必须复用现有人工验证窗口和持久浏览器 partition。验证码、Turnstile、2FA 等出现时，状态显示为“需要人工验证”，用户可在页面完成后由 CodeDeck 再次读取成功判定；后台自动签到不得自行弹窗。
8. 规则签到页面可以独立于官网和余额 API；规则执行完成后，余额刷新应使用规则指定的余额目标，而不是错误地回到 Profile 官网 URL。
9. 规则失败、超时、跨域阻止、元素不存在或解析失败必须给出可操作的错误，不得静默回退到 Profile API Key 或其他账号。
10. 现有自动适配、已保存账号、学习路径、浏览器登录、自动签到和 PAT 体验保持兼容；规则字段缺失或无效时按旧路径处理（仅在明确选择规则模式且规则不完整时提示配置错误）。
11. 规则配置纳入现有加密配置/账号更新语义；不持久化浏览器 Cookie、短期 Bearer、SID、验证码答案或完整页面内容。

## Acceptance criteria

- [ ] 未配置规则的现有账号通过现有测试，行为和请求路径不变。
- [ ] 用户可为一个账号保存与官网不同的余额 API URL，并能用 JSON 字段路径读取余额。
- [ ] Profile 推理 API、管理/身份 origin、浏览器登录 URL、余额目标和签到目标可以分别配置；标准浏览器账号仍要求后端身份验证，自定义用户确认模式不伪造 User ID。
- [ ] 用户可为同一账号保存与官网/余额 API 不同的签到页面 URL，并在页面中指定签到按钮和成功状态元素。
- [ ] 用户可用 CSS selector（及属性/文本/数值映射）读取一个非标准 HTML 余额页面；解析结果显示为现有 `BalanceCheckState`。
- [ ] 用户可用指定 API 方法、请求体和成功判定完成非标准签到；POST/GET、nonce/验证码所需的现有机制不回归。
- [ ] 网页签到遇到验证码或 Turnstile 时进入现有 `manual_required`/验证窗口流程；用户完成挑战后能得到成功、已签到或明确失败结果。
- [ ] 余额目标、签到目标、登录 origin 可不同；请求和浏览器导航均严格按规则目标执行，不串用其他账号或站点存储。
- [ ] 规则模式下不存在隐式 API Key 回退；无效规则给出明确提示并保留原配置。
- [ ] 规则配置经过规范化、加密持久化、重启恢复和删除/更新；敏感运行时凭据不进入 renderer、日志或持久规则字段。
- [ ] 增加最小单元测试覆盖规则规范化、JSON/HTML 提取、API/网页签到分支、人工验证回流、跨 origin 限制和旧配置兼容；相关 TypeScript 检查通过。

## Out of scope

- 自动为任意网站猜测登录、余额字段或签到按钮。
- 绕过验证码、Cloudflare、Turnstile、风控或站点访问控制。
- 通用浏览器录制器、任意 JavaScript 注入脚本市场或跨设备同步浏览器 Cookie。
- 修改现有标准平台的余额计算语义，或顺手重构当前鉴权/签到架构。

## Product decisions

- 第一版采用“内置元素选择器辅助 + 高级 CSS/字段路径表单”。用户可在受限的 CodeDeck BrowserWindow 中点选余额元素、签到按钮和结果元素，也可直接编辑 selector/字段路径。
- 跨 origin Bearer/PAT 默认禁止。每条规则只有在展示源/目标 origin、用户明确确认并保存精确目标 origin 后，Electron 主进程才可转发当前账号凭据；URL origin 改变会使确认失效。目标站点 Cookie 仍只由 Chromium 按域附带。
- 标准账号继续使用现有后端身份验证。高级自定义页面模式可由用户确认浏览器身份，但仅能执行其明确保存的页面/API 规则，不得伪装成标准 New API 账号或参与自动接口猜测。
