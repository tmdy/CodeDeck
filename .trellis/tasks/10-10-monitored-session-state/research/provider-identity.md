# Research: Codex PTY 会话身份绑定

- Query: Codex 0.160.1 是否能用每次启动的 terminal-title override，从该 PTY 的 OSC 精确识别当前 thread，避免按目录和时间猜测。
- Scope: mixed（CodeDeck 当前入口、官方版本源码、本机 CLI help）
- Date: 2026-10-10

## Findings

### 结论

推荐最小方案：仅 monitored Codex 启动追加结构化参数 `-c`、`tui.terminal_title=["thread-id"]`；在本次 PTY 原始输出中读取完整 OSC title frame，提取 thread UUID 或受控截断前缀，再在该进程实际 Codex Home 内核验 session metadata。零匹配、多 UUID 匹配时保持未绑定并继续等待，不回落到目录/时间猜测。

但不能把 `thread-id` 当作完整 UUID 输出：0.160.1 官方代码实际截断到 **29 个 UUID 字符 + 三个英文句点**，总长度 32。标题生成期间还可能追加一个 Braille spinner。该方案提供由当前 PTY 发出的身份线索，唯一匹配须经磁盘元数据确认；它不是稳定的机器协议，也不是安全认证凭证。

### 官方版本与取回证据

本次通过 HTTPS 实际取回官方 GitHub API 的 `rust-v0.160.1` tree，版本锚点 SHA 为 `d27764b82f7118f674371e6d6e76271d9d606edb`；以下相关 Rust 源文件均从该 tag 实际取回并逐行阅读。初步查看 main 后专门回到与本机一致的 tag，避免把 main 的行为当成本机版本事实。

本机 `codex --help` 已执行，确认 `-c / --config <key=value>` 支持 dotted path、按 TOML 解析值、覆盖原本从用户配置载入的值；该操作没有启动会话或模型请求。

### item identifiers、截断和格式

