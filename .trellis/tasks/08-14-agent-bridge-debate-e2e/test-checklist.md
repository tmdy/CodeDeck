# CodeDeck Agent Bridge / gpt-5.6-luna 测试清单

日期：2026-09-02（Asia/Shanghai）

## 目标与边界

本清单验证四件事：

1. 外部 Skill 能否通过 CodeDeck 的本地桥接接口启动真实的 Codex Profile。
2. `gpt-5.6-luna` 的单次模型覆盖是否真正到达 Codex，而不是只出现在请求回显中。
3. `status` / `wait` / `continue` / `interrupt` 看到的状态是否与可见终端和 provider 会话一致。
4. Skill 是否能在异常、交互提示和 A→B 协作场景下给出可执行且不越权的下一步。

本轮不读取加密配置、不拼接 named-pipe 协议、不修改保存的 Profile，不自动回答未知确认页，不进行外部网站写操作。所有真实会话使用无副作用的只读提示，并在结束后显式取消或保留可复核状态。

## 证据格式

每个测试至少记录：

- 测试 ID、时间、CodeDeck 进程 PID、CLI 的绝对路径；
- `profiles` 返回的安全摘要和容量；
- `session_id`、Profile key、provider、请求模型/思考等级/回传策略、`cwd`；
- 原始结构化响应中的 `status`、`assistant_text`、`question`、`error`、`parent_session_id`、`delivery_status`；
- 对应时刻的 `terminal_tail`、可见终端活动和 provider session identity；
- 结论：通过、失败、未执行或证据不足；失败必须保留 code/message/retryable。

`assistant_text` 是结果真相；`terminal_tail` 只作诊断。文件存在、进程存在、终端标题或一次 `ok` 都不能单独证明模型轮次已完成。

## P0：环境与传输预检

| ID | 检查 | 预期 |
| --- | --- | --- |
| P0.1 | CodeDeck 已启动且已解锁 | 可调用 `profiles`，否则记录 `app_unavailable` / `profiles_locked` |
| P0.2 | Agent Bridge 设置已启用 | 未启用时返回 `bridge_disabled`，不重启或改设置 |
| P0.3 | 使用注入的 `CODEDECK_AGENT_CLI`，否则使用当前安装包旁的 wrapper | CLI 与当前 CodeDeck 实例属于同一版本/目录 |
| P0.4 | 读取 CLI 自动发现的连接记录 | 只验证 `protocol_version`、pipe 名非空、PID、创建时间；不输出 token |
| P0.5 | 验证传输类型 | Windows 下应是 `\\\\.\\pipe\\codedeck-agent-*`；这是本地 named pipe，不是可供局域网访问的 TCP 端口 |
| P0.6 | `profiles` | 返回可用 Profile 安全摘要、模型名和容量，不含 token/cookie |
| P0.7 | 容量边界 | 记录已有运行任务；任何新建任务前确认不会无意挤掉用户会话 |

## P1：Skill 发现与调用说明

| ID | 检查 | 预期 |
| --- | --- | --- |
| P1.1 | 源 Skill 存在并通过校验 | `.codex/skills/codedeck-agent-bridge/SKILL.md` 可读、front matter 有效 |
| P1.2 | fresh Codex 从 `.agents/skills` 发现 Skill | 真实会话能报告 Skill 路径/名称；不依赖旧上下文 |
| P1.3 | Skill 明确 transport 与发现方式 | 文档说明“连接文件发现 + authenticated named pipe”，不把它称作公共端口 |
| P1.4 | Skill 明确结果真相 | 说明 `assistant_text`、`question`、`error`、`terminal_tail` 的权威级别 |
| P1.5 | Skill 明确轮询策略 | 给出初次短轮询、随后退避、最大等待、超时后的保留 session 行为 |
| P1.6 | Skill 明确模型失败处理 | `model_not_found` / provider 错误时报告原码，不擅自改成别的模型并宣称通过 |
| P1.7 | Skill 明确会话 ID纪律 | 所有后续操作复用原 `session_id`；禁止因等待超时新建替代会话 |
| P1.8 | Skill 明确交互边界 | `awaiting_input.question` 原样上报；只有用户明确回答才 `continue` |

## P2：最小真实调用与模型覆盖

使用 Profile `codex::星辰·AI`、`cwd=D:/CodeDeck`，模型覆盖 `gpt-5.6-luna`，思考等级先用 `low`，回传策略 `manual`，`wait_ms=0`，提示词只要求输出唯一标记和当前工作目录。

| ID | 检查 | 预期 |
| --- | --- | --- |
| P2.1 | `run` 最小调用 | 返回合法 JSON；保留 `session_id`，不因 `wait_ms=0` 把 `running` 当失败 |
| P2.2 | 启动参数证据 | 进程/任务记录显示 Profile、provider、模型覆盖和思考等级；保存的 Profile 不变 |
| P2.3 | provider 可用性 | 最终 `completed` 且 `assistant_text` 含预期标记；若返回 `model_not_found`，记录为模型不可用 |
| P2.4 | 输出一致性 | `assistant_text` 与终端可见内容语义一致；不以截断的 `terminal_tail` 代替答案 |
| P2.5 | 计时 | 记录启动、首次状态、完成时间；区分 provider 慢、桥接超时和终端检测迟滞 |
| P2.6 | Profile 不变 | 前后比较 Profile 的模型、provider、思考等级和其它字段；不能发生持久化变化 |

