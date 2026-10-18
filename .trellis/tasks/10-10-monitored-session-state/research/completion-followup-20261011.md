# 完成后仍忙碌：截图回归补充（2026-10-11）

## 新证据与原因

父会话确认用户运行的 resume-repair 构建已包含上一轮 manager/OSC 修复，不能归因于“尚未部署旧修复”。该终端日志停留在 `identity_hint_pending` 与后续 `submitted_input`，没有权威完成；截图仍为通用标题，底部已出现 `Worked for 1h 23m 3s • 02:34` 和 `› Ask Codex to do anything`。

本次 detector 红绿回归复现：用户提交 → Working → 完成行 → 上述提示符，修改前返回 `busy_output`。原因有二：待命占位符列表漏掉 `Ask Codex to do anything`；检测继续把最后两个提示符之间的旧 Working 当成当前工作，未以完成元数据行划分边界。

实际取回官方 `rust-v0.160.1/codex-rs/tui/src/history_cell/separators.rs`，确认 `FinalMessageSeparator` 在最终回答后显示完成时长和完成时间：`  Worked for <duration> • <clock>`。源码注释明确时间是实际完成时间，也允许历史恢复显示，所以不能让任何旧完成行无条件结束之后的新工作。

父会话另外用真实 ConPTY `buildWindowsPtyLaunchSpec` 的 cmd.exe → npm shim → node → codex 链证实：原双引号数组值被再转义成字面参数，终端仅发项目名 OSC；TOML literal array `tui.terminal_title=['thread-id']` 在同链收到正确 UUID 前缀。本代理按此证据实施 builder 局部修改；不重写通用 Windows 参数转义或全局 config。

## 修复边界

- 增补当前占位符；仅认可完整时长 + 完成时钟行作为完成边界，仍须存在主提示符并稳定 250 ms。
- 完成行后的 Working / 交互提示仍保护；普通 `Worked for` 正文、旧完成行之后的新工作不会闲置当前回合。
- fallback 只改变 manager 活动状态，保留权威 lifecycle、身份验证和自动继续授权规则。无身份时仍不按 cwd / 时间猜绑。
- Codex builder 的一次性身份数组改用 TOML 单引号 literal；direct/Claude 行为不变。launch-service 的 argv/预览同步期望已更新。
- 保留新性能改动，未改 manager 实现、输出缓冲、resume repair、launch runtime，也未操作用户现有应用或会话。

## 验证

- 修改前新增截图回归失败：期望 idle，实际 busy_output。
- detector / manager / taskbar / Bridge：4 文件 108 项测试通过。
- 加入 builder、launch-service、launch runtime：5 文件 145 项测试通过。
- 最终 TypeScript 检查与限定差异检查通过。
- 新 builder 回归覆盖 cmd launch command 与 PowerShell initialPrompt encoded script 的 literal 数组传递；它们是源码构建验证，真实 CLI 不同启动链实验与构建交付由父会话记录。

本次没有打包、提交、推送或终止用户应用。正在运行的旧进程仍需交付后以新会话验证，不能把单元测试称为现有终端已现场恢复。
