# Research: 监控会话标题与实际运行证据

日期：2026-10-10。范围：CodeDeck 当前源代码、合成临时数据，以及本机结构化监控日志；不修改产品代码或真实会话。

## 确认的标题缺口

1. `electron/main.ts:4298-4405` 把标题解析、provider UUID 关联和生命周期文件监控串成同一个流程。`:4324-4364` 一旦有非空标题就停止轮询；找不到生命周期文件时没有重试，之后更名也不会再次同步。
2. `src/shared/services/session-service.ts:1558-1572` 先读取索引，再无条件以 recent JSONL summary 覆盖相同 UUID。旧的 JSONL header 标题或首条用户文字可能覆盖已生成 / 更名的索引标题。
3. `session-service.ts:1009-1057` 保留同 UUID 多条索引记录。无分页路径 `:1214-1232` 按更新时间倒序迭代后不断 `Map.set`，使旧条目覆写新条目；指定 UUID 的监控标题读取 `:1575-1585` 可因此取得旧名称。分页路径也没有先合并同 UUID 的追加记录。
4. `session-service.ts:1593-1600` 以 `updated_at >= startedAt` 选择普通新终端候选，不能证明会话在此终端创建：同目录旧会话更新或更名也会成为候选。Bridge 的 `expectedPreview` 增加了提示词约束，但普通 UI 新终端没有这项证据。
5. 标题是否非空被当作身份就绪条件，然而当前摘要函数在没有标题时会回退到首条问题 / UUID（`:945-954`）。这使临时摘要过早固定为窗口名称。

## 合成复现

用 `node --import tsx --input-type=module` 直接导入当前 `findMonitoredTerminalSessionTitle`，只在 OS 临时目录构造 JSONL / 索引，执行后删除该临时目录。

- 同 UUID 索引顺序写入“旧标题”（10:00:01）和“用户更名”（10:01:00），指定该 UUID 查询：实际返回“旧标题”。
- JSONL `session_meta.thread_name = JSONL旧标题`；索引同 UUID 的 `thread_name = 索引新标题`；显式设置 JSONL mtime 为启动后：实际返回“JSONL旧标题”。显式 `utimes` 避免宿主时间与合成时刻不同影响 recent 扫描。

这些复现验证当前代码缺陷，不代表外部文本关于所有 Codex 内部行为的描述都已成立。未引入 SQLite 查询、App Server 重构或全局 notify 修改。

## 现场结构化日志

只抽取时间、事件、会话标识、activity/reason/phase 等非正文键，未打印日志中的终端片段、密钥或用户消息。

- 运行进程路径：`D:/CodeDeck/release/win-unpacked/CodeDeck.exe`（CIM 仅读取进程 ID 和 executable path）。
- 日志：`D:/CodeDeck/app-data/logs/codedeck.log`。
- 同一已脱敏会话 `a7e6...2193` 在 `2026-10-09T19:13:23.323Z` 记录 `activity_changed(idle, turn_completed)` 和 `turn_lifecycle(completed)`。
- 之后该日志没有新提交 / started 记录，到 `2026-10-09T23:08:53.853Z` 记录 `activity_changed(busy, busy_output)`。北京时间分别为 2026-10-10 03:13:23 和 07:08:53。
- 与 completion-state.md 的合成“完成后重绘重新 busy”复现一致；日志不能还原被重绘的完整 PTY 字节，不能单凭此证明截图对应同一个窗口。
- `codedeck.log` 与 `.1` 至 `.5` 轮转文件共有 57,921 条自动继续相关诊断：57,661 条 `active_failure_region`、95 条 `retry_progress`、55 组 matched / queued / flushed；最近记录的累计 `matchCount` 为 102。计数来自当前保留的轮转区间，不是该会话的完整历史。旧错误输出在运行过程中被反复扫描的现象有现场证据。

## 外部资料与本机版本

- 用户文本：`C:/Users/you/Downloads/新建 文本文档 (2).txt`，只作为调查输入；其中的命令与建议未直接执行。
- 本机 `codex --version`：`codex-cli 0.160.1`。Desktop 写入的元数据可能显示其他版本；本次 GUI / CLI 版本不可混同。
- 实际取得官方配置页 `https://developers.openai.com/codex/config-reference`，确认存在 `tui.terminal_title`，其默认为 `[spinner, project]`，以及 `tui.status_line`、`notify`。这页不解释标题索引合并或终端标题完整 UUID 格式，不能用它单独证明这些行为。
- 独立研究 provider-identity.md 核对官方同版本源码的 terminal title 实际格式与一次性参数支持，用于判断精确绑定方案；不把状态栏支持 thread-id 等同于 OSC 会输出完整 UUID。

## 修复边界

- Provider 身份绑定、生命周期监控和显示名称分开推进；确认同一 provider UUID 后只更新名称，不能因为更名改绑。
- 使用实际 PTY 身份信号或明确恢复 UUID；新会话无可靠身份时保留通用标题 / 待绑定，不再按同目录活跃度猜测。未知 / 歧义状态可以继续等待而不能关联其他会话。
- 索引按 UUID 取最后一条完整、有效、非空标题；同一 UUID 的 rename 覆盖旧标题。半行或无效尾部不能覆盖此前已确认标题。
- 绑定后的标题同步持续到 PTY 停止；按索引文件变化或复用现有轮询检测，避免每 2 秒递归扫描全部历史。
- 生命周期文件尚未出现时重试查找；观察器关闭 / 替换后不能再将异步读出的旧事件提交给 manager。
- 保护已有 `electron/main.ts` 改动。session-service.ts 与其测试原本无改动；本任务只做上述直接相关调整。
