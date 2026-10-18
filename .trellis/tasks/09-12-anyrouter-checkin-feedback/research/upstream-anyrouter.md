# Research: AnyRouter upstream check-in protocol

- Query: 调研 All API Hub、MetAPI 和专用签到项目，确认 AnyRouter 的登录自动签到、GET self、POST sign_in、认证与成功证据，并提出 CodeDeck 最小适配边界。
- Scope: mixed — 公开上游固定版本源码、官网公开页面及现有 CodeDeck 认证规范；未登录真实账号，未执行签到。
- Date: 2026-09-12 (Asia/Shanghai)

## Findings

### 结论与证据强度

1. **可作为实现依据的当前上游共识是：使用浏览器 Cookie 会话和用户 ID，显式 `POST /api/user/sign_in`。** All API Hub 最新 AnyRouter provider 直接如此实现；MetAPI 的 AnyRouter adapter 继承 New API 通用适配器，后者的 Cookie 分支同样调用该接口；专用项目也仍将 AnyRouter 配置为显式签到。这里证实的是最新可取得客户端源码的行为，尚未用真实账号证明服务器当前返回。
2. **不能用 `GET /api/user/self` 成功证明 AnyRouter 今日签到成功。** All API Hub 最新代码明确注释：AnyRouter 没有经过验证的只读签到状态接口，所谓状态查询会执行签到，因此普通账号刷新不进行该操作。专用项目把“读取用户信息即签到”配置给 **AgentRouter**，而非 AnyRouter。
3. 用户看到“登录后自动签到”可能是页面调用了签到接口，也可能存在站点特定后端副作用；**本次没有取得官网登录后前端 bundle/真实网络链路，因此不能把任一猜测写成事实**。即使页面确实会自动触发，也不妨碍客户端通过明确的 `sign_in` 响应完成协议判断。
4. 官网公开资料、AAH 默认 Cookie 主机和专用项目三方支持的 canonical 管理站点为 **`https://anyrouter.top`**。没有足够证据把任意包含 `anyrouter` 的 URL、子域名或第三方镜像纳入内置管理认证/签到规则。

### 固定版本、文件与链接

本地源码快照都位于本目录 `upstream/`，路径保留原仓库层次。提交通过 GitHub REST API 的默认分支取得；树接口均报告 `truncated=false`。

