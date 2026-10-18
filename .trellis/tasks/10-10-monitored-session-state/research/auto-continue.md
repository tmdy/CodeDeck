# Research: 监控终端自动继续误触发

- Query: 未看到真实错误却发“继续”；CLI 的 1/5 重连次数是否跨成功累计后触发；完成后等待中的继续是否取消。
- Scope: internal；只读产品代码与现有测试，研究文件为唯一写入目标。
- Date: 2026-10-10

## Findings

### 结论与证据强度

用户提出“前几次错误恢复成功，累计到五次就发继续”的阈值解释不符合当前实现。CodeDeck 的 limit 是整个受监控终端会话内允许创建自动继续动作的上限：每个获准的关键词命中立即增加 matchCount 并返回发送动作，达到上限后停止创建动作。它确实跨用户轮次累计，但不是达到第五次才发送。CLI 自身 Reconnecting... 1/5 的 5 是另一层网络重试分母；控制器从不解析该分母来计数。

已直接对当前 TypeScript 源码在内存转译后调用，确定四个行为缺口：

| 输入 / 时序 | 当前实测行为 |
| --- | --- |
| 普通回答 `Documentation says high demand is retried automatically.` | 返回自动继续动作，matchCount=1，未要求真实错误 |
| 第一块 `Reconnecting... 1/5 (18s) `，第二块 `high demand` | 返回动作，matchCount=1，未能保留前一块的重连上下文 |
| 匹配错误后排队 30ms，随后立即 reportTurnLifecycle(completed) | 定时器仍发送；写入1次，activity再次变busy |
| 无renderer时匹配，随后 reportTurnLifecycle(completed)，再attach | 遗留输入仍发送；写入1次，activity再次变busy |

这些是代码级确定缺口；尚无用户实际误发时序日志，不能声称四项中的某一项已被证明是该次真实事故根因。

### 文件与关键模式

- `src/shared/electron/terminal-auto-continue.ts`：关键词匹配、失败区域锁、会话累计预算、发送等待时间。
  - `:193-221`：对所有PTY输出剥ANSI后匹配原始关键词，不区分assistant正文、错误、旧屏重绘。跨块只保留 maxKeywordLength-1 个字符，不是错误行或TUI状态上下文。
  - `:244-259`：只排除输入回显、当前匹配文本中位于关键词前120字符内的 Reconnecting... N/M，以及当前匹配文本中的 working / reconnecting。
  - `:261-269`：activeKeyword防止同一失败区域重绘重复；不等于确认新失败。
  - `:277-292`：matchCount>=limit即拒绝；否则matchCount立即+1并返回动作。预算在实际PTY写入前消费，排队后被取消也会计入“已触发”。
  - `:299-337`：用户非空提交仅清activeKeyword、等待进度和时间戳，不清matchCount；也不清pendingTail / pendingVisibleTail。自动提交把waitingForAutoRunProgress设为true。
  - `:453-470`：自动继续后的 working/reconnecting 只需一次观察并经过3秒，且距离上次关键词观察至少3秒，下次关键词就被当作新失败区域。它没有成功终止输入；成功后旧错误重绘仍可能重新解锁。
  - `:472-479`：重连判断是当前文本关键词前120字符范围，并不要求/解析CLI网络重试次数。
- `src/shared/electron/terminal-session-manager.ts`：PTY订阅、延迟队列、structured生命周期。
  - `:192-203`：每块输出无条件先交controller.processChunk；可直接产生动作，再enqueue；provider类型不影响此路径。
  - `:232-243`：任何非空用户输入取消pending timer/input。
  - `:291-299`：暂停/禁用取消pending。
  - `:301-320`：reportTurnLifecycle仅取消idle prompt timer并更新activity。completed不清自动继续timer/input，也不向controller提供轮次边界/成功重置。
  - `:423-465`：定时器仅检查进程running、enabled、paused；进程running包含模型回答完成后的交互终端，因此成功完成不阻止延后发送。
  - `:468-504`：pending输入等待renderer；attach(:219-226)重新flush，flush未检查最近生命周期/失败仍有效；成功后仍能写入并把activity设为busy。
  - `:205-213`、`:264-275`：进程退出/终端关闭有取消，与模型单轮成功完成不同。
- `src/shared/electron/terminal-turn-lifecycle.ts`：`:71-89` Codex event_msg task_complete带error映射failed，无error映射completed。`:41-68`已产生error.retryable，401/403明确不可重试；Claude(:92-115)目前只有started/completed，没有failed来源。
- `electron/main.ts:1221`：已把解析结果传manager.reportTurnLifecycle；可利用现有结构化失败证据，不必从回答正文制造失败。
- `src/TerminalApp.tsx:62-68`：显示“已触发N次，剩余N次”；`:328`控件只称“次数”，可以明确“自动继续上限”，无需改变预算语义。
- `src/shared/parameter/types.ts:53-59`：默认词含high demand、temporary errors、temporarily unavailable、rate limit、overloaded；正文讨论这些词也可命中。

### 对“成功后累计”的精确回答

