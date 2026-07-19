# 权限管理

本文是权限功能的当前说明，覆盖 Claude Code 与 Codex 的独立权限设置、落盘位置、限制和测试覆盖。

## 目标

权限管理不再使用一套统一预设去同时解释 Claude Code 和 Codex。应用会分别展示并保存两类原生权限配置：

- Claude Code：`--permission-mode`。
- Codex：`sandbox_mode` 和 `approval_policy`。

通用保护开关仍按 provider 生成各自可表达的规则，用户不需要手写 JSON、TOML 或 rules 文件。

## 权限模型

权限解析优先级固定为：

```text
本次启动临时覆盖 > Profile 权限覆盖 > 当前 provider 的全局默认权限
```

Profile 未配置权限时继承对应 provider 的全局默认。临时覆盖只影响本次启动，不写回 Profile 或本地状态。

全局默认权限保存在：

```json
{
  "permissions": {
    "claude": { "provider": "claude", "mode": "manual", "common": {} },
    "codex": { "provider": "codex", "sandboxMode": "workspace-write", "approvalPolicy": "on-request", "common": {} }
  }
}
```

新的安全默认：

- Claude Code：`manual`。
- Codex：`workspace-write + on-request`。
- 通用保护：禁读 env/key 文件、禁止 `git push`、禁止危险递归删除、允许联网、额外可写目录为空。

旧统一 `preset` 或 `permissions_preset` 只作为兼容输入识别；读取时重置为当前 provider 的安全默认，不再保留旧 preset 语义。

通用保护开关：

- 禁读 env/key 文件。
- 禁止 `git push`。
- 禁止危险递归删除。
- 允许/禁止联网。
- 额外可写目录。

全权限配置必须二次确认。未确认的 Profile、全局权限或临时启动请求不能进入真实启动流程。

## Provider 映射

Claude Code 权限模式：

| UI 选项 | 启动参数 |
| --- | --- |
| `plan` | `--permission-mode plan` |
| `manual` | `--permission-mode manual` |
| `acceptEdits` | `--permission-mode acceptEdits` |
| `dontAsk` | `--permission-mode dontAsk` |
| `bypassPermissions` | `--permission-mode bypassPermissions` |

Codex 权限组合：

| UI 选项 | `sandbox_mode` | `approval_policy` |
| --- | --- | --- |
| `read-only + on-request` | `read-only` | `on-request` |
| `workspace-write + on-request` | `workspace-write` | `on-request` |
| `workspace-write + untrusted` | `workspace-write` | `untrusted` |
| `workspace-write + never` | `workspace-write` | `never` |
| `danger-full-access + never` | `danger-full-access` | `never` |

临时只读会映射到 Claude `plan` 或 Codex `read-only + on-request`。临时全权限会映射到 Claude `bypassPermissions` 或 Codex `danger-full-access + never`，且调用入口必须先确认。

## Claude Code 实现

启动计划会为每个 Profile 生成受管理 settings 文件：

```text
app-data/claude-runtime/permissions/claude-permissions-<profile-hash>.json
```

启动命令追加：

```text
--settings "<managed-settings-path>"
--permission-mode <mode>
```

生成内容包括：

- `permissions.deny`：根据通用保护开关写入 env/key 读限制、`git push` 限制、危险删除限制和禁网相关规则。
- `permissions.additionalDirectories`：来自额外可写目录。
- `sandbox`：在有敏感文件、额外写目录或禁网规则时生成必要的文件系统和网络约束。

Windows 相关保护同时写入 `Bash(...)` 和 `PowerShell(...)` 规则，例如 `PowerShell(git push *)`、`PowerShell(Remove-Item -Recurse *)` 和 `PowerShell(Invoke-WebRequest *)`。

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

## UI 接入点

- `GlobalSettingsPanel`：显示 `Claude Code 默认权限` 与 `Codex 默认权限` 两张卡。
- `ProfileEditForm`：根据当前 provider 显示对应权限卡，支持继承全局或自定义。
- `ProfilesLaunchPanel` 和 `CommandPreview`：显示最终原生权限摘要。
- `LaunchControls`：提供临时只读和临时全权限启动入口。

## 限制

- Claude Code 的 `permissions.deny` 对 Claude 工具调用生效；sandbox 对 shell 命令的隔离能力取决于 Claude Code 当前平台支持。
- Codex 旧 sandbox 配置无法精确表达“workspace 可写但 `.env` 禁读”。当前通过 `shell_environment_policy` 降低环境变量泄漏风险，通过 managed rules 阻止高风险命令。
- Codex rules 是命令前缀规则，能覆盖常见直接命令；复杂 shell/PowerShell 包装仍建议后续增加 hooks 或 beta permission profiles。
- 当前不提供任意命令规则编辑器，也不提供专家 JSON/TOML 手写编辑。

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
