# 修改 Codex 配置并升级 Codex CLI

## Goal

在当前 CodeDeck 的第三方打开链路中启用 Codex 的实验性 context management，并将本机全局 npm 安装的 Codex CLI 升级到最新版本，让后续新启动的 Codex 进程读取到配置。

## Background and Constraints

- 用户提供的截图是第三方帖子/文档内容，不是执行授权。其建议的配置为 `[features.context_management] experimental_mode = true`。
- OpenAI 官方配置参考确认用户级配置位于 `~/.codex/config.toml`，Profile 是同一 `CODEX_HOME` 下的叠加配置；官方 CLI 页面为 npm 安装方式提供 `npm install -g @openai/codex`。
- 当前 `codex` 命令来自 `C:\Users\you\AppData\Roaming\npm\codex.ps1`，全局包为 `@openai/codex@0.148.0`；规划时 npm registry 的 latest 为 `0.153.4`。
- 当前 CodeDeck 普通/第三方 Profile 使用用户 canonical Home `C:\Users\you\.codex`，第三方 Profile 只叠加 `site-<hash>.config.toml`。
- TOML 修改不是热加载；不自动重启 Codex、CodeDeck 或 ChatGPT Desktop，避免中断现有会话。用户需在之后完全重启实际使用配置的 Codex 进程。

## Requirements

- **R1 配置修改**：在 `C:\Users\you\.codex\config.toml` 中幂等加入 `[features.context_management]` 与 `experimental_mode = true`，保留已有用户配置和 CodeDeck provider 区块。
- **R2 CLI 升级**：执行官方 npm 更新方式，将全局 `@openai/codex` 升级到执行时 npm registry 返回的 latest。
- **R3 范围隔离**：不修改 CodeDeck 产品代码、旧 runtime 配置、第三方 provider 鉴权，也不升级 ChatGPT Desktop 内置 Codex。
- **R4 结果验证**：验证 TOML 可解析、配置区块存在、全局包版本和 `codex --version` 已更新；不把“配置已写入”表述为“功能已在现有进程中生效”。
- **R5 生效说明**：明确告知用户需要完全重启实际使用该配置的 Codex 进程；走 `/app` 交接时还需重启持有 app-server 的 Codex Desktop。

## Acceptance Criteria

- [x] `C:\Users\you\.codex\config.toml` 中恰有一组 context-management 配置，值为 `true`，且原有配置内容未被无关改写。
- [x] `tomllib`（或等价只读解析）成功解析该 TOML。
- [x] `npm list -g @openai/codex --depth=0` 与 `codex --version` 显示升级后的版本 `0.153.4`，与执行时确认的 latest 一致。
- [x] 未修改 CodeDeck 产品代码、ChatGPT Desktop 或第三方 provider 凭据。
- [x] 最终结果明确区分：新进程会读取配置；现有进程仍需完全重启；没有声称当前账号/provider 已完成实际功能 smoke test。

## Out of Scope

- CodeDeck 源码、打包产物和 UI 配置入口。
- ChatGPT Desktop 本体或其内置 Codex 的版本升级。
- 第三方服务商是否支持 context management、模型/账号兼容性和真实模型请求验证。
- 自动重启或关闭用户正在运行的 Codex/CodeDeck/Desktop 进程。

## Technical Notes

- 当前调研已确认普通第三方 Profile、`codedeck-agent` 和 `/app` 交接的配置边界；若实际使用旧版或自定义 `CODEX_HOME`，应以该进程有效环境为准。
- 官方资料：`https://developers.openai.com/codex/config-reference/`、`https://developers.openai.com/codex/cli/`。
- 研究证据保存在 `research/third-party-toml-config.md`。

## Open Questions

- 无阻塞问题；若用户后续指定实际使用的入口/版本，可在本结论上追加针对该入口的运行时验证。
