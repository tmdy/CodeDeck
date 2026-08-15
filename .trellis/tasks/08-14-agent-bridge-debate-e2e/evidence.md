# Agent Bridge 辩论端到端测试证据

## 结论

本轮测试未通过完整验收。两个可见 Codex 会话均能启动、选择不同 Profile/模型并完成前期准备，`interrupt` 也确实向终端产生了 Esc 中断效果；但桥接任务状态没有在终端回到输入提示后从 `running` 收敛为空闲，导致同一 session 的后续 `continue` 永久返回 `session_busy`。因此不能在不伪造结果的前提下推进五阶段辩论。

## 环境与会话

测试时间：2026-08-14（Asia/Shanghai）

| 角色 | Agent Bridge session ID | Profile | 模型 | 思考程度 | 回传策略 | 最终桥接状态 |
| --- | --- | --- | --- | --- | --- | --- |
| A | `780dbee5-0d33-4577-8d9c-7bab206d23d8` | `codex::星辰·AI` | `gpt-5.6-sol` | `high` | `manual` | `running`（终端已显示输入提示） |
| B | `504ad4bc-ce6e-4618-8fb8-ab2a1868b461` | `codex::999Code` | `gpt-5.6-terra` | `high` | `manual` | `running`（终端已显示输入提示） |

`profiles` 在测试末尾返回容量 `2/4`。Windows 进程列表中仍存在 CodeDeck 窗口和标题为 `CodeDeck` 的 Windows Terminal，未取消或关闭两个会话。

## 已验证行为

1. 两个会话分别使用 `gpt-5.6-sol/high` 与 `gpt-5.6-terra/high` 启动，模型和思考程度选择已生效。
2. A、B 均完成前期思考，并自主倾向“允许但必须严格受控”立场。为形成对立，原计划保留 A 为正方、让 B 承担反方。
3. B 的准备意见包括权限边界、代理数量、资源预算、沙箱、审批、审计、一键终止和禁止递归扩张。
4. A 的准备意见认为正方最强点是并行分解、专业化与独立复核，反方最强点是权限、成本、提示注入和责任风险。
5. `interrupt` 命令对 A 产生终端文本 `Conversation interrupted`，对 B 产生 `esc again to edit previous message`，证明 Esc 控制信号到达终端，且 session ID 未被销毁。

## 阻塞证据

从非监控根会话请求自动回传时返回：

```json
{
  "code": "invalid_parent",
  "message": "自动回传策略必须绑定受监控父终端。"
}
```

因此本轮无法真实建立 A 作为受监控父终端、B 以 `continuous` 回传的链路，只能改用 `manual` 控制。

在终端已经输出准备结果并回到输入提示后，Agent Bridge 的 `status` 和 `wait` 仍持续返回 `running`。发送第一阶段立论指令时返回：

```json
{
  "code": "session_busy",
  "message": "代理会话仍在处理上一轮输入。",
  "retryable": true
}
```

调用 `interrupt` 后等待 10 秒仍不收敛，重复 `continue` 仍被 `session_busy` 拒绝。可见终端状态与 `AgentTaskManager` 状态发生分离，疑似没有收到或识别 `turn_completed` 活动事件。

## 未达成项

- A 不是本轮环境中的普通受监控父会话，两个任务响应的 `parent_session_id` 均为 `null`。
- B 未能使用 `continuous` 自动回传。
- 无法验证同一 session 在两个独立业务指令间持续交互。
- 立论、质询、驳论、自由辩论、总结陈词五阶段均未开始，不将前期准备冒充正式阶段输出。
- 未获得 A 递归启动 B 返回 `recursive_delegation` 的可复核响应文本。

## 建议复测入口

先修复或定位终端活动检测：当 Codex 结束输出、被 Esc 中断并重新出现输入提示时，应触发 `turn_completed`，将任务状态从 `running` 置为可继续状态。修复后复用本 PRD 的同一五阶段流程复测，并从真实受监控父终端创建 `continuous` 子会话。

## 第二次实测：单层编排已建立，但长输入未提交

测试时间：2026-08-14 13:50-13:58（Asia/Shanghai）

| 角色 | Agent Bridge session ID | Profile | 单次模型覆盖 | 思考程度 | 回传策略 | 观察结果 |
| --- | --- | --- | --- | --- | --- | --- |
| A | `66e9a1dc-9284-4234-bfaf-5dbdb4f51870` | `codex::星辰·AI` | `gpt-5.6-terra` | `low` | `manual` | orchestrator 成功启动并创建 B |
| B | `401ab722-85b9-498d-a42a-a674f29c73fa` | `codex::星辰·AI` | `gpt-5.6-terra` | `low` | `continuous` | 绑定 A 的终端并保持可见 |

已确认 A 不是模拟代理：A 通过 CodeDeck Bridge 创建了真实 B，B 响应包含非空 `parent_session_id`，且两个独立 `codex.exe` 进程的命令行均显示 `model_reasoning_effort=low`。保存的 Profile 模型仍为 `gpt-5.6-sol`，证明 `gpt-5.6-terra` 是单次覆盖。

本轮在处理首次目录信任提示后暴露新的输入链路问题。根调用者向 A 发送较长的恢复指令后，终端截图显示完整文本已经进入 A 的编辑区，但没有被提交；底部仍是输入光标，而不是 `Working`。Agent Bridge 同时错误报告 `running`，一次 Esc 后也没有产生轮次完成事件。B 因而仍停在自己的信任提示，五阶段未开始。

根因范围收敛为：多行括号粘贴结束后固定 25ms 的 Enter 延迟过短；终端活动管理器忽略 `busy_output`；旧交互提示重绘可能重新污染 `awaiting_input`；受跟踪 orchestrator 接收自动回传时没有建立新轮次号。以上问题进入下一轮代码修复和复测，不把本轮标记为通过。

## 本地 Agent Bridge Skill 与真实发现测试

新增 Skill 源码：

```text
.codex/skills/codedeck-agent-bridge/
  SKILL.md
  agents/openai.yaml
  references/protocol.md
```

仓库级 Codex 只从 `.agents/skills` 发现项目 Skill，因此 `.agents/skills/codedeck-agent-bridge` 使用 Windows Junction 指向上述唯一源码目录，避免维护两份内容。

Skill 覆盖完整桥接命令、模型与思考程度单次覆盖、A→B 单层编排、持续回传、状态读取和 Esc 中断。它明确记录：CodeDeck 虽为 Codex 追加 `--disable hooks`，首次目录信任页仍可能出现；仅当页面目录等于预期 `cwd` 时，通过同一 session 提交：

```powershell
"1" | & $agentCli continue --session $sessionId --wait-ms 0
```

真实新 Codex 会话发现测试：

| 字段 | 结果 |
| --- | --- |
| session ID | `e65f1514-ee3d-44d0-b1c0-97080b0f192d` |
| Profile | `codex::星辰·AI` |
| 模型 / 思考程度 | `gpt-5.6-terra` / `low` |
| 首次页面 | 预期 `D:/CodeDeck` 目录信任确认 |
| 同 session 提交 | `1. Yes, continue` |
| 最终终端输出 | `FOUND` |

验证结果：Skill 源路径与 Junction 发现路径均通过 `quick_validate.py`；`npm run typecheck` 通过；Vitest 共 `93` 个文件、`910` 个测试通过。
