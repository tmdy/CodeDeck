# Technical Design

## Overview

本任务保留 Codex 的单一 canonical Home，并分别解决两个恢复入口：

1. CodeDeck 内恢复：当前选择的 Profile 显式覆盖历史 provider。
2. Desktop `/app`：沿用历史 provider，通过全局非敏感 provider registry 和 CodeDeck 凭据代理完成认证。

历史 JSONL 始终只读。Profile 选择、provider 解析和凭据读取都发生在本次运行配置层。

## Boundaries

### Session ownership

- `~/.codex/sessions` 是唯一会话 source of truth。
- `session-service` 和 catalog 不新增合并、复制或迁移逻辑。
- 恢复继续使用原 session ID。

### Provider ownership

- CodeDeck-owned site provider ID 继续由 Profile ID 的稳定 hash 派生。
- 独立 `site-<hash>.config.toml` 负责 CodeDeck 选择该站点 Profile 时的 model/provider 设置。
- 全局 `config.toml` 只增加一个带 begin/end 标记的 CodeDeck-owned provider registry 区域，供 Desktop 解析历史 site provider。
- 区域外内容由用户/Codex 所有，CodeDeck 必须原样保留。

### Secret ownership

- token 的 source of truth 仍是 `EncryptedConfigStore`。
- TOML、连接文件、日志和错误对象只包含 provider/Profile 标识，不包含 token。
- 认证命令每次只请求一个 provider token。

## Data Flow

### CodeDeck resume

```text
selected Profile
  -> LaunchService resolves current provider/model
  -> resume command uses original session ID
  -> native Profile adds explicit model_provider override
  -> site Profile adds --profile site-<hash>
  -> Codex resumes transcript with current Profile settings
```

官方 Profile 的 provider 解析采用 CodeDeck 已知的有效启动配置。MVP 不自行重新实现 Codex 全部 managed/project config layering；若顶层未显式配置 provider，则使用 Codex 内置官方 provider 默认值。override 仅在 resume 模式加入。

### Provider registry sync

```text
unlocked saved Codex site Profiles
  -> stable provider definitions
  -> render CodeDeck-owned marked block
  -> detect external same-ID conflicts
  -> atomic replace of ~/.codex/config.toml
```

同步保留标记区域外的原始文本和换行风格。首次写入前若外部区域已定义同一 provider ID，则返回冲突，不生成重复 TOML table。删除 Profile 时只从 managed block 移除对应 provider；空 registry 时移除整个 managed block。

每个 provider block 包含 `name`、`base_url`、`wire_api` 和嵌套 `auth.command/args`。不包含 model 选择、明文 token 或 `env_key`。

### Credential broker

```text
Codex/Desktop
  -> auth.command: codedeck-agent auth-token --provider <stable-id>
  -> authenticated local named pipe request
  -> Electron validates exact provider-to-Profile mapping
  -> unlocked EncryptedConfigStore returns one token
  -> helper writes token only to stdout
```

采用现有 Agent Bridge 的本地连接文件、随机 token、命名管道和 packaged CLI wrapper，增加一个窄的 provider-token capability。协议不接受 Profile key 直接读秘密，不支持 profiles/list/all，不返回其他配置字段。

服务端和 CLI 必须避免记录成功响应；错误只返回稳定错误码和不含 provider token 的消息。CLI 成功时 stdout 只有 token 和终止换行；失败时 stdout 为空，诊断写 stderr 并返回非零退出码。

## Site Profile Authentication Migration

全局 registry 与 `site-<hash>.config.toml` 对同一 provider 必须使用一致的 `auth.command`。现有 site Profile 生成逻辑移除 `env_key`，CodeDeck 启动时也不再注入 `CODEX_SITE_API_KEY_*`。

这不会新增 CodeDeck 外部的可用性承诺：site Profile 本来由 CodeDeck 创建和选择；启动时 CodeDeck 已运行且存储已解锁。统一认证来源可避免 Codex 合并基础配置与 Profile 配置时出现互斥认证字段。

## Lifecycle

- 应用启动但存储锁定：保留上次成功 registry；broker 返回 `store_locked`。
- 存储成功解锁：同步全部已保存 Codex site provider。
- Profile 保存/更新：先持久化 Profile，再同步 registry 和 site Profile；同步失败向调用方报告，保留原配置文件。
- Profile 删除：同步移除 managed provider；历史会话仍可见，但 Desktop 恢复该 provider 时返回 `profile_not_found`。
- 应用退出：停止 pipe 并删除连接文件；Desktop 后续认证返回 app unavailable。

## Error Matrix

| Condition | Required result |
| --- | --- |
| Historical provider absent but CodeDeck resumes with current native Profile | Explicit current provider override; resume succeeds |
| Site Profile resumes another provider's session | Current `--profile` provider/token wins |
| Desktop resumes stored site provider | Original provider resolves and broker returns its token |
| CodeDeck not running | Auth helper exits non-zero with `app_unavailable`; stdout empty |
| Store locked | `store_locked`; stdout empty |
| Unknown/deleted provider | `profile_not_found`; stdout empty |
| Provider ID does not exactly map to stored Codex Profile | `provider_not_found`; stdout empty |
| User config defines same provider outside managed block | Abort sync with `provider_conflict`; preserve original file |
| Atomic config/profile write fails | Preserve prior file and report failure |

## Compatibility and Rollback

- 会话 JSONL 无迁移，回滚不涉及会话数据。
- managed registry 可通过删除标记区域回滚，不触碰用户其余配置。
- site Profile 文件继续采用既有稳定文件名；旧版本再次生成时可恢复其旧认证格式。
- 每次变更仅在内容变化时备份并原子替换，避免中断留下半写 TOML。

## Spec Impact

- 更新 `session-discovery-contract.md`：保留 canonical Home、不复制会话，同时允许只管理全局 `config.toml` 中明确标记的 provider registry。
- 更新 `agent-bridge-contract.md`：加入单 provider 凭据 capability、秘密输出约束、错误矩阵和测试要求。
