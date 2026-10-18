# 监控会话状态、身份与自动继续设计

## 目标与证据

以现有 PTY、TerminalSessionManager 和 JSONL 生命周期监控为基础，修复已复现缺陷。三个现象共享 provider 会话关联和当前回合边界，作为一项集成修复处理。证据见 `research/completion-state.md`、`research/auto-continue.md`、`research/title-sync.md` 与 `research/provider-identity.md`。

用户已在最终方案摘要之后明确批准实施，任务阶段为 in_progress。

## 1. 当前回合状态优先级

- 保持 taskbar 为 manager.activity 的投影，不单独掩盖忙碌状态。
- manager 维护当前回合代次，以及结构化 started / completed / failed 的关联信息。解析事件时保留实际存在的 turn_id 与 timestamp；过时事件不能结束已新提交的回合。
- 成功 / 失败终止当前回合的历史 PTY 证据，清理 detector 的历史片段和待判定 idle fallback，防止旧 Working 重绘重新置 busy。新有效提交或新权威 started 打开下一回合，仍可正常进入 busy。
- 权威完成即使晚于 idle_prompt，也须向消费者提交一次该代次的完成事件；重复 JSONL 记录不得重复通知 / 重复 Bridge 回传。
- 保留无结构化来源时的 250 ms 稳定主提示符 fallback、工作中占位符保护和交互确认排除。不能用任意时间静默代替完成证据。
- 生命周期观察器在异步 I/O 之后重新校验仍为当前 watcher、终端仍 running；保留分块 JSONL 尾行，关闭 / 替换 watcher 后不派发旧事件。

## 2. Provider UUID 绑定与标题同步分离

### 身份来源

- 恢复指定会话优先使用启动计划中的明确 UUID；新建 / resume picker / continue last 使用当前 PTY 自身的身份信号。
- 仅对受监控 Codex 进程追加一次性 `-c tui.terminal_title=["thread-id"]`，通过 Provider builder 同时进入预览与实际启动参数；direct 和 Claude 不注入该参数。原有全局配置、用户 notify 和 status line 不变。
- 同版本源码显示 OSC title 中 UUID 会截断且可附标题生成 spinner；读取 raw PTY 的 OSC 0 / 2 片段时保留跨块状态，严格解析文档化的 UUID / UUID 前缀形式和明确装饰。
- 使用该进程实际 CODEX_HOME，在索引与 session_meta.id 中解析为唯一完整 UUID；同 UUID 的重复记录 / 副本先去重。0 候选或多个候选保持待绑定，不按 cwd、最近更新时间或首个文件猜测。
- 解析 metadata ID，而非把 rollout 文件名当作权威 ID；现有本机文件已出现文件名 ID 与 metadata ID 不同的副本。
- 身份唯一与 lifecycle 文件源唯一分开验证。文件须位于本次实际 Home 的 sessions 树并有匹配 metadata；仅一个有效源时关联该源。多个同 UUID 源时记录各自增量边界，依据本次启动 / 当前回合之后新增、可关联的生命周期记录确认唯一写入源，静态旧副本不能参与派发。0 个可核实源或多个活跃冲突源时保持待关联并诊断，不能取第一个文件、仅看最新 mtime 或仅凭文件名选源。原始 metadata 内容相同也不能省略这项判断。
- 一旦绑定，名称变化不能改绑。若本 PTY 显式报告不同 thread 标识，视为显式会话切换，先停旧 watcher、取消旧回合恢复动作，再绑定新 UUID；不得拿其他窗口的索引变化当成切换。
- 当前 Windows ConPTY 隔离 startup 已实测出现 29 字符 UUID 前缀，未提交模型输入；首次输入前临时 Home 还无 metadata，因此保存 hint 并在文件出现后核实 UUID。停止阶段出现 console helper AttachConsole 诊断，完整应用中还需验证清理。若无有效信号，不擅自采用有串线风险的目录 fallback，不改用户通知配置。明确 UUID 的恢复路径仍可监控，新会话保持通用标题并给出可检查诊断。

### 独立监控与显示