1. CodeDeck matchCount是整个PTY生命周期的累计动作数，用户新提交/成功都不重置，现有测试明确认可该设计。
2. CLI自动网络重连在同一chunk内通常会被过滤，且不会增加matchCount。因此一次网络重连成功不应正常消耗一次CodeDeck预算。
3. 分块丢失重连上下文或普通正文引用会消耗预算并立即发送；可表现为“网络已经自己恢复，后面仍发继续”。
4. 成功后待发送队列不清，是无需更多猜测即可复现的误发途径。它还会令activity再次busy，可能与进度条不停相关，但真实进度条问题需结合另一研究的状态/绑定证据。
5. 清零累计预算不是防误发修复；会掩盖错误检测并允许无限重试，应保留limit的session上限契约，明确UI语义。

### 最小修复建议

优先由现有manager协调失败与轮次边界，保持同一个预算控制器，不另建平行重试系统：

- 成功completed：取消pending timer/input；清控制器跨块尾部、失败锁与自动运行进度；关闭本轮错误检测直到新有效提交/started。保留累计matchCount和上限。
- 新started/有效用户提交：取消旧轮队列并清尾部，确保新轮不拼接旧轮文本。取消pending必须记录诊断原因，可不包含正文。
- Codex自动继续依据本轮最终结构化failed且retryable来授权；关键词可只过滤结构化error.message，保留用户词配置实际作用。普通PTY正文/引用与CLI中间Reconnecting不能独自发送；同一失败只产生一次动作。
- delay到期和renderer重新attach在最终写入前重新检查对应失败/轮次仍有效；使用小型轮次或failure token使旧timer失效，不能仅检查PTY running。
- 不宜只将关键词限定为`■`前缀：旧错误重绘也有此标记。也不宜只清completed timer：普通正文引用和分块重连仍立即误发。
- 若现场Codex终极失败没有可靠task_complete(error)，在有实证的具体CLI版本/格式下保留明确最终错误区域fallback；必须缓存跨chunk行/重连上下文，并与结构化本轮成功/运行状态冲突时拒绝。目前未核实该版本实际输出，不应提前假定或增加全面兼容层。
- Claude目前未产生structured failed；不要把仅Codex确定的授权机制机械套到Claude导致既有功能消失。按实际provider能力限定此次改动，必要时为Claude保留严格错误区域fallback。

### 回归测试建议

控制器：正文引用默认错误词不触发；用户回显重复不触发；同一重连状态/错误拆成任意chunk不触发；新started前成功轮旧尾部不拼接；成功之后旧错误重绘不触发；真实最终failed且可重试只触发一次；新的真实最终失败还能触发但累计上限仍有效。

Manager：匹配后delay未到即completed不写；无renderer排队后completed再attach不写；started/用户输入取消上一轮队列；发生成功/新轮之后旧timer callback不得写；不可重试failed不发送；默认0delay下正文引用不立即发送；取消后的matchCount语义按契约明确，不虚称“实际发送次数”。

### 已有验证

运行 `npm test -- src/shared/__tests__/electron/terminal-auto-continue.test.ts src/shared/__tests__/electron/terminal-session-manager.test.ts`：2文件48测试通过（19+29）。这些测试含同块重连排除、重绘防重复、暂停/禁用/用户输入/关闭/进程退出取消delay、无renderer等待，却没有成功完成取消pending、拆块重连状态、assistant正文引用回归。

内存复现使用typescript.transpileModule + data URL import，直接加载当前源码，Fake PTY只记录写入数量；不创建产品测试或执行真实CLI，不读用户会话正文/凭据。四场景都观察到上述错误行为。

### 已有工作区修改

本研究所涉及路径中，主会话已存在修改的相关目标为：

- `src/shared/electron/terminal-session-manager.ts`
- `src/shared/__tests__/electron/terminal-session-manager.test.ts`

本次只读调查与复现未改以上文件。其他读取目标controller、controller测试、TerminalApp不在本次观察到的相关dirty列表内；仓库全局已有46项未提交改动，需由主会话保留并在实施时对比目标既有diff。

### Related specs / external references

- 已读`.trellis/workflow.md`：本阶段为planning，研究持久化，不等于实施授权。
- 已读`.trellis/spec/frontend/index.md`：暂无专用monitored auto-continue契约；通用To fill模板不能当作既有约束。
- `.trellis/spec/frontend/profile-health-contract.md:82-86`规定普通监控终端只有authoritative turn_completed才能产生passive availability；修复不能用自动继续的正文匹配当成生命周期成功证据。
- 无外部查询；结论来自当前仓库源码与当前测试，不依赖未知CLI版本官方行为推测。

## Caveats / Not Found

- 未读取用户所附txt、真实terminal日志或用户当次CLI版本；该文件由另一研究负责。已证明代码缺口而非定位某条实际日志的根因。
- 生命周期绑定准确性、标题选择和busy-output覆盖成功状态由其他研究负责，不在本报告扩展。
- manager/controller实际接口调整与失败事件轮次去重需主会话汇总后写design/implementation plan；本研究没有实施。
