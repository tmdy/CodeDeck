# Agent Bridge 主动父会话控制

## Goal

让受委托会话 B 能通过 CodeDeck 的受限端口主动读取、续接和中断其唯一绑定父会话 A，使 A/B 的协作由双方显式控制，而不是依赖 B 每轮结束后的服务端自动结果回传。该能力用于完成真实、可观察、可持续的双会话辩论和协作流程。

## Background

- 当前 `continuous` 的语义是：B 一轮完成后，服务端自动把最终 `assistant_text` 注入空闲 A。
- 真实测试已证明 A 能发现 `$codedeck-agent-bridge` 并创建独立 B，但自动回传语义不等于 B 主动操控 A。
- 受委托 B 已有服务端绑定的 scoped token 和 `interrupt-parent`，因此主动控制必须继续使用该最小权限边界，不能向 B 暴露全局 Bridge token。

## Requirements

- B 可调用 `status-parent`，读取服务端绑定 A 的桥接状态和可诊断终端尾部；命令不接受父 session ID。
- B 可将提示词通过 stdin 传给 `continue-parent`，由服务端在同一个 A session 上启动新一轮；命令不接受父 session ID。
- B 可继续使用 `interrupt-parent` 向正在运行的 A 发送一次 Esc，不关闭 A 的终端或会话。
- `continue-parent` 只允许在 A 可继续时提交。A 忙碌、等待交互、停止或不存在时返回明确且可测试的结构化错误，不得交错输入。
- 主动控制不依赖 B 的 `assistant_text` 完成事件。A 结束当前轮后，B 可在自己的轮次中主动调用 `continue-parent` 启动 A，然后结束 B 当前轮。
- `once`、`continuous`、`manual` 现有自动回传策略保持兼容；主动 A/B 协作测试使用 `manual`，避免同一条 B 输出被自动注入和主动发送两次。
- B 只能控制其创建时绑定的 A；不得指定其他会话、使用全局命令、创建 C 或获得全局 Bridge token。
- CLI、协议类型、服务端路由、任务管理器、项目 Skill 和随包委托 Skill 必须描述同一组命令与错误语义。
- 重新进行真实 E2E：A 先确认可见 `$codedeck-agent-bridge`，再创建 B；A/B 使用 `codex::星辰·AI`、`gpt-5.6-terra`、`low`，通过主动父控制完成五阶段辩论。

## Out of Scope

- 不开放任意 peer-to-peer session ID 控制或通用终端写入 API。
- 不允许 B 创建 C，也不支持超过 A→B 的委托深度。
- 不删除现有自动回传策略；本任务只补齐主动父会话控制并明确两种机制的差异。
- 不修改保存的 Profile；模型和思考程度仍是单次启动覆盖。
- 不把原生 Codex 子代理当作 CodeDeck E2E 的替代品。

## Acceptance Criteria

- [ ] `status-parent` 仅返回 B 绑定 A 的状态，且不接受任意目标参数。
- [ ] `continue-parent` 从 stdin 读取非空提示词，在空闲 A 上开始新一轮，并保留 A 的 session、终端和 orchestrator 身份。
- [ ] A 忙碌时 `continue-parent` 返回 retryable `session_busy`；A 等待交互、停止或绑定失效时返回对应结构化错误且不写入终端。
- [ ] `interrupt-parent` 仍只发送一次 Esc；空闲 A 返回 `session_idle`，两种结果都不关闭 A。
- [ ] scoped B 调用全局命令、指定目标或创建 C 仍被拒绝。
- [ ] 单元测试覆盖 CLI 解析、协议校验、父绑定授权、状态读取、主动续接、忙碌拒绝和中断。
- [ ] 项目 Skill 与随包 Skill 明确区分“自动回传”和“B 主动控制 A”，并包含 `status-parent`、`continue-parent`、`interrupt-parent` 示例。
- [x] 真实 A 首先输出 Skill 可见证据，然后创建真实 B；B 至少两次主动调用 `continue-parent` 启动同一个 A。
- [x] A/B 完成立论、质询、驳论、至少两个自由辩论往返及总结陈词，最终保留双方 session ID、关键输出与状态证据。
- [ ] `npm run typecheck`、`npm test`、`npm run build:electron` 和 Skill 校验通过。

## Notes

- 本任务是 `08-14-agent-bridge-debate-e2e` 的子任务。
- 创建本任务前已有一轮被中止的局部实现改动；后续实现必须审核并接续这些改动，不得假设工作树干净或回滚其他用户修改。