| 项目 | 固定 revision | 提交时间 UTC |
| --- | --- | --- |
| [qixing-jk/all-api-hub](https://github.com/qixing-jk/all-api-hub/commit/2ffe529e1d92e616c5a6ad605ed406b61b5ef628) | `2ffe529e1d92e616c5a6ad605ed406b61b5ef628` | 2026-09-11 21:53:08 |
| [cita-777/metapi](https://github.com/cita-777/metapi/commit/88634b0d7207039e8d0c0d026c38870cf74bf2bc) | `88634b0d7207039e8d0c0d026c38870cf74bf2bc` | 2026-09-05 08:41:23 |
| [millylee/anyrouter-check-in](https://github.com/millylee/anyrouter-check-in/commit/3b16662142c68703ea3e79c77c06a8cf6bba7990) | `3b16662142c68703ea3e79c77c06a8cf6bba7990` | 2026-09-11 02:11:19 |

#### All API Hub

- [`src/services/checkin/autoCheckin/providers/anyrouter.ts:46-77`](https://github.com/qixing-jk/all-api-hub/blob/2ffe529e1d92e616c5a6ad605ed406b61b5ef628/src/services/checkin/autoCheckin/providers/anyrouter.ts#L46-L77)：真实执行入口；`authType: Cookie`、`userId`、`POST /api/user/sign_in`、JSON 文本 `{}`、`X-Requested-With: XMLHttpRequest`。没有给该 provider 传 accessToken。
- 同文件 `:58-61`：强制 `forceTempWindow: true`，注释解释签到 POST 依赖浏览器建立的 WAF Cookie，并要求在同一受保护上下文完成，避免重放修改请求。这是 **AAH 自己的浏览器传输选择**，不证明 CodeDeck 必须新增窗口体系或每次弹出可见窗口。
- 同文件 `:79-113`：先解析 `message ?? msg` 的“已签到”含义，再独立接受 `success === true || ret === 1 || code === 0`；其余为失败。
- 同文件 `:134-137`：provider 特意没有 `detect/getStatus`，原因正是 `sign_in` 为修改型 POST。
- [`src/services/apiService/newApiFamily/variants/anyrouter.ts:28-72`](https://github.com/qixing-jk/all-api-hub/blob/2ffe529e1d92e616c5a6ad605ed406b61b5ef628/src/services/apiService/newApiFamily/variants/anyrouter.ts#L28-L72)：`fetchSupportCheckIn` 固定 true；旧兼容 `fetchCheckInStatus` 在具备执行上下文时调用 provider.checkIn，所以它不是只读状态检测，返回布尔也不是可直接照搬的 checkedInToday 字段。
- 同文件 [`:97-111`](https://github.com/qixing-jk/all-api-hub/blob/2ffe529e1d92e616c5a6ad605ed406b61b5ef628/src/services/apiService/newApiFamily/variants/anyrouter.ts#L97-L111)：普通账号刷新使用 `readStatus: async () => undefined`，明确保留未知状态，避免刷新触发签到。
- [`src/services/apiTransport/request.ts:226-247,514-527`](https://github.com/qixing-jk/all-api-hub/blob/2ffe529e1d92e616c5a6ad605ed406b61b5ef628/src/services/apiTransport/request.ts#L226-L247)：用户 ID headers 来自共用 builder；Cookie auth 使用 `credentials: include`；只有提供 accessToken 才构造 Authorization。
- [`src/services/apiTransport/compatHeaders.ts:10-30,40-53`](https://github.com/qixing-jk/all-api-hub/blob/2ffe529e1d92e616c5a6ad605ed406b61b5ef628/src/services/apiTransport/compatHeaders.ts#L10-L30)：包括 `New-API-User` 的多厂商 header 扇出。CodeDeck 浏览器账号不应复制这种扇出，现有规范要求仅使用已验证 context headers。
- [`src/services/accountSiteDefinitions/definitions.ts:264-286`](https://github.com/qixing-jk/all-api-hub/blob/2ffe529e1d92e616c5a6ad605ed406b61b5ef628/src/services/accountSiteDefinitions/definitions.ts#L264-L286)：AnyRouter 登录页 `/login`、签到导航页 `/console/topup`、Cookie 默认主机仅 `anyrouter.top`。标题正则用于 AAH onboarding 识别，不是可信域名白名单。
- [`tests/services/autoCheckin/providers/anyrouter.test.ts:199-232,290-359,447-467`](https://github.com/qixing-jk/all-api-hub/blob/2ffe529e1d92e616c5a6ad605ed406b61b5ef628/tests/services/autoCheckin/providers/anyrouter.test.ts#L199-L232)：覆盖只有 success、独立 ret/code 成功、空消息不是已签到、`ret: 0` 不能直接推断已签到、失败响应内明确已签到，以及 POST 发出后丢响应的 uncertain 状态。
- [`src/services/checkin/autoCheckin/providers/shared.ts:34-58,118-160`](https://github.com/qixing-jk/all-api-hub/blob/2ffe529e1d92e616c5a6ad605ed406b61b5ef628/src/services/checkin/autoCheckin/providers/shared.ts#L34-L58)：AAH 通用已签到匹配包括过宽的 `already`；错误处理把已发出的修改请求发生网络/超时归为 uncertain。CodeDeck 可借鉴不假报成功原则，但没有必要为本次功能复刻整套状态体系。

#### MetAPI

- [`src/server/services/platforms/anyrouter.ts:1-9`](https://github.com/cita-777/metapi/blob/88634b0d7207039e8d0c0d026c38870cf74bf2bc/src/server/services/platforms/anyrouter.ts#L1-L9)：仅继承 `NewApiAdapter`，`detect()` 判断 URL 文本包含 `anyrouter`。没有专用登录即签到逻辑。其字符串识别太宽，不能作为 CodeDeck 内置认证域名边界。
- [`src/server/services/platforms/newApi.ts:58-89`](https://github.com/cita-777/metapi/blob/88634b0d7207039e8d0c0d026c38870cf74bf2bc/src/server/services/platforms/newApi.ts#L58-L89)：普通 token 构造 Bearer 与 `New-API-User` 等别名；Cookie 候选可使用原 Cookie header 或尝试 `session=<credential>`、`token=<credential>`。这是 MetAPI 的历史凭据兼容方案，不适合复制进 CodeDeck 隔离浏览器身份流程。
- 同文件 [`:974-1006`](https://github.com/cita-777/metapi/blob/88634b0d7207039e8d0c0d026c38870cf74bf2bc/src/server/services/platforms/newApi.ts#L974-L1006)：登录 `POST /api/user/login`，返回 accessToken 或有效会话 Cookie及平台 user ID；此函数的 success 表示登录成功，没有宣布签到完成。
- 同文件 [`:1116-1219`](https://github.com/cita-777/metapi/blob/88634b0d7207039e8d0c0d026c38870cf74bf2bc/src/server/services/platforms/newApi.ts#L1116-L1219)：非 Cookie 凭据先 `POST /api/user/checkin`；允许 fallback 时，Cookie 分支先 `POST /api/user/sign_in` `{}`，带 Cookie、用户 ID、XHR header，之后才试 Cookie `/api/user/checkin`。这解释“项目支持 AnyRouter”不等于 AnyRouter 使用标准 New API checkin endpoint。
- 同文件 `:1164-1169`：sign_in 成功仅检查 `res.success`，不像 AAH 兼容 ret/code；`GET /api/user/self` 在 `:1222-1257` 用于读取余额，不提供签到证明。
- [`src/server/services/checkinService.ts:28-42,236-248,292-303`](https://github.com/cita-777/metapi/blob/88634b0d7207039e8d0c0d026c38870cf74bf2bc/src/server/services/checkinService.ts#L236-L248)：服务层把明确“已签到”归为成功；unsupported 和人工验证归为 skipped，余额刷新用于成功后的展示和奖励估算，不应反向把余额增长当成协议成功证据。

#### 专用签到项目及冲突资料

- [`utils/config.py:85-107`](https://github.com/millylee/anyrouter-check-in/blob/3b16662142c68703ea3e79c77c06a8cf6bba7990/utils/config.py#L85-L107)：AnyRouter 设置 `https://anyrouter.top`、`sign_in_path='/api/user/sign_in'`、`user_info_path='/api/user/self'`、`api_user_key='new-api-user'`；AgentRouter 则 `sign_in_path=None` 并注释用户信息请求自动签到。
- [`checkin.py:280-305`](https://github.com/millylee/anyrouter-check-in/blob/3b16662142c68703ea3e79c77c06a8cf6bba7990/checkin.py#L280-L305)：独立发送签到 POST；200 后解析 ret/code/success，兼容明确“已经签到、已签到、重复签到、already checked、already signed”；200 HTML 或无成功字段不代表成功。
- 同文件 [`:447-469`](https://github.com/millylee/anyrouter-check-in/blob/3b16662142c68703ea3e79c77c06a8cf6bba7990/checkin.py#L447-L469)：用户 ID header 加入后先查询用户信息，AnyRouter 随后仍调用 execute_check_in，再查余额。只有配置为不需要显式接口的 provider 才走“用户信息触发”分支。
- 搜索还出现 [KimYx0207/anyrouter-check-in](https://github.com/KimYx0207/anyrouter-check-in) README 同时包含“AnyRouter 改成登录自动签到”和“AnyRouter 调用 sign_in”的历史描述；它们彼此不一致，本次不把未核对 revision 的 README/搜索摘要作为机制依据。

### 官网公开资料与域名边界

- [官网文档](https://docs.anyrouter.top/) 本次通过 Exa 提取：示例明确 `ANTHROPIC_BASE_URL=https://anyrouter.top`，并引导注册后获取 API token。页面没有提供签到 API 合同或“GET self 即签到”的承诺。
- [主站公开页](https://anyrouter.top/) 本次通过 Exa 提取：公开登录入口 `/login`；系统公告写明“除官网所示备用 API 域名外也没有建立其他 AnyRouter 或近似名称的镜像站”。公告称 `https://anyrouter.top` 为与主站相同的 API 地址，并展示 `pmpjfbhq.cn-nb1.rainapp.top` 为备用 **推理 API** 地址。备用推理地址不能据此升级为允许传管理 Cookie 的站点。
- 无登录的普通 HTTP 获取主站时只返回 JS WAF challenge（4321 bytes），没有取得实际应用 bundle。未执行该 challenge，未登录，未解析任何真实 Cookie。故本研究不声称已经核实官网 React 生命周期、登录回调或网页自动签到网络触发点。
- 建议内置规则先只选规范化 **`https://anyrouter.top`** 管理 origin；至少要求 exact hostname，禁止 `includes('anyrouter')`、后缀随意匹配、改写用户管理 origin 或向镜像转发凭据。其他 origin 保持现有自定义兼容规则，直到有独立协议证据。

### CodeDeck 推荐的最小适配

1. **对已识别 canonical AnyRouter 选择 action-only 签到策略**：直接在明确的签到命令/定时任务内调用 `POST /api/user/sign_in`，不先要求 `/api/user/checkin?month=` 成功，不因为缺少只读 status 就记录 unsupported，也不让旧的通用缓存阻挡已知策略。普通登录、余额刷新或 UI 打开不擅自调用该 POST。
2. 使用现有 `ManagementRequestContext` 与账号隔离分区。浏览器认证已经提供的 Cookie 运输、`New-API-User` 及其他 verified headers 作为 source of truth；业务层补 `{}` 和 XHR header，并让 verified headers 最后合并。不要从推理 API Key 构造管理 Bearer，不导出 Cookie，不移植上游多别名扇出或 token-to-cookie 猜测。
3. AAH forceTempWindow 证明浏览器环境/WAF 状态可能是必要条件，**不是要求新增浏览器依赖**。CodeDeck 应优先复用已有 Session.fetch 与同源页面传输 fallback；若需用户验证，沿用同一账号分区。后台自动签到不主动弹可见窗口。
4. 对 **正确 sign_in endpoint 的 JSON 响应** 单独判定：明确当天已签到消息优先；否则支持严格布尔 `success === true` 与上游有证据的数字 `ret === 1 / code === 0`。别把空消息、`ret === 0`、普通 HTTP 200、self.success 或账户页面已登录当成功。已签到消息要限制为签到相关短语，不能直接复制全局 `already` 子串匹配。认证拒绝、明确业务错误、HTML/WAF 和字段冲突应保留可解释失败，而不是被泛化成功词覆盖。
5. 人工验证与重试也必须使用同一协议。AnyRouter 不应持续轮询 `/api/user/checkin?month=`。验证页面完成后，由显式“验证完成/重试”动作触发 **一次** sign_in，再以该响应确认成功或 already_checked。不要把 POST 当只读状态接口每秒轮询。若请求已经发出但响应丢失，文案保留“未能确认签到结果，可重试”，不得假报成功。
6. UI 反馈应保留可区分的签到失败、需要登录、需要人工验证与成功/已签到，提供颜色加图标/文本和错误详情；只有重新获得签到成功证据才清除失败提示。状态聚合与具体组件位置由本地 UI 研究负责。

### 建议的具体回归点

- canonical AnyRouter 的浏览器账号无需标准 checkin status，确实发送 sign_in + `{}` + authoritative headers；普通 New API 不受影响。
- 登录验证或 GET self 成功不会自动把签到标记为成功；refresh 不写 sign_in。
- 只有 success、只有 ret=1、只有 code=0、明确已签到、空/失败 JSON、HTML、401/403、POST 超时分别得到可解释结果。
- browser_session 路径不再因为存在 requestContext 而跳过已知 AnyRouter action；失效旧缓存不能令已识别 AnyRouter 永久 unsupported。
- 手工验证最多在用户明确完成后重试一次目标 action，成功/已签到结束验证；不要求不存在的标准月度状态接口，也不出现 POST 轮询。

### Related specs

- `.trellis/workflow.md`：研究阶段产物持久化；当前仍处于 planning。
- `.trellis/spec/frontend/management-auth-contract.md:71-94,105-109`：Cookie/PAT 隔离、正身份验证、verified context headers 最后合并、同源限定、全局签到队列、运行中断恢复。
- `.trellis/spec/frontend/custom-compatibility-contract.md:44-51,63-67`：声明式兼容、账号分区一致性、显式 action 与 CAPTCHA handoff、后台不弹窗。
- `.trellis/spec/frontend/profile-health-contract.md`：已读；Profile 健康状态与签到失败反馈应遵从各自业务语义，不用普通连接健康覆盖签到证据。

## Caveats / Not Found

- **没有真实登录或签到运行验证**；“支持 sign_in”是三个当前客户端实现一致的源码证据，不是本次服务器实测。
- **未找到经验证的 AnyRouter 只读签到状态 endpoint、返回日期字段或官方公开 API 合同**；不得编造 hasCheckedIn/lastCheckin 等字段。
- **未证实官网登录后自动签到具体触发点**。当前证据不足以断言是登录 API、GET self、页面加载 callback 的副作用。
- 上游宽松成功解析与 Cookie 兼容策略不等于 CodeDeck 应逐字复制；本地明确认证边界优先。
- 未新增密码存储、浏览器库、验证码自动求解、镜像登录能力或真实凭据记录；只写当前 task 的 research 目录。
