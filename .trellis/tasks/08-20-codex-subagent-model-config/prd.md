# 实现 Codex 子代理模型配置

## Goal

让 Codex Profile 可以像“模型配置”一样配置子代理模型和子代理思考等级，并在启动该 Profile 时通过 Codex CLI 的 `-c` 参数生效；配置只作用于本次启动的 Codex 进程，不写入用户全局 Worker Agent 或全局 `config.toml`。

## Confirmed facts

- `Profile.advancedModelMapping.codex.subagentTarget`、主模型 `codex.reasoningEffort`、Profile 草稿持久化和命令预览链路已经存在。
- `ProfileEditForm` 当前把 Codex 子代理卡片硬编码为禁用状态。
- `LaunchService` 当前会生成主模型思考等级参数，但不会生成 `agents.default_subagent_model` 或 `agents.default_subagent_reasoning_effort`。
- Codex 命令已经统一经过 `buildCodexArgs` / `buildCodexCommand`，可复用现有参数解析和预览逻辑。
- 工作树存在另一会话的未提交改动；本任务不得覆盖或纳入这些改动。

## Requirements

- R1. Codex Profile 的“Codex 子代理模型映射”卡片恢复可用，包含启用开关、子代理模型 ID 和子代理思考等级；控件样式和交互沿用“模型配置”。
- R2. 子代理思考等级使用现有 Codex 合法等级集合，并与主模型思考等级独立保存。
- R3. 启用映射且填写值时，managed/native Codex 启动命令分别按值追加：
  - `-c agents.default_subagent_model=<model>`
  - `-c agents.default_subagent_reasoning_effort=<effort>`
- R4. 未启用映射时，不追加上述子代理参数；主模型模型 ID、主模型思考等级和现有权限/Provider 参数保持原行为。
- R5. 配置通过现有 Profile 标准化、草稿比较和保存链路持久化，重载后值不丢失。
- R6. 仅修改本功能直接相关文件；保留并行会话的已有工作树改动。

## Acceptance Criteria

- [ ] Codex Profile 页面显示可操作的启用开关、子代理模型输入框和子代理思考等级选择框；禁用时输入控件不可编辑。
- [ ] 启用并填写 `gpt-5.6-sol` / `high` 后，命令预览和实际启动计划包含对应的两个 `-c` 参数。
- [ ] 关闭开关后，命令预览和实际启动计划不包含 `agents.default_subagent_*` 参数。
- [ ] 子代理思考等级与主模型思考等级可分别设置，互不覆盖。
- [ ] 保存后重新构造 Profile 草稿，子代理模型和思考等级保持一致。
- [ ] 不修改、不提交另一会话当前已修改的文件。

## Out of scope

- 不改写用户全局 Codex `config.toml`、全局 Worker Agent 或其他 Profile。
- 不新增模型列表获取、模型 ID 校验或 Codex CLI 版本探测。
- 不修改 Claude 模型兼容逻辑、权限逻辑或无关 UI。
- 按用户要求，本轮不运行最终测试套件；完成后仅报告未执行的验证。

## Open questions

无阻塞问题。实现采用现有字段/组件模式和现有 Codex 命令构建链路。
