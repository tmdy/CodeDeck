# 全局权限管理实现指南

## 核心模块

- `src/shared/profile/permissions.ts`：权限预设、通用保护、规范化、优先级解析、Claude/Codex 映射和摘要。
- `src/shared/profile/types.ts`：`Profile.permissions` 和 `GlobalSettings.permissions` 数据入口，读取旧 `permissions_preset` 时迁移。
- `src/shared/services/launch-service.ts`：启动计划中解析最终权限，注入 Claude 参数和 Codex `config.toml`。
- `src/components/permissions/PermissionSettingsCard.tsx`：全局设置和 Profile 表单复用的权限控件。

## 数据模型

`ProfilePermissions` 包含：

- `preset`: `readonly | safe | auto_edit | strict_whitelist | full_access`
- `common`: 通用保护开关
- `claude`: provider 专属扩展占位
- `codex`: provider 专属扩展占位
- `fullAccessConfirmed`: 全权限确认标志

Profile 级权限可为空，表示继承全局默认。全局默认通过 `defaultGlobalSettings().permissions` 初始化。

## 迁移策略

旧 `global_settings.permissions_preset` 在 `normalizeGlobalSettings()` 中映射为新 `permissions.preset`。例如 `全部允许（推荐）` 映射为 `safe`。保存 local state 时只写 `permissions`，不再写旧字段。

旧 Profile 没有 `permissions` 字段时不补写，运行时通过 `resolveEffectivePermissions()` 自动继承全局默认。

## 启动链路

`LaunchRequest.permission_override` 可传入临时预设。`LaunchService.buildPlan()` 按临时覆盖、Profile、全局默认的顺序解析。若最终预设为未确认的 `full_access`，返回 invalid plan。

Claude 使用数组参数注入 `--permission-mode`。Codex 在配置文件顶层写入 `sandbox_mode`、`approval_policy`、`web_search`，在 workspace-write 模式下写入 `[sandbox_workspace_write]`。

## UI 接入点

- `GlobalSettingsPanel`：显示默认权限卡片，直接保存到 `global_settings.permissions`。
- `ProfileEditForm`：显示权限卡片，支持“继承全局/自定义”。继承时 draft 权限为 `null`，保存 Profile 时不写 `permissions`。
- `ProfilesLaunchPanel` 和 `CommandPreview`：显示最终权限摘要。
- `LaunchControls`：提供“临时只读”和“临时全权限”启动入口，临时全权限需要确认。

## 测试清单

必须覆盖：

- 旧全局权限字段迁移。
- Profile 权限缺失时继承全局默认。
- 临时覆盖优先于 Profile 和全局。
- Claude 5 个预设生成正确 `--permission-mode`。
- Codex 5 个预设生成正确 sandbox 和 approval。
- `allowNetwork = false` 写入 Codex 网络配置。
- Profile 保存和克隆复制权限结构。
- 全局设置页、Profile 表单和启动区域显示权限控件与摘要。

测试只验证生成的 args、config、preview 和组件行为，不启动真实 Claude/Codex CLI。
