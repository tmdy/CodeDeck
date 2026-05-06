# 全局权限管理规格

## 目标

权限管理由软件统一翻译为 Claude 和 Codex 的底层参数，用户不需要手写 JSON、TOML 或 CLI 权限参数。普通用户只选择权限预设；高级用户首版可调整通用保护开关。

## 首版范围

首版实现 5 个预设和通用保护开关：

- `readonly`：只读/规划优先。
- `safe`：默认安全模式，允许工作区内编辑，敏感操作需要确认。
- `auto_edit`：自动接受普通编辑，保留通用保护。
- `strict_whitelist`：严格白名单，不进行交互确认。
- `full_access`：全权限危险模式，保存或临时启动前必须确认。

通用保护开关包括：禁读 env/key 文件、禁止 git push、禁止危险删除、允许联网、额外可写目录。首版不提供任意命令规则编辑器，也不提供专家 JSON/TOML 手写编辑。

## 优先级

权限解析优先级固定为：

```text
本次启动临时覆盖 > Profile 权限覆盖 > 全局默认权限
```

Profile 未设置权限时继承全局默认权限。临时覆盖只影响本次启动，不写回 Profile 或 local_state。

## 数据位置

Profile 权限保存在加密 Profile 配置中，随 Profile 保存、重命名和克隆迁移。全局默认权限保存在 `local_state` 的 `global_settings.permissions`。旧字段 `permissions_preset` 仅用于读取迁移，保存时写入新结构。

## Provider 映射

Claude 预设映射：

- `readonly` -> `--permission-mode plan`
- `safe` -> `--permission-mode default`
- `auto_edit` -> `--permission-mode acceptEdits`
- `strict_whitelist` -> `--permission-mode dontAsk`
- `full_access` -> `--permission-mode bypassPermissions`

Codex 预设映射：

- `readonly` -> `sandbox_mode = "read-only"`, `approval_policy = "on-request"`
- `safe` -> `sandbox_mode = "workspace-write"`, `approval_policy = "on-request"`
- `auto_edit` -> `sandbox_mode = "workspace-write"`, `approval_policy = "untrusted"`
- `strict_whitelist` -> `sandbox_mode = "read-only"`, `approval_policy = "never"`
- `full_access` -> `sandbox_mode = "danger-full-access"`, `approval_policy = "never"`

Codex 还会写入 `web_search` 和 `[sandbox_workspace_write] network_access/writable_roots`。`allowNetwork = false` 时写入 `network_access = false` 和 `web_search = false`。

## 危险模式确认

`full_access` 必须二次确认。未确认的 Profile 或全局权限不能用于启动；临时全权限启动也必须在 UI 中确认后才发起请求。确认状态保存在权限结构的 `fullAccessConfirmed` 字段中。

## 后续扩展边界

阶段二之后可扩展 Claude allow/ask/deny tag 输入、Codex 命令规则、专家模式预览/编辑和更完整的 provider 专属规则合并。首版遇到用户自定义 Claude `runtime.settings_file` 时不覆盖用户文件，后续可做合并预览与冲突提示。