## P3：监控状态与完成判定

对 P2.1 返回的同一个 `session_id` 执行，不新建会话。

| ID | 检查 | 预期 |
| --- | --- | --- |
| P3.1 | 立即 `status` | `starting` / `running` 是正常中间态；包含同一 session ID |
| P3.2 | `wait` | 在指定窗口内返回状态；超时只表示本次等待结束，不销毁任务 |
| P3.3 | 状态序列 | 记录 `starting → running → completed`（或明确的 `awaiting_input` / `failed` / `cancelled`） |
| P3.4 | 空闲提示符误判 | 启动初始 placeholder、旧 scrollback 或交互提示 glyph 不能直接完成当前轮 |
| P3.5 | 当前轮 busy 证据 | `submitted_input` / `busy_output` / `turn_started` 与当前轮关联；旧轮 `Working` 不阻塞新轮 |
| P3.6 | lifecycle 缺失回退 | 有当前轮 busy 证据后，允许 evidence-gated `idle_prompt` 完成；无 busy 证据时保持运行 |
| P3.7 | provider session identity | 只关联 first prompt 与 `cwd`/provider 均匹配的 session；同 cwd 但 prompt 不同的候选保持 pending |
| P3.8 | 完成权威 | 只有 `completed + assistant_text` 才报告业务完成；`running + 终端看似回到提示符` 只能报告监控未收敛 |
| P3.9 | 重复事件幂等 | 重复 `turn_completed` / `idle_prompt` 不重复读取、重复投递或覆盖答案 |
| P3.10 | 监控延迟 | 对比终端返回 prompt、provider JSONL 完成和 Bridge 状态更新时间，定位滞后来源 |

## P4：同一会话续接与多轮

| ID | 检查 | 预期 |
| --- | --- | --- |
| P4.1 | `continue` 原 session | 返回同一 `session_id`，状态回到 `running` 或明确 awaiting |
| P4.2 | 上下文保持 | 第二轮能引用第一轮设置的无副作用标记，证明不是新会话 |
| P4.3 | 二轮完成 | 获得新的 `assistant_text`，不复用第一轮答案 |
| P4.4 | 快速重复 continue | 忙时返回 retryable `session_busy`，不把两段输入交错写入终端 |
| P4.5 | 等待超时后继续 | `wait` 客户端超时不改变服务端任务；确认原 session 仍可查询/续接 |
| P4.6 | 回传策略 | `manual` 保留结果、不自动注入；`once` 成功投递后转 `manual`；`continuous` 每轮排队且不重复 |

## P5：交互输入与信任页

使用单独的、可取消的测试会话；不得自动接受未知权限或目录。

| ID | 检查 | 预期 |
| --- | --- | --- |
| P5.1 | 真实 `awaiting_input` | 返回 `question`，状态不是 completed；原样保留问题文本 |
| P5.2 | 未知问题 | Skill 停止并请求用户指示，不提交猜测答案 |
| P5.3 | 精确目录信任兼容 | 只有显示目录与请求 `cwd` 完全一致时，才可在同一 session 由用户明确提交 `1` |
| P5.4 | 错目录/错问题 | 拒绝自动继续，返回或报告需要人工确认 |
| P5.5 | 交互响应生命周期 | 响应的 `submitted_input` 不单独算模型轮 busy；等 resumed model turn 的 busy/lifecycle 证据 |
| P5.6 | 交互后完成 | 不把尾部 `›` / `(y/n)` 当 idle completion，不提前触发父回传 |

## P6：中断、取消和终端存活

| ID | 检查 | 预期 |
| --- | --- | --- |
| P6.1 | 忙碌 `interrupt` | 只发送一次 ESC；当前轮结束/失败可解释，终端和 session 仍存活 |
| P6.2 | 中断后状态 | 不长时间卡在 `running`；若 lifecycle 缺失，使用有中断标记的受限回退 |
| P6.3 | 中断后续接 | 同一 session 可在空闲后 `continue`，且不重放上一轮答案 |
| P6.4 | 空闲 `interrupt` | 返回 `session_idle`，不伪称中断成功 |
| P6.5 | `cancel` | 明确结束任务并关闭终端；与 ESC 语义区分 |
| P6.6 | 停止目标 | 返回 `session_not_running`；不向未知 PID/终端发送输入 |

## P7：A→B 受限协作

主动协作使用 `manual`，避免与 `continuous` 自动回传重复。

