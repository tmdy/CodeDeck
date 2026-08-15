# Agent Bridge 主动父会话控制设计

## Architecture

沿用现有双通道边界：根调用者使用全局 Bridge；受委托 B 只持有随机 scoped token 和 scoped pipe。服务端根据 token 解析 B，再从 B 的任务记录解析唯一 `parentSessionId`。任何 scoped 请求都不接收目标 session ID。

## Commands

```text
status-parent
continue-parent        # prompt from stdin
interrupt-parent
```

对应协议请求：

```typescript
type AgentScopedRequest =
  | { command: "status_parent"; request_id?: string }
  | { command: "continue_parent"; request_id?: string; prompt: string }
  | { command: "interrupt_parent"; request_id?: string };
```

## Data Flow

```text
B CLI -> scoped pipe/token -> resolve B -> resolve bound A
  status_parent   -> A task snapshot
  continue_parent -> validate A idle -> submit prompt -> start A turn
  interrupt_parent-> validate A busy -> one ESC -> interrupted-turn settlement
```

`continue_parent` 必须复用任务管理器已有的输入规范化、括号粘贴、Enter 提交延迟和轮次状态转换，不能建立第二套终端输入实现。

## Error Contract

| Condition | Result |
| --- | --- |
| scoped token 无效 | `unauthorized` |
| B 没有存活的绑定 A | `invalid_parent` 或 `session_not_running` |
| A 当前运行中 | retryable `session_busy` |
| A 等待交互输入 | `awaiting_input` 对应结构化拒绝，不提交业务 prompt |
| prompt 为空 | CLI/协议入口拒绝 |
| scoped 命令携带未知参数 | CLI 拒绝，不发送请求 |
| A 空闲时 interrupt | `session_idle` |

## Compatibility

保留 `manual`、`once`、`continuous`。主动协作使用 `manual`；自动策略仍可供只需要完成结果回传的调用者使用。协议版本保持兼容，仅扩展 scoped request union。

## Security

- B 不获得全局连接文件或 token。
- 服务端从 scoped token 推导父任务，客户端不能替换目标。
- 返回的终端内容遵循现有清理和尾部长度限制。
- B 仍不能 `profiles`、`run`、控制兄弟任务或递归创建 C。

## Rollback

主动命令是增量扩展。若实测失败，可移除 scoped 路由与 CLI 命令而不改变现有自动回传和根 Bridge 命令；已有未提交工作必须按文件逐项审查，不能用破坏性 Git 操作整体回滚。
