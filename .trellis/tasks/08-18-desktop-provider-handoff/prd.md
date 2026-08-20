# 第三方 Profile 自动交接到 Codex Desktop

## Goal

用户在 CodeDeck 中勾选“桌面版启动”后，CodeDeck 使用当前选中的第三方 Codex Profile 创建一个受监控的临时会话，自动向该会话发送 `/app`，等待 Desktop 接管成功，再关闭临时监控会话。用户不需要手动切换窗口、输入 `/app` 或关闭监控终端。

## Confirmed Facts

- 当前“桌面版启动”按钮直接打开 `codex://threads/new?path=...`，只传工作目录，不传 Profile/provider。
- 全局 `C:\Users\you\.codex\config.toml` 的默认 `model_provider` 是 `openai_http`；第三方 provider 仅存在于 CodeDeck managed registry 中。
- 因此 Desktop 新线程当前使用官方额度，未调用第三方 provider 的 `auth.command` broker。
- 已验证的可靠交接路径是：第三方 Profile 启动 CLI/监控会话后执行 `/app`，Desktop 依据会话原始 provider 调用 `codedeck-agent auth-token --provider <provider-id>`。
- Codex 会话具有单写者锁。Desktop 接管后，CodeDeck 必须关闭临时 writer，不能继续写同一会话。
- 当前 Agent Bridge/监控链路已有 PTY 输入、活动检测、会话关闭和错误分类能力。
- Codex hooks 可能在首次使用项目 hooks 时出现 review/confirmation 页面；当前已有 `--disable hooks` 请求字段和 bridge 场景使用，但普通 UI 启动默认不禁用 hooks。

## Requirements

### R1. Independent Desktop handoff toggle

- 删除“桌面版启动”独立按钮，恢复为启动控制区内的独立复选框。
- 复选框与“开启监控模式”语义独立；桌面交接内部可以强制使用无头监控，但不得改变用户保存的监控模式设置。
- 仅 Codex provider 显示该选项；Claude 不显示。

### R2. Third-party provider handoff

- 勾选后必须以当前选中的 Codex Profile/provider 启动临时监控会话。
- 不得使用 Desktop 的全局默认 `openai_http` 作为新线程入口。
- broker 继续使用现有单 provider、无明文 token 的认证边界。
- 官方 Profile 也必须保持现有行为，不应误切换到第三方 provider。

### R3. Automatic `/app` transition

- “恢复选中”由 CodeDeck 自动向临时监控 PTY 发送 `/app`，不能依赖用户手动输入。
- “直接启动”通过所选 Profile 的 app-server 创建并持久化无用户消息的新 thread，再打开精确 Desktop thread URI；不得先打开错误的最近会话。
- 发送必须经过现有 terminal session ownership/binding，不能向任意终端写入。
- 只有检测到 Desktop 接管已成功或 CLI 会话已明确退出/交接完成，才允许关闭临时监控会话。
- 交接超时、Desktop 未安装、协议启动失败、会话仍持有 writer 或 `/app` 被拒绝时，保留可诊断错误，不删除锁文件、不杀未知进程。

### R4. Hook confirmation policy

- 自动交接阶段不能停在 hook review 页面等待用户输入。
- 推荐 MVP：临时监控会话使用 `--disable hooks`，避免 `/app` 自动化被项目 hook review 阻塞；这只影响临时交接进程，不修改项目 hooks 文件。
- Desktop 接管后的正常会话是否启用项目 hooks 必须保持现有 Desktop 配置语义；不能静默伪造用户对未知 hooks 的信任。
- 如果 Desktop 首次加载仍出现 hook review，必须把它识别为交接未完成并报告原因，而不是自动输入“信任全部”。

### R5. Lifecycle and cleanup

- 临时会话必须有明确 owner、超时和 cleanup 状态。
- Desktop 成功接管后关闭 CodeDeck 临时监控 writer，避免 active-writer 冲突。
- 关闭失败时显示明确的退出/重试提示，不强制删除 lock 文件。
- CodeDeck 异常退出时 broker/pipe 清理遵循现有生命周期合同。

## Acceptance Criteria

- [ ] Codex Profile 选择第三方 provider 并勾选“桌面版启动”后，用户无需手动输入 `/app`，Desktop 打开的会话实际使用该第三方 provider/token。
- [ ] “直接启动”打开一个无用户消息的新 Desktop 对话；“恢复选中”打开精确选中的已有对话。
- [ ] CodeDeck 监控窗口在 Desktop 接管成功后自动关闭，且同一 session 不再被 CodeDeck 占用 writer。
- [ ] 官方 Profile 勾选后仍使用官方 provider，不读取其他 Profile token。
- [ ] 监控模式复选框和桌面版启动复选框相互独立，取消桌面版启动后原有直接/继续/恢复行为不变。
- [ ] hook review 不会导致自动化永久等待；交接阶段禁用 hooks 或明确报告 Desktop hook review 阻塞。
- [ ] 超时、协议失败、broker 失败、writer 冲突和 Desktop 未安装均有不含 token 的诊断错误。
- [ ] 相关 UI、IPC、terminal ownership、hook/approval 和 provider routing 测试通过，并完成一次真实第三方 Profile Desktop smoke。

## Out of Scope

- 修改官方 Desktop 未公开的 session deep-link 协议。
- 自动替用户确认未知或未验证的项目 hooks。
- 强制终止 Desktop、删除 writer lock 或跨进程接管会话。
- CodeDeck 完全退出后仍为 Desktop 提供第三方 token。

## Open Questions

- 无阻塞产品问题。技术实现需要先验证现有 `/app` 命令的可观察成功信号，以及 Desktop 接管后临时 CLI 的可安全关闭时机。
