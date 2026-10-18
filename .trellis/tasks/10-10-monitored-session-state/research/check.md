# 独立复核与自修

日期：2026-10-10。trellis-check 直接检查当前实现；未启动更多实施或检查代理，未修改真实会话、全局配置或既有终端。

## 确认并修复

- `electron/main.ts`：显式 thread switch 已清生命周期 watcher 与 manager 回合状态，却保留旧 displayTitle。新 UUID 尚未生成索引名称时会一直显示旧会话名。
- 修复：不同 thread hint 的切换分支立即清空 displayTitle 并将窗口恢复为 `Codex 终端`；同一 UUID 的重复、截断或完整 hint 保留现有名称。`applyTerminalDisplayTitle` 允许调用者明确清空名称。
- 回归：新增 `terminal-identity-binding.test.ts`，通过 TypeScript AST 提取并执行当前主进程实际函数，模拟 Electron 依赖。验证真正切换清除旧名且恢复通用窗口标题、同 UUID 身份刷新不清名称；不只检查源码字符串。

## 已检查路径

- manager 的 settled / turnGeneration、提交时间和 turn_id 约束、权威完成去重、延迟 timer / renderer attach 前的代次复验。
- Codex raw PTY 不授权自动继续；最终 JSONL failed、retryable 和配置关键词共同授权，成功 / 新输入 / 新回合取消动作，累计预算不清零。
- JSONL watcher 异步读取后及逐事件重新校验实例与 running 状态；身份来源 metadata 核实、同 UUID 多文件的增长来源判定和歧义保持待关联。
- 显示名与生命周期来源独立，索引最后有效名称合并；launch-service 使用实际 Home 和受监控参数，direct / Claude 不注入 title 覆盖。
- Bridge failed 阻止进行中的异步 completeTurn 将失败覆盖成成功，委托 Codex 不继承交互自动继续策略。

没有发现第二个能够确认的任务相关代码阻塞。保留已有 dirty 变更，复核仅追加上述局部修复和两项回归。

## 验证

- 新修复相关三个测试文件：13 / 13 通过（身份绑定 2、身份解析 8、标题格式 3）。
- `npm run typecheck`：通过，涵盖两套 TypeScript 配置。
- `npm run build:electron`：通过。
- `git diff --check`：通过，仅既有 LF / CRLF 提示。
- `package.json` 没有 lint 脚本；未把不存在的检查报告为 lint 通过。
- 父会话已记录修复前全套 108 文件 / 1145 测试通过；本次只重跑新标题修复关联测试，不重复无变化的全套验证。

## 实际限制

父会话 ConPTY / localhost 模拟 provider 的集成证据见 `integration-runtime.md`，覆盖真实 OSC、metadata、503 最终失败的一次继续与成功回合 idle、正文关键词不误发。本次后续修改仅主进程切换名称路径，没有改该实验使用的 manager / resolver / parser。

尚未通过完整 Electron 主进程 watcher / 窗口 / Windows 任务栏实际操作验收，也没有替换正在运行的 win-unpacked 程序。跨窗口并发和真实 CLI 内部 thread switch 的完整界面验收仍应与源码回归区分。停止阶段 console helper 的 AttachConsole 诊断与临时进程清理结果沿用父会话证据，不能据此声明完整应用退出已验证。本复核不自行把任务验收项标为完成。

## 2026-10-11 截图复发修复复核

本节是后续检查，前文 2026-10-10 的部署状态不代表今天交付状态。

- 已复核新增 `Ask Codex to do anything` 占位符、完整时长与完成时钟分隔、完成边界之后 Working / 交互确认保护，以及 manager 保持 250 ms 稳定提示符与当前回合 settled 规则。
- 确认一个局部误判：普通回答在 Markdown fenced 示例中引用完整 `Worked for 8s • 02:34` 行，原新增正则会把它当完成边界，忽略前面的 Working。
- 自修：完成分隔只能是最新待命提示符之前的末尾完整行，其后仅允许空白和提示符字形；位于未闭合代码围栏内的完成示例不授权丢弃 Working。保留截图中的两空格普通分隔形式、实际分隔线装饰形式和完整结束后历史交互文字排除。
- 新增五项具体回归：反引号 fenced 引用、波浪 fenced 引用、未闭合代码引用、完成示例之后的正文续写，以及真实末尾完成分隔之前存在已闭合示例和旧交互文字。
- 独立检查 builder 的 `tui.terminal_title=['thread-id']` TOML literal，通过统一 buildCodexArgs 同时进入 argv 和预览；direct 不注入，PowerShell initialPrompt 脚本用既有 literal 转义保留内容。真实 cmd/npm/CLI 与 PowerShell startup 传播由父会话实验记录，不把源码字符串测试当实机证据。
- 窄验证：activity、manager、auto-continue、taskbar、command-builder、launch-service、launch-runtime、node-pty-lazy-loading、identity-binding 共九文件 177 项通过；包括已有 Windows PowerShell direct / PATH-only cmd wrapper 实际调用测试。
- `npm run typecheck` 通过；本轮相关五个源码/测试文件 `git diff --check` 通过，仅换行提示。项目没有 lint 脚本，未重复无变化的全套验证。
- 本检查阶段未编译或替换用户运行包、未终止用户 CLI；父会话负责随后构建和交付。真实窗口/任务栏当前显示与新包重开效果须按父会话最后证据报告。
