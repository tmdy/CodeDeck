# Agent Bridge 主动父会话控制执行计划

## Implementation

- [x] 审核创建任务前遗留的局部实现差异，确认没有越过 scoped 权限边界。
- [x] 完成 `AgentScopedRequest`、协议解析和服务端路由的 `status_parent` / `continue_parent` 支持。
- [x] 在任务管理器中复用现有轮次与终端输入逻辑，实现父状态读取和主动续接。
- [x] 更新 CLI：`status-parent` 无参数；`continue-parent` 只从 stdin 读取 prompt；未知参数立即拒绝。
- [x] 保持 `interrupt-parent`、递归委托限制和自动回传策略兼容。
- [x] 更新项目 Skill、随包 Skill、协议参考和调用脚本，明确主动控制与自动回传的区别。
- [x] 增加协议、CLI、任务管理器和服务端回归测试。

## Verification

- [ ] 运行 Agent Bridge 聚焦测试。
- [x] 运行 `npm run typecheck`。
- [ ] 运行 `npm test`。
- [x] 运行 `npm run build:electron`。
- [ ] 运行两个 Skill 路径的 `quick_validate.py`。
- [x] 打包新的 Windows dir 版本，启动后确认命令行继续追加 `--disable hooks`。
- [x] 从零执行 A/B 主动控制五阶段辩论，记录 session、状态、关键输出和失败点。

## Risk And Rollback Points

- 父会话输入必须经过现有串行化与 idle gate，否则会和 A 当前输出交错。
- `status-parent` 不得泄露任意终端或其他任务信息。
- 主动发送与 `continuous` 同时启用会造成重复输入；E2E 必须使用 `manual`，文档需明确该约束。
- 打包和重启前先完成单元测试；不要覆盖仍在运行的旧目录包。
