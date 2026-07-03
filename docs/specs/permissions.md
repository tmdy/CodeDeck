# 权限管理

本文是权限功能的当前说明，合并了原来的权限规格、实现指南和测试说明。

## 目标

权限管理由应用统一翻译为 Claude Code 和 Codex 的底层启动配置。用户在 UI 中选择权限预设和通用保护开关，不需要手写 JSON、TOML 或 CLI 参数。

## 权限模型

权限解析优先级固定为：

```text
本次启动临时覆盖 > Profile 权限覆盖 > 全局默认权限
```

Profile 未配置权限时继承全局默认。临时覆盖只影响本次启动，不写回 Profile 或本地状态。

首版支持 5 个预设：

- `readonly`：只读/规划优先。
- `safe`：默认安全模式，允许工作区内编辑，敏感操作需要确认。
- `auto_edit`：自动接受普通编辑，保留通用保护。
- `strict_whitelist`：严格白名单，不进行交互确认。
- `full_access`：全权限危险模式，保存或临时启动前必须确认。

通用保护开关：

- 禁读 env/key 文件。
- 禁止 `git push`。
- 禁止危险递归删除。
- 允许/禁止联网。
- 额外可写目录。

`full_access` 必须二次确认。未确认的 Profile、全局权限或临时启动请求不能进入真实启动流程。

## 数据位置

- Profile 权限保存在加密 Profile 配置中，随 Profile 保存、重命名和克隆迁移。
- 全局默认权限保存在 `app-data/local_state.json` 的 `global_settings.permissions`。
- 旧字段 `permissions_preset` 仅用于读取迁移，保存时写入新结构。

核心模块：

- `src/shared/profile/permissions.ts`：权限预设、通用保护、规范化、优先级解析、provider 映射和摘要。
- `src/shared/profile/types.ts`：Profile 与全局设置中的权限数据结构。
- `src/shared/services/launch-service.ts`：构建启动计划并生成 Claude/Codex 权限配置。
- `src/shared/services/model-mapping-config-service.ts`：写入 Codex profile config 与 managed rules。
- `src/components/permissions/PermissionSettingsCard.tsx`：全局设置和 Profile 表单复用的权限控件。

## Provider 映射

Claude Code 预设映射：

| 预设 | 启动参数 |
| --- | --- |
| `readonly` | `--permission-mode plan` |
| `safe` | `--permission-mode default` |
| `auto_edit` | `--permission-mode acceptEdits` |
| `strict_whitelist` | `--permission-mode dontAsk` |
| `full_access` | `--permission-mode bypassPermissions` |

Codex 预设映射：

| 预设 | `sandbox_mode` | `approval_policy` |
| --- | --- | --- |
| `readonly` | `read-only` | `on-request` |
| `safe` | `workspace-write` | `on-request` |
| `auto_edit` | `workspace-write` | `untrusted` |
| `strict_whitelist` | `read-only` | `never` |
| `full_access` | `danger-full-access` | `never` |

## Claude Code 实现

启动计划会为每个 Profile 生成受管理 settings 文件：

```text
app-data/claude-runtime/permissions/claude-permissions-<profile-hash>.json
```

启动命令追加：

```text
--settings "<managed-settings-path>"
```

生成内容包括：

- `includeCoAuthoredBy`：来自全局设置 `include_co_authored_by`。
- `permissions.deny`：根据通用保护开关写入 env/key 读限制、`git push` 限制、危险删除限制和禁网相关规则。
- `permissions.additionalDirectories`：来自额外可写目录。
- `sandbox`：在有敏感文件、额外写目录或禁网规则时生成必要的文件系统和网络约束。

`--permission-mode` 仍由权限预设控制。参数设置页不再提供旧的 Claude `permission_mode` 文本框，避免与权限卡片冲突。

## Codex 实现

Codex 使用稳定的 sandbox 配置，不默认切换到 beta permission profiles。

Profile 配置写入：

```text
app-data/codex-runtime/home/<site-profile>.config.toml
```

内容包括：

- `sandbox_mode`
- `approval_policy`
- `web_search`
- `skip_git_repo_check`
- `[sandbox_workspace_write].network_access`
- `[sandbox_workspace_write].writable_roots`
- `[shell_environment_policy]`
- `[model_providers.<site_provider>].wire_api`

`allowNetwork = false` 时写入 `network_access = false` 和 `web_search = "disabled"`。

`denyEnvFiles = true` 时追加：

```toml
[shell_environment_policy]
exclude = ["*KEY*", "*TOKEN*", "*SECRET*", "*PASSWORD*", "CODEX_SITE_API_KEY_*"]
```

命令保护写入：

```text
app-data/codex-runtime/home/rules/managed-permissions.rules
```

当前生成规则包括：

- `denyGitPush`：`prefix_rule(pattern = ["git", "push"], decision = "forbidden")`
- `denyDangerousDelete`：阻止 `rm -rf`、`rm -r`、`del /s`、`rmdir /s`、`Remove-Item -Recurse` 等常见危险删除前缀。

## 全局启动环境

全局设置会在 `LaunchService` 中转换为启动环境变量，优先级低于参数设置页 `extra_env` 和单 Profile 的 `extra_env`。Provider 必需变量保持最高优先级。

- `proxy` -> `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`
- `disable_telemetry` -> `DISABLE_TELEMETRY=1`
- `disable_error_reporting` -> `DISABLE_ERROR_REPORTING=1`
- `disable_nonessential_traffic` -> `DISABLE_NON_ESSENTIAL_MODEL_CALLS=1`

这些变量对 Claude Code 和 Codex 都是 best-effort 传递；CLI 是否读取取决于各自实现。

## UI 接入点

- `GlobalSettingsPanel`：显示默认权限卡片，保存到 `global_settings.permissions`。
- `ProfileEditForm`：显示权限卡片，支持继承全局或自定义。
- `ProfilesLaunchPanel` 和 `CommandPreview`：显示最终权限摘要。
- `LaunchControls`：提供临时只读和临时全权限启动入口。

## 限制

- Claude Code 的 `permissions.deny` 对 Claude 工具调用生效；sandbox 对 shell 命令的隔离能力取决于 Claude Code 当前平台支持。
- Codex 旧 sandbox 配置无法精确表达“workspace 可写但 `.env` 禁读”。当前通过 `shell_environment_policy` 降低环境变量泄漏风险，通过 managed rules 阻止高风险命令。
- Codex rules 是命令前缀规则，能覆盖常见直接命令；复杂 shell/PowerShell 包装仍建议后续增加 hooks 或 beta permission profiles。
- 首版不提供任意命令规则编辑器，也不提供专家 JSON/TOML 手写编辑。

## 测试覆盖

主要测试文件：

- `src/shared/__tests__/profile/permissions.test.ts`
- `src/shared/__tests__/services/profile-service.test.ts`
- `src/shared/__tests__/services/launch-service-permissions.test.ts`
- `src/shared/__tests__/services/model-mapping-config-service.test.ts`
- `src/shared/__tests__/components/global-settings-panel.test.tsx`
- `src/shared/__tests__/components/profile-edit-form.test.tsx`
- `src/shared/__tests__/components/profiles-launch-panel.test.tsx`

测试关注生成的命令参数、Claude settings、Codex config、Codex rules、权限摘要和 UI 行为，不启动真实 Claude/Codex CLI。
