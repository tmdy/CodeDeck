# 单层 Agent Bridge 编排设计

## 目标链路

```text
根调用者 -> run --orchestrator -> A（可编排受监控会话）
                                -> run/continue -> B（受委托会话）
                                <- continuous 回传
                                -> A 自动进入下一轮并决定是否继续 B
```

根调用者继续通过 A 的 Agent Bridge `session_id` 查询、续接或 Esc 中断 A。A 通过自己的受监控终端身份令牌创建和控制 B。B 使用作用域凭据，只能修改自身回传策略或对 A 发送一次 Esc，不能创建 C 或控制其他会话。

## 协议与 CLI

- `run` 新增布尔字段 `orchestrator`，CLI 和 PowerShell 包装器提供 `--orchestrator` / `-Orchestrator`。
- `orchestrator` 仅允许根调用者使用；带父终端上下文的 `run` 不得再创建编排父会话。
- 响应保持现有结构，避免引入第二套会话控制协议。
- 模型和思考程度仍是单次 `run` 覆盖，不持久化到 Profile。

## 任务与终端边界

- 编排父会话 A 仍由 `AgentTaskManager` 跟踪，因此根调用者可使用现有 `status`、`wait`、`continue`、`interrupt` 和 `cancel`。
- 启动 A 时不注入 `CODEDECK_DELEGATED=1`，但保留普通受监控终端的 `CODEDECK_TERMINAL_SESSION_ID` 与 `CODEDECK_TERMINAL_PARENT_TOKEN`。
- `AgentTaskManager` 仅在目标终端属于显式编排任务且父令牌有效时，允许它作为 B 的父会话。
- A 同时最多绑定一个仍存活的 B；已有 B 终端未关闭时再次 `run` 返回稳定错误。
- B 继续注入 `CODEDECK_DELEGATED=1` 与作用域回调令牌，因此递归创建 C 仍返回 `recursive_delegation`。

## 回传与中断

- B 的 `continuous` 完成结果按现有队列注入 A；A 空闲时送达并触发 A 新一轮。
- A 可用同一 B `session_id` 多次 `continue`，B 单轮结束不关闭终端。
- A 可 Esc 中断 B；B 可通过 `interrupt-parent` Esc 中断 A。中断只影响当前轮次，不关闭任一终端。
- 正常完成、提示符兜底和 Esc 后完成都必须幂等地离开 `running`。

## 验证

- 协议解析、CLI 参数、主进程启动环境和任务管理边界均需单元测试。
- 全量测试、TypeScript 检查、Electron 构建和 `git diff --check` 必须通过。
- 最终 E2E 使用 `codex::星辰·AI / gpt-5.6-terra / low`，由根调用者创建 A，再由 A 创建 B，完整完成五阶段辩论。
