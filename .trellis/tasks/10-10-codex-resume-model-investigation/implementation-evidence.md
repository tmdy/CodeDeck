# 跨 provider 历史修复证据

## 已确认的直接原因

同一官方 provider `openai_http`、模型 `gpt-6.1-sol`：CLI 0.160.1 新 ephemeral 会话回复 OK；问题历史的独立 ephemeral fork 返回 `invalid_encrypted_content`，官方无法验证第三方 reasoning 密文。Desktop 0.162.0-alpha.2 同历史表现为 `stream closed before response.completed`，复现用户的 Reconnecting 1/5 到 5/5。测试未对原问题线程发送消息或修改原 JSONL。

## 上游依据（固定 rust-v0.160.1）

- [恢复参数与 provider 显式覆盖](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/app_server_session.rs)：`ThreadResumeParams` 使用当前配置的 explicit provider；`-c model_provider` 所在 SessionFlags 是明确覆盖。provider 切换本身已经生效。
- [恢复历史 reducer](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/core/src/session/rollout_reconstruction.rs)：最后 surviving compaction 决定模型历史；paginated window 的最新 checkpoint 限定 replay 边界；最新 completed user/context baseline 与 resume metadata 共同还原 prior settings、last started turn 和 world state。
- [checkpoint 元数据编码](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/history/src/rollout_payload.rs)：`replacement_history_metadata` 必须与历史逐项同长度。没有 envelope metadata 的条目用空对象；不能过滤 history 后原样保留旧 metadata 数组。
- [CompactionResumeMetadata](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/history/src/compaction_resume_metadata.rs)：保留 runtime、last started turn、previous turn settings 的 fallback，不能统一清空。
- [ephemeral fork goal 继承条件](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/app-server/src/request_processors/thread_processor.rs)：只有 `defer_goal_continuation && rollout_path.is_some() && goals_enabled` 才继承持久 goal。ephemeral 与 defer 参数同时指定会明确拒绝；测试使用无 defer 的 ephemeral fork，不会继承原 goal。
- `thread/resume.history` 在协议源标注 `FOR CODEX CLOUD - DO NOT USE`，本修复没有采用该入口。

下载的固定版本源码副本位于 `C:/Users/you/AppData/Local/Temp/`，关键文件名为 `codex-session-rollout_reconstruction.rs`、`codex-history-rollout_payload.rs`、`codex-history-compaction_resume_metadata.rs`、`codex-thread_processor.rs`。

## 实现与验证范围

`prepareCodexProviderResumeRepair` 只准备追加计划。它从最后 checkpoint 和 suffix 还原 active ResponseItems，按 provider 归属移除不兼容 encrypted reasoning，保持所有 message、tool call/output 及 metadata 对齐；保留原窗口身份、retained/guardian context，重放 suffix 控制记录恢复 world state 与 turn 状态。旧 resume metadata 保留，依据 suffix 的真实完成回合更新 newer hints。CodeDeck marker 记录清理后 provider，避免下一次官方恢复误删新官方 reasoning。

原问题为 window 31，真实 fixture 准备结果移除 7 条 opaque reasoning、保留 226 条 ResponseItem。复制原 metadata + 最后 checkpoint + suffix 到新 UUID 合成 fixture，放在 canonical sessions 供发现，转换后以独立 ephemeral fork 发送只读无工具 OK 任务；CLI 0.160.1 与 Desktop 0.162 alpha 都成功回复 2 字符。fixture 用 `thread/delete` 清理后删除确切测试文件。metadata fallback 修复后的 CLI 与 Desktop fixture 已再次通过；随后新增的缺 runtime 字段与 aborted-turn 分支有独立回归覆盖。

纯准备模块不进行真实写入；main-session 实施 Windows 独占写入、manifest 与 Electron selected-session 接入。回滚、无 replacement 的压缩及无法还原的跨 agent 状态仍明确拒绝，不能声称支持所有历史格式。continue-last/picker 未增加自动转换。

相关已有四文件 96 项回归通过；新增 sanitizer 最终 13 项通过；exclusive writer 调整测试超时及清理等待后独审代理最终独立三项通过（1.09s）。最终 TypeScript 两配置检查通过。

## 原会话与本地应用最终验收

用户退出测试终端后，确认无持有原线程的 codex 进程，通过最终编译模块和独占 writer 追加修复。原长 166686240 bytes，追加 3713453 bytes，过滤 7 条 reasoning，保留 226 条 active ResponseItems；再次准备返回 null，证明修复幂等。恢复 manifest 状态 applied，保留原长度及 SHA256。

随后直接以已修复原线程为来源创建独立 ephemeral fork，CLI 0.160.1 和 Desktop 0.162.0-alpha.2 均为 openai_http，回合 completed、error=null、输出2字符 OK。没有向原线程发送诊断任务消息。

最终 npm run build:electron 和 Windows x64 dir 打包成功。本地验证版位于 D:/CodeDeck/release/codex-resume-repair-20261010/win-unpacked，旁置 CodeDeck.project-root.txt 指向 D:/CodeDeck，沿用原 Profile 与数据。通过 Computer Use 退出旧主窗口、启动修复版、在官方 Profile 中滚动选择原“排查网络问题”，点击“恢复选中”；日志 2026-10-10T10:15:27.140Z 为 launcher:launch success，codex 进程包含原UUID和 model_provider=openai_http 覆盖。终端窗口已交给用户，未自动输入。

Computer Use 的 guidance.md 明确禁止操控 Codex CLI / Windows Terminal，因此手动 UI 验证覆盖 CodeDeck 入口与启动，真实消息流由官方协议测试验证。模型目录按用户要求不继续处理。没有提交或发布。
