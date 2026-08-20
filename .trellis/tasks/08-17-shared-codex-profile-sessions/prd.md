# 统一 Codex Profile 会话列表与跨 Profile 恢复

## Goal

让 CodeDeck 中的官方 Codex Profile 与第三方站点 Profile 共用全局会话列表，并能继续彼此创建的会话；第三方 Profile 会话执行 `/app` 后，也能在 Codex Desktop 中继续使用。

用户价值：会话归属于用户而不是某个启动入口，切换 Profile 或从终端转到 Desktop 时不再出现“会话可见但无法恢复”。

## Background

- CodeDeck 已统一使用 canonical global Codex Home `C:\Users\you\.codex`，会话列表共享已经实现，不需要复制、迁移或合并 JSONL。
- 失败会话的历史元数据记录 `model_provider = "site_provider_46af1e48d1a0fe41"`，而官方启动的有效基础配置没有该 provider，因此恢复在 bootstrap 阶段失败。
- Codex App Server 的 `thread/resume` 支持显式 `modelProvider` 覆盖；对同一失败会话覆盖为当前官方 provider `openai_http` 后已验证可恢复，历史元数据未被改写。
- 第三方 Profile 当前通过稳定的 `site-<hash>` Profile 名称、`site_provider_<hash>` provider ID 和临时 API key 环境变量启动。
- Codex Desktop 复用长期运行的 App Server，不能继承 CodeDeck 终端临时注入的 API key 环境变量。
- Codex custom provider 支持通过 `[model_providers.<id>.auth] command/args` 从命令 stdout 获取 bearer token，且该认证方式不能与 `env_key` 等其他认证来源并用。

## Requirements

### R1. Shared session source

- 所有 Codex Profile 继续只从 canonical global Codex Home 枚举、查看和恢复会话。
- 不复制、迁移、改写或重新索引会话 JSONL。

### R2. Current Profile wins inside CodeDeck

- CodeDeck 恢复会话时，以用户当前选择的 Profile 作为本次运行的 provider/model 配置来源。
- 历史会话中的 provider 仅保留为历史元数据，不得阻止当前 Profile 恢复该会话。
- 官方 Profile 恢复时必须传入当前有效官方 provider 的显式 override；第三方 Profile 保持稳定的 `--profile site-<hash>` 选择语义。
- 跨 Profile 恢复不得加载或注入其他 Profile 的密钥。
- 新会话保持现有启动语义，不为解决 resume 问题增加不必要的历史 provider 处理。

### R3. Desktop `/app` uses the original provider

- Desktop 没有 CodeDeck Profile 选择入口，因此 `/app` 后沿用会话原始 provider，而不是套用 CodeDeck 当前选择的 Profile。
- CodeDeck 将已保存的第三方 Codex provider 的非敏感定义同步到全局 `config.toml` 的 CodeDeck-owned 区域，使 Desktop 能解析历史 provider ID。
- 同步必须保留用户配置中所有非 CodeDeck-owned 内容；遇到同名 provider 冲突时安全失败，不覆盖用户定义。
- provider 配置不得写入明文 token，也不得依赖 Desktop 启动时继承临时环境变量。
- 第三方 provider 统一使用 `auth.command` 调用 CodeDeck 凭据代理，避免基础配置与 site Profile 合并后同时存在 `env_key` 和命令认证。

### R4. Credential broker boundary

- 凭据代理只接受单个稳定 provider ID，并只返回该 provider 对应的 token；不得提供列出、批量读取或任意 Profile 秘密读取能力。
- token 只能写入认证命令的 stdout，不得进入日志、stderr、错误消息或持久化连接文件。
- CodeDeck 未运行、Profile 存储未解锁、Profile 不存在、provider 不匹配或连接无效时必须明确失败，不得回退到明文文件或用户环境变量。
- MVP 允许第三方 Desktop 会话依赖 CodeDeck 正在运行且 Profile 存储已解锁。

### R5. Lifecycle and compatibility

- provider registry 在 Profile 存储成功解锁后建立，并在第三方 Codex Profile 保存、更新或删除后同步。
- 同步写入必须原子化；失败时保留此前可用的 `config.toml` 和 site Profile 文件。
- 现有官方 provider、用户自定义 provider、MCP、Plugins、Projects、Skills 和其他全局配置不得被 CodeDeck-owned 同步修改。

## Acceptance Criteria

- [ ] CodeDeck 的官方 Profile 可以恢复第三方 Profile 创建的会话，后续消息使用当前官方 Profile 的 provider/model。
- [ ] 第三方 Profile 可以恢复官方或其他第三方 Profile 创建的会话，后续消息只使用当前第三方 Profile 的 provider/token。
- [ ] 所有恢复均原地使用同一 session ID，且恢复前不改写会话 JSONL。
- [ ] 新会话和会话列表行为保持现状，仍只使用 canonical global Codex Home。
- [ ] 第三方 Profile 会话执行 `/app` 后，Desktop 能解析原始 provider，并在 CodeDeck 运行且已解锁时取得对应 token 继续对话。
- [ ] CodeDeck 未运行、未解锁、Profile 已删除或 provider 不匹配时，Desktop 的第三方请求以不含秘密的可诊断错误失败。
- [ ] 全局 `config.toml` 只有明确标记的 CodeDeck-owned provider 区域发生变化，区域外内容保持字节等价；同名外部 provider 冲突不会被覆盖。
- [ ] 站点 Profile 和全局 provider registry 均不包含明文 token，也不产生 `env_key` 与 `auth.command` 并存的有效 provider。
- [ ] 相关单元测试、TypeScript typecheck 和 Electron main-process build 通过，并完成官方→第三方、第三方→官方/第三方及 `/app` Desktop 的针对性 smoke test。

## Out of Scope

- CodeDeck 完全退出后，Desktop 仍可使用第三方 provider。
- 为已删除且无法映射到现有 Profile 的历史 provider 恢复凭据。
- 跨 Codex、Claude、Hermes 的通用会话系统。
- 修改历史会话 JSONL、复制会话或建立第二套会话索引。
- 新增常驻 Windows 服务、Windows Credential Manager/DPAPI 第二套凭据存储或无关认证/UI 重构。
