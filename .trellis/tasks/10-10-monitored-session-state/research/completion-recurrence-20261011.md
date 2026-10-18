# 2026-10-11 完成后忙碌复发

用户截图已显示 `Worked for 1h 23m 3s • 02:34`、`› Ask Codex to do anything`，顶部却仍显示任务运行中；自动继续为 0。截图文本仅作为缺陷证据，不执行其中其他任务指令。

## 现场核实

- 当前运行与开始菜单指向 `release/codex-resume-repair-20261010/win-unpacked/CodeDeck.exe`。包内已核实存在上一轮 settled、processFailure、identity parser、main identity handler；不能归因于完全没带修复的旧包。
- 保留日志最近终端 64fc...1452 在 2026-10-10T17:04:31.588Z identity_hint_pending，17:11:33.242Z submitted_input 变 busy，之后没有该终端完成事件。截图 PID 不在保留日志的 PID 字段，不能宣称已唯一映射截图窗口。
- detector 漏认当前 placeholder，且旧 Working 优先于后来的正式完成分隔行。截图序列已作为回归。
- 实际 codex.exe 的 Windows argv 存在被 cmd/npm shim 转义后的错误 title 配置，引号进入 key；CLI 未报解析错误，但没有输出 UUID 身份 title。

## 真实 Windows 启动链实验

独立临时 Home/cwd，不复制真实 auth/config；本机关闭端口 provider，不请求外部模型。

- 使用当前 buildWindowsPtyLaunchSpec，经真实 cmd → codex npm shim → node → codex 0.160.1：原 double-quote TOML array 没有 UUID OSC，只输出项目名。
- 相同链只把值改为 TOML literal array `tui.terminal_title=['thread-id']`，实际收到标准 UUID prefix OSC。
- literal array 在 direct exe 和 PowerShell initialPrompt 启动链也收到 UUID OSC；后者还观察到已知 Braille spinner。
- 实验停止观察窗口内 onExit 迟到；之后查询已知测试 PID 及后代均不存在。cmd 实验 kill helper 有 AttachConsole 诊断。第一个实验根目录清理遇 EBUSY，随后 PowerShell 明确清理命令被自动审批拒绝，未换工具绕过；保留临时空目录记录。第二个实验退出状态迟到，保留临时测试目录，不触碰用户数据。

## 修复与验证边界

识别当前 placeholder；以正式完成分隔及当前 prompt 边界排除旧 Working，同时保护新的 Working、交互确认和正文示例。title override 使用合法 TOML literal，避免普通 cmd 链内嵌双引号。

实现初步 145 项相关回归/typecheck 通过；独立检查继续审阅正文完成行误判。交付更新包时不得终止用户已打开的 CLI 会话，快捷方式更新与运行旧终端的热更新必须分别报告。

独立检查完成后，9 个文件 177 项测试/typecheck 通过。完成行限定为待命提示符前的末尾整行、排除未闭合 Markdown 代码围栏。独立新包为 `release/monitored-session-state-20261011-095220/win-unpacked/CodeDeck.exe`，包内 12 个编译模块逐字节核对通过，保留已有性能及 resume 修复；开始菜单快捷方式已更新并重读校验。旧应用及用户 CLI 保持打开，实际新包启动需先退出旧应用以释放单实例锁；该动作会关闭现有终端，等待用户明确重启确认。
