# 修复浏览器登录后验证码签到回调

## Goal

恢复浏览器登录账号的人工验证码签到闭环：用户在验证窗口完成验证码并成功签到后，CodeDeck 能自动识别结果、关闭验证窗口、回写成功状态并解除“等待人工验证”状态，下一次签到仍可正常发起。

## Background and Confirmed Facts

- 用户反馈：浏览器登录态仍为“已登录”，余额检测正常；仅手动验证码签到成功后没有自动返回，随后签到功能不可用。
- 浏览器账号签到在 `electron/main.ts:2607-2634` / `2710-2793` 进入 `CheckinVerificationService`，并复用浏览器账号的持久化 partition 与运行时请求上下文。
- 验证服务在 `src/shared/electron/checkin-verification-service.ts:407-466` 轮询 `/api/user/self` 和 `/api/user/checkin?month=YYYY-MM`，只有 `task.identityVerified && inspectVerificationStatus(...).checkedInToday` 才完成任务并关闭窗口。
- `inspectVerificationStatus` 当前仅识别 `data.stats.checked_in_today` 或 `data.checked_in_today`（同文件 `592-611`）；若站点在浏览器验证码成功后返回另一种已签到结构，轮询会一直等待直到超时。
- 验证任务关闭窗口时会将状态清理；若轮询未完成，账户状态会停留在 `verifying`，UI 只显示“重新打开验证窗口”，造成后续手动签到闭环中断。

## Requirements

1. 保持 browser-session、PAT 与 legacy Cookie 的鉴权隔离，不退回复制 Cookie 或刷新令牌的旧流程。
2. 扩展人工验证成功判定，使其兼容站点当前签到状态响应中可验证的“今日已签到”字段/记录，同时避免把未登录、错误响应或历史日期误判为成功。
3. 人工签到成功后必须：返回 `success`/`already_checked` 结果、关闭验证窗口、持久化最终签到状态，并允许同一账号再次发起签到/验证。
4. 验证超时、取消、账号失配仍保持现有语义，不得被新的成功判定吞掉。
5. 增加回归测试覆盖浏览器 partition + management request context 下的轮询完成、窗口关闭、状态结果及重复打开任务清理。

## Acceptance Criteria

- [ ] 浏览器登录态为 ready 时，点击“立即签到”并在验证窗口输入验证码，站点返回成功后，验证窗口自动关闭，账号状态变为“签到成功”或“今日已签到”。
- [ ] 成功结果写入 `checkin_states_by_account`，不再停留在 `verifying`；再次点击签到可以创建新的验证任务，不会复用已完成的旧 Promise/窗口。
- [ ] 余额检测与浏览器 Bearer/Cookie 请求行为保持不变，`npm test` 与 `npm run typecheck` 通过。
- [ ] 非今日记录、未登录响应、HTTP 错误和验证码仍待处理时不会被误判为签到成功；超时仍返回现有 timeout 结果。

## Out of Scope

- 不改变浏览器登录、账号绑定、partition 分配或 UI 登录流程。
- 不新增第三方验证码服务或自动识别验证码。
- 不修改签到接口探测、余额检测或 PAT 账户传输策略。

## Risks and Deferred Items

- 不同站点版本的签到状态字段可能存在差异；优先复用已有响应解析与日期校验，并用 fixture 测试锁定兼容字段。
- 若真实站点成功响应仅在前端内存状态中可见，可能需要在验证窗口页面侧补充受限的成功信号；此项需在实现阶段根据现有网络响应证据决定。

## Goal

TBD.

## Requirements

- TBD

## Acceptance Criteria

- [ ] TBD

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
