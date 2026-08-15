# Agent Bridge 持续会话修复与辩论端到端测试

## Goal

修复 Codex 委托轮次结束或被 Esc 中断后 Agent Bridge 状态无法恢复的问题，并提供显式的单层编排入口：根调用者通过 CodeDeck 创建可控父会话 A，A 再启动、持续操控可见委托会话 B，由两者自主分工完成一场结构化辩论，同时保留足够的会话与阶段证据用于人工复核。

## In Scope

- 根调用者通过 Agent Bridge 显式创建可编排、受监控且可继续控制的父会话 A。
- 由 A 通过 CodeDeck Agent Bridge 启动可见的委托会话 B，而不是使用当前 Codex 会话的原生子代理代替产品功能。
- 编排权限只开放一层：A 可以创建一个绑定子会话 B；B 仍按受委托会话运行，不能继续创建 C。
- 修复终端已经回到输入提示但桥接任务仍停留在 `running`、后续 `continue` 返回 `session_busy` 的状态同步问题。
- Codex 正常完成、交互式提示和 Esc 中断必须产生一致且幂等的任务状态转换；中断不关闭终端、不销毁 session。
- B 使用 `continuous` 回传策略；A 能在 B 完成单轮回复后继续向同一会话发送后续指令，而 B 不因启动它的单轮回复结束而关闭。
- 修复后的端到端复测使用 `codex::星辰·AI` Profile、`gpt-5.6-terra` 模型和 `low` 思考程度。
- A 与 B 自主决定正反方分工，并围绕“AI 编程助手是否应该被允许自主启动其他代理”完成前期准备。
- 辩论按五个阶段进行：立论、质询、驳论、自由辩论、总结陈词。
- A 负责推进阶段、读取 B 的回传，并结合 B 的意见继续作答；测试过程中保留 A、B 的会话标识、关键阶段输出和最终状态。
- 在用户级 `~/.codex/skills/codedeck-agent-bridge` 提供 Agent Bridge Skill，说明启动、监控、续接、回传策略、单层编排和 Esc 中断接口；项目内不保留副本或发现入口。
- Skill 不自动处理任何目录信任页；所有 `awaiting_input.question` 必须原样报告给用户并等待明确指示。

## Out of Scope

- 不允许 B 再启动第三个委托会话 C；受委托子会话仍必须返回 `recursive_delegation`。
- 不移除 Agent Bridge 的父终端身份校验；只为显式编排父会话 A 开放单层委托能力。
- 不修改已保存的 Profile；模型和思考程度通过单次启动覆盖传入。
- 不以原生 Codex `spawn_agent` 或其他框架代理模拟 CodeDeck Agent Bridge。
- 不执行浏览器登录、签到、提交表单或其他与本次辩论测试无关的外部操作。

## Acceptance Criteria

- [ ] 根调用者可通过 CodeDeck 创建可识别的编排父会话 A，以及由 A 启动的可见委托会话 B。
- [ ] A 能创建 B，但 B 创建 C 仍返回 `recursive_delegation`；同一 A 同时只能绑定一个运行中的 B。
- [x] 记录 A、B 的会话标识和使用的 Profile；若界面或 API 可观察模型与思考程度，也一并记录。
- [ ] Codex 正常完成或被 Esc 中断后，桥接状态离开 `running`，同一 session 可接受下一次 `continue`。
- [ ] `interrupt` 对忙碌会话只发送一次 Esc；对空闲会话返回 `session_idle`，并且两种情况都不关闭终端。
- [ ] B 以 `continuous` 策略运行，并在至少两个分离的控制指令之间保持同一会话可继续交互。
- [ ] 复测 A、B 均使用 `codex::星辰·AI`、`gpt-5.6-terra`、`low`，且不改写保存的 Profile。
- [ ] A 与 B 分别完成正反方前期准备，并自主确认分工。
- [ ] 立论、质询、驳论、自由辩论、总结陈词五个阶段均有来自 A、B 的可复核输出。
- [ ] A 至少一次明确读取并回应 B 的观点，证明持续回传参与了后续决策。
- [ ] 测试结束时记录 A、B 的最终状态；正常完成后会话历史仍可见且可恢复/查看。
- [x] 若测试失败，记录实际失败阶段、错误码或界面状态，不通过读取加密配置或绕过权限来制造成功结果。
- [x] 用户级 `~/.codex/skills/codedeck-agent-bridge` 通过 Skill 校验，且接口文档覆盖 `profiles`、`run`、`continue`、`status`、`wait`、`interrupt`、`cancel`、`policy` 和 `interrupt-parent`。
- [ ] 启用全局能力继承后，新 CodeDeck Codex 会话可发现 `$codedeck-agent-bridge`，且启动时不出现目录信任页。

## Notes

- 这里的“三辩”是传统辩论队伍中的一个角色，不是辩论轮数。两个 AI 会话各自代表一方，用五阶段流程覆盖主要赛制环节。
- 本任务包含完成真实 A→B 单层编排所需的协议、CLI、主进程与任务管理实现。