- [`codex-rs/tui/src/bottom_pane/title_setup.rs:53-57,81-83`](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/bottom_pane/title_setup.rs#L81)：`TerminalTitleItem` 支持 `thread-name`，以及 canonical `thread-id` / alias `session-id`。`thread-title` / alias `thread` 是名称优先、未命名时 UUID fallback，不能作为持续可靠身份字段。
- [`codex-rs/tui/src/chatwidget/status_surfaces.rs:800,819-826,941-945`](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/chatwidget/status_surfaces.rs#L941)：`SessionId` 原值是 `self.thread_id.map(|id| id.to_string())`，但 terminal title 单项调用 `truncate_terminal_title_part(value, 32)`；`Thread` 和 `ThreadName` 单项截断上限是 48。
- [`status_surfaces.rs:1090-1104`](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/chatwidget/status_surfaces.rs#L1090)：超过 32 grapheme 时，仅保留 `max_chars - 3` 个字符，再加 `...`。UUID 为 ASCII，实际截断例子为 `01234567-89ab-cdef-0123-45678...`；前缀形状是 `8-4-4-4-5` hex groups（25 个 hex 字符 + 4 个连字符），29 字符，不是 32 字符前缀。已用该示例实际切片核验长度和各组长度。
- [`codex-rs/tui/src/chatwidget/thread_title_status.rs:32-49`](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/chatwidget/thread_title_status.rs#L32)：名称生成 pending 时，`SessionId` title 值也会追加空格和 spinner；动画禁用时仍有静态首帧，不可用是否出现 spinner 判断会话是否执行中。
- [`status_surfaces.rs:31-36`](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/chatwidget/status_surfaces.rs#L31)：明确的 10 个 spinner 为 `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`，100 ms 帧间隔。
- [`codex-rs/tui/src/terminal_title.rs:56-67,84-103`](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/terminal_title.rs#L84)：stdout 是 terminal 才写入；实际 ANSI 是 **OSC 0 + BEL**：`ESC ] 0 ; <title> BEL`，Windows 明确启用 ANSI writer。总 title 做清理和 240 字符上限。官方此版本没有在该 writer 输出 OSC 2 或 ST terminator。

### 创建、恢复、切换和改名刷新

- [`codex-rs/tui/src/chatwidget/session_flow.rs:47-73,177-189`](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/chatwidget/session_flow.rs#L70)：session configured handler 设置 `self.thread_id = Some(session.thread_id)`，然后调用 `refresh_status_surfaces()`；旁边注释明确覆盖 `/new`、`/resume` 和 thread switch 的状态同步。不是等第一次模型回答后才获得身份。
- [`session_flow.rs:372-390`](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/chatwidget/session_flow.rs#L372)：手动改名和服务端名称更新也刷新 status surfaces。
- [`status_surfaces.rs:245-310`](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/chatwidget/status_surfaces.rs#L245)：新 title 与已写 title 相同则不再次写 OSC；不存在可用值时清除已管理 title。身份尚未生成时可能没有输出可解析 UUID。仅配置 thread-id 会降低普通工作动画的重复 OSC，但生成标题时该字段仍会动画。

### one-run override 可行性

- [`codex-rs/core/config.schema.json:4757-4763`](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/core/config.schema.json#L4757)：`tui.terminal_title` 是 nullable/default-null 的 string array。0.160.1 schema 所述默认项为 `activity, thread-name, project-name`，与当前网页版配置文档的旧默认描述可能不同，应以版本代码为准。
- [`codex-rs/utils/cli/src/config_override.rs:15-36,47-83,95-101`](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/utils/cli/src/config_override.rs#L15)：`-c` 为 repeatable/global 参数，原值按 TOML 解析，支持数组。
- [`codex-rs/tui/src/local_settings.rs:59-84`](https://github.com/openai/codex/blob/rust-v0.160.1/codex-rs/tui/src/local_settings.rs#L81)：TUI local settings 直接复制已解析的 `config.tui_terminal_title`，不从活动 thread 的服务端状态反向覆盖。
- 因此单次启动 override 足以控制当前 TUI title 内容，不需要修改 `config.toml`，不需要覆盖 `notify`。参数应使用项目现有命令参数构建及 PowerShell 引号规则，不手工拼接无法保留 TOML 双引号的字符串。若用户在本次 TUI 主动调整 `/terminal-title`，输出结构将改变；不再识别时保持已核验身份或等待新的有效身份，不能从人类标题反推 UUID。

### CodeDeck 接入位置与解析约束

- `src/shared/electron/terminal-session-manager.ts:192-204`：`pty.onData` 已在主进程逐 chunk 分发原始字符串，适合先增量读取 OSC 身份，再继续原样投递 Renderer，不需要剥除终端控制序列。
- `src/shared/electron/terminal-session-title.ts:9-22`：现有函数仅规范化展示名称和窗口 title，不承担身份协议解析；将 identity parser 与 display title 分开。
- 生命周期读文件的身份依据应是该 PTY 验证后的 UUID，不应依赖窗口显示标题是否已经加载。主会话已研究的目录/时间猜测与标题索引合并问题不在此重复。

建议解析边界（设计建议，非 Codex 已存在的协议保证）：

1. 逐 chunk 保留有界解析状态；OSC 起始、数字 selector、分隔符、payload 以及 BEL 均可能跨任意 chunk。不要先 ANSI-strip 后解析，不要把普通文本中的 UUID 当作 OSC 身份。
2. 本版本只需认可 selector `0` 的完整 frame；可以为兼容终端 framing 接受 OSC `2`、`ESC \\` / ST，但要在测试中明确这是 CodeDeck parser 支持范围，不能声称本版本实际发出这些格式。忽略 OSC `8` 超链接等其它 selector，控制未闭合 frame 的缓存上限并恢复解析。
3. 使用全字符串受控形状：完整 canonical UUID，或上面确证的 29-char UUID prefix + `...`；最多尾随一个空格和已列出的 Braille spinner。可容许清理后的首尾空白。不要任意匹配所有省略号/标题中的 UUID 子串。
4. 在当前 launch plan 实际 Home 中匹配前缀；候选 canonical UUID 必须通过 `session_meta.payload.id` 核验。索引可作为候选加速，文件名 UUID不能代替元数据。按完整 UUID 去重后只有一个身份才可绑定；多个不同完整 UUID 或没有验证过元数据时继续未绑定。
5. 同 UUID 的副本文件属于文件源选择问题：身份唯一不等于生命周期源文件唯一。应使用经过元数据核验的 canonical/active rollout source；若只有重命名副本，或多个源冲突而没有充分证据，不应盲选第一个文件或最新时间。至少不要让副本文件名中的另一个 UUID 反过来改写会话身份。
6. 文件/索引尚未落盘时保存 PTY 给出的待解析前缀并重试查找，不猜测其它会话。后续新的有效 OSC identity 与当前身份不符时，应清除/替换旧 watcher 和待继续动作，支持该 PTY 内 `/new`、`/resume`、thread switch。重复同身份 OSC 不重建 watcher，不清空正常状态。
7. identity OSC 与“Working/Ready”的生命周期证据分离。只配置 thread-id 后原先根据 spinner/project title 判断 busy 的路径必须改用真实回合事件，否则会产生本任务正在修复的状态滞留。

## Related Specs

- `.trellis/spec/frontend/session-discovery-contract.md`：metadata-based session semantics、canonical Home、避免以 filenames 推断 metadata。当前研究只提供身份接入方案，不改 spec。
- `.trellis/workflow.md`：研究结论持久化；尚处于排查与规划，不修改产品代码。

## Caveats / Not Found

- 未启动真实 TUI 或收费模型调用，未实测 Windows ConPTY OSC 逐字节输出；可行性基于官方版本源码、当前 `pty.onData` 接口、本机 CLI help，不能报告实机验证通过。
- `thread-id` terminal-title 是展示功能，版本升级可能更改截断长度或动画附加格式。应允许完整 UUID形状，同时对未知形状保持未绑定并给出可诊断信息，避免默默猜测。
- PTY OSC 是定位证据，不是抗伪造认证：模型工具输出等也能写 terminal escape sequences。本任务个人本地场景下仍应限制来源为该 session PTY、受控 shape、实际 Home metadata 核验。
- 当前磁盘源可能包含相同 UUID 的复制文件；唯一身份与唯一可监控文件要分别验证。研究没有提出按目录/时间替代的备用猜测。
- 未重新调查主会话已确认的索引重复 UUID旧标题、recent JSONL标题覆盖问题；它们仍需单独修复，UUID绑定不自动解决名称刷新。

### 有界实际验证补充（2026-10-10）

- 按主会话追加要求，已在 `D:/CodeDeck` 当前 Node 环境执行仅加载模块的 `require('node-pty')` 检查，退出码 0，输出 `NODE_PTY_LOAD_OK`。这仅证明入口模块可以加载，尚不证明 native binding 在实际 `spawn` 时 ABI正确或ConPTY OSC能被读取。
- 后续临时 Home PTY startup验证没有执行：当前 researcher developer scope 只允许写本任务 `research/`，不允许创建 OS temp Home / config。本限制已经发送主会话，临时 Home实际startup应由有对应写权限的主会话执行。没有读取或复制真实 auth / config，没有启动任何 Codex会话，没有触碰现有进程。

### 主会话实际 ConPTY startup 验证

- 主会话随后在 OS temp 创建 `codedeck-identity-startup-*` 专用目录，CODEX_HOME 与 cwd 均位于该目录。仅传递系统启动所需环境；没有复制真实 config/auth，测试 provider 指向关闭的本机 `127.0.0.1:9/v1`，未提交模型输入或请求外部模型。
- 直接由当前 node-pty / ConPTY 启动 npm 安装的 codex.exe 0.160.1，传入一次性 `tui.terminal_title=["thread-id"]` 和仅测试目录的信任参数，等待最多 12 秒。
- raw PTY 实际出现 selector 0 title：`01a12416-73ba-7a60-8409-e7eac...`，即正确的 29 字符前缀加三个句点。本例未出现 spinner；只能证明实际 Windows 输出支持本例，不覆盖所有动画 / chunk 边界。
- startup 尚无首次输入，因此临时 Home 尚未产生 `sessions/*.jsonl` metadata。身份 hint 必须保留并等待文件落盘，不能把这项实验称为完整 UUID 关联或生命周期实机验证通过。
- 实验停止时 node-pty 的 console list helper 打印 `AttachConsole failed`；主流程完成并清理了已校验绝对路径的本次临时目录。此诊断发生在测试进程停止阶段，不能被隐去或当作 startup 失败；实施后还需在完整应用的生命周期中核实清理。
- 主会话确认没有本次测试启动参数对应的 codex.exe 遗留进程。没有关闭或修改任何既有 CodeDeck / Codex 会话。