- provider 身份确认后立即定位对应 lifecycle 文件并启动 / 重试 watcher，与是否存在正式标题无关；不得因为 title resolved 但文件暂缺而永久停止。
- 绑定后的窗口标题按同 UUID 最新有效索引记录更新，尚未命名时保留已有可用标题或通用标题；不得把首条长问题 / UUID 当作已确认正式名称而停止更新。
- 按 UUID 合并 session_index.jsonl 追加记录：最后一条完整有效非空名称覆盖旧记录，损坏 / 半行尾部不覆盖旧名。修复相同索引读取路径的重复 / 旧标题，验证分页未改变既有子代理过滤契约。
- 索引标题优先于 JSONL 临时摘要；recent JSONL 只补齐文件 / cwd / 元数据，不覆写已确认的名称。
- 重用当前轻量定时机制并根据文件 stat 判断变化；身份确认后不反复递归扫描全部会话。PTY 关闭 / 退出时释放观察器与 title 定时器。
- Agent Bridge 的 expectedPreview 仍约束需要使用启发式候选的既有路径；当前 PTY 可验证的身份信号独立于标题。同步实际相关契约而不扩展全局 Bridge 权限。

## 3. 自动继续的失败授权与取消

- CLI 重连 1/5 与 CodeDeck 自动继续预算分离。保留已保存 limit 的“整个受监控终端累计自动继续上限”语义；成功不清零预算，不引入隐式无限重试。
- Codex 的自动继续优先依据当前回合最终 structured failed、retryable 和配置关键词决定。普通回答的错误词、用户回显、CLI 中途 Reconnecting 和旧屏重绘不能单独授权发送。
- 成功、新有效提交、权威新回合、暂停 / 禁用、关闭 / 退出均失效化对应旧错误状态和待发送动作；清理控制器跨块尾部、失败锁和进度标识，不清累计预算。
- 延迟 timer 和无 renderer 后重新 attach 的 flush，在实际写入 PTY 前再次校验同一回合 / 失败代次仍有效、terminal running、enabled、未暂停。每个失败只授权一次，迟到 callback 不得发送。
- 不可重试失败（鉴权等）和用户中断不自动继续。失败判定与用户配置的关键词共同过滤，不将模型普通回答当作失败。
- 只有现场证据证明特定当前 CLI 的终极失败没有结构化事件时，才加入与该版本格式对应的明确最终错误区域 fallback；跨块上下文必须保留，不能只凭错误词或仅凭 ■ 标记。不得以增加理论兼容层替代验证。
- Claude 沿用现有行为；本次 Codex 特定授权不机械施加到没有 structured failed 来源的 Claude。
- 界面次数标签明确为自动继续上限，统计保持“已触发”含义；诊断记录代次 / 原因，避免每次重绘重复写海量相同 skipped 日志。

## 文件边界与验证

预计修改 manager、detector、lifecycle parser、auto-continue、session-service、Codex command builder / launch-service、主进程相关入口及直接对应测试。需要流式 OSC identity helper 时放入 `src/shared/electron/`，不将与业务无关的 main.ts 内容整体搬迁。TerminalApp.tsx 只在需要明确次数标签时做小改。

现有 Electron/main、manager、detector、parser 及部分测试已 dirty；实施基于当前工作树追加差异，不 checkout、回退或整体替换已有工作。根 AGENTS.md 与无关签到 / Profile 改动不在本任务修改范围。

先运行新增具体回归与直接相关现有测试，再 typecheck；涉及 Bridge 时运行其相关测试。没有新失败或更广影响时不为覆盖率扩大测试。用户当前运行的是 win-unpacked 程序，源码测试不能证明该构建已更新；新建隔离测试会话验证，不能为了验证关闭其现有会话。打包 / 更新运行构建的必要步骤与应用退出影响要单独说明，未验证部分如实记录。

## 恢复、风险与不做的事项

- 修改来源受 Git 管理，保护已 dirty 的基线；不改真实历史、索引或用户全局配置，无数据库迁移。
- OSC 格式研究以本机 0.160.1 同版本源码为依据，Windows ConPTY startup 传播已验证；metadata 落盘后的完整关联与回合完成仍需集成验证。多候选和无身份必须保持未绑定；同 UUID 多文件无法核实唯一写入源时也保持待关联，不能把身份唯一冒充来源已验证。
- JSONL 观察可能晚于用户输入，应以代次 / turn_id / timestamp 共同约束，而不是把任何迟到 completed 套到当前回合。
- 没有当前会话结构化失败信号时应保守不发送；是否存在这种终极失败以当前 CLI 实证决定，不能先声明完全支持所有旧版本。
- 不替换 PTY 为 App Server，不修改 Codex 源码，不重写用户 notify，不发布、不主动提交 / 推送，不自动中断既有运行会话。