| ID | 检查 | 预期 |
| --- | --- | --- |
| P7.1 | 根 `run --orchestrator` 创建 A | A 有可监控 session，未标记 delegated |
| P7.2 | A 创建 B | B 绑定 A，保留 B session ID；模型/思考等级为本次指定值 |
| P7.3 | B `status-parent` | 只返回服务端绑定的 A，不接受目标 ID |
| P7.4 | B `continue-parent` | A 空闲时启动 A 下一轮；A 忙时返回 retryable `session_busy`，不写入 |
| P7.5 | B `interrupt-parent` | 对忙 A 发一次 ESC；对空闲 A 返回 `session_idle` |
| P7.6 | B 全局越权 | `profiles` / `run` / 任意 session 控制返回 `recursive_delegation` 或 `unauthorized` |
| P7.7 | B 创建 C | 返回 `recursive_delegation`，没有第三个终端 |
| P7.8 | A 第二个 B | 返回 retryable `child_already_bound`，不产生竞态终端 |
| P7.9 | 多阶段证据 | 每阶段记录 A/B 输出、控制命令、状态和 session ID，不用摘要冒充原始结果 |

## P8：错误、安全和边界

| ID | 检查 | 预期 |
| --- | --- | --- |
| P8.1 | 不存在 Profile | `profile_not_found` |
| P8.2 | 黑名单 Profile | `profile_blocked` |
| P8.3 | 不存在 cwd | `invalid_cwd` |
| P8.4 | 无父上下文使用自动策略 | `invalid_parent` |
| P8.5 | 错父 token/session | `unauthorized` / `invalid_parent` |
| P8.6 | 并发上限 | `capacity_exceeded`，retryable 语义正确 |
| P8.7 | 非法模型/思考等级 | 在启动前或 provider 返回明确原始错误，不静默降级 |
| P8.8 | 缺失/损坏连接文件 | `app_unavailable` / `protocol_mismatch`，stdout 不泄露 token |
| P8.9 | 非法 scoped 命令/参数 | 本地 CLI 拒绝或服务端 `unauthorized`，不发送实际控制请求 |
| P8.10 | 日志与响应脱敏 | 不出现连接 token、provider token、Cookie 或完整秘密 |

## P9：Skill 质量回归

| ID | 检查 | 预期 |
| --- | --- | --- |
| P9.1 | 命令示例可复制 | PowerShell stdin、路径、中文 Profile key 和 JSON 结果示例可直接改值使用 |
| P9.2 | 不混淆 wrapper 与协议 | Skill 只调用 wrapper/CLI，不让模型自己读取连接文件或拼 pipe JSON |
| P9.3 | 续接模板完整 | 每次模板都携带原 session ID，并说明 wait/continue 的边界 |
| P9.4 | 监控循环可执行 | 有状态终止集合、退避上限、超时处理和最后一次 status |
| P9.5 | 失败交接完整 | 返回 session ID、错误 code、retryable、terminal_tail 和下一步，而不是泛化为“调用失败” |
| P9.6 | 用户确认门 | 目录信任、权限、外部写入、取消/关闭等不可逆动作明确停下 |
| P9.7 | A/B 语义不冲突 | 明确 `continuous` 自动回传与 `manual + continue-parent` 不能混用 |

## P10：完成判定

测试只能按以下规则收口：

- “调用成功”：桥接响应合法、任务有 session ID，且最终有明确结果或明确 awaiting/error；不能只凭 CLI 进程退出码。
- “模型可用”：指定的 `gpt-5.6-luna` 在 provider 真实完成一轮，并有模型/进程/响应三方证据；`model_not_found` 就是未通过。
- “监控正确”：状态序列、终端活动、provider lifecycle/session identity 能对齐；若只剩终端标题或文件存在，结论为证据不足。
- “会话可持续”：同一 session 至少完成两轮，第二轮不是新建任务，且无 stale answer / duplicate delivery。
- “中断正确”：只发一次 ESC、终端仍活、状态收敛、原 session 可继续；`cancel` 单独验证为关闭语义。
- “Skill 可交付”：新会话能发现它，按文档能完成 P2/P3/P4，遇到 P5/P8 能停在正确边界。

任何一项出现 token 泄露、向错误 session 写入、未知确认自动通过、重复提交或无法区分真实完成，立即停止该分支并保留证据，不覆盖、不重试造成第二个会话。

## 单次会话记录模板

```text
TEST_ID:
STARTED_AT:
CODEDECK_PID:
CLI_PATH:
CONNECTION_KIND: named_pipe / unavailable
PROFILE:
REQUESTED_MODEL:
REQUESTED_REASONING:
RETURN_POLICY:
CWD:
SESSION_ID:
PARENT_SESSION_ID:
STATUS_TIMELINE:
PROVIDER_SESSION_ID:
TERMINAL_ACTIVITY_TIMELINE:
FINAL_STATUS:
ASSISTANT_TEXT_MARKER:
ERROR_CODE:
RETRYABLE:
DELIVERY_STATUS:
VERDICT:
EVIDENCE_PATHS:
```
