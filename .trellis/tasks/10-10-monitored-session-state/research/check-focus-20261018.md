# 2026-10-18 焦点报告误取消：独立复核

## 现场与修复范围

现场故障证据见 `focus-cancellation-20261018.md`：实际计划等待 65.608 秒，尚未到期即被纯 `ESC[I` 焦点报告取消。用户已明确授权修复。

本次复核直接检查 `terminal-input.ts`、manager sendInput/PTY output 接线及对应测试；未派发更多代理，没有向真实终端注入输入、终止用户进程或打包发布。

## 已检查并反馈修复

- 纯焦点、明确鼠标协议和白名单设备应答不取消已排队动作，不取消稳定 idle 提示符 timer，也不污染 controller/activity 的输入行。
- 原始 `data` 始终原样写入 PTY；分类后的 `userInput` 只用于本地输入跟踪，不修改交互协议。
- 普通文本、混合输入、方向键、Esc、Ctrl+C、功能键及未知/不完整序列仍立即按用户操作取消，无额外宽限或发送延迟。
- bracketed-paste 上下文保留，粘贴内字面的焦点控制串不当成协议应答；未知未终止 OSC 遇提交或中断不会吞掉整行。
- 普通 CPR 与 modified F3 形状冲突，只有当前输出已观察到 DSR 查询时才授权忽略该 reply；token 有限、一次性消费且一秒过期。
- 独立审阅发现初版 query token 可跨回合保留，将旧 query 之后的新 Shift+F3 误当设备应答。已反馈实施代理并确认修正：accepted lifecycle、openTurn 与 provider-session reset 清 query token/output query tail，同时保留 paste 上下文。已加入 classifier 和 manager 跨回合回归。
- send_failed 结果保留、renderer attach 前复验、成功/新输入/暂停/禁用/切换/退出/关闭取消、累计预算和元数据去重沿用本任务既有回归。

## 验证

独立执行五个测试文件共 157 项通过：

- terminal-input：35。
- terminal-session-manager：62。
- terminal-auto-continue：19。
- terminal-app-layout：6。
- Agent Bridge task-manager：35。

`npm run typecheck` 通过；本轮四个实现/测试文件的 `git diff --check` 通过，仅既有换行提示。项目没有 lint 脚本，未声明 lint 通过。

manager 回归覆盖现场相同的 65.608 秒计划在 48.791 秒收到 focus in/out、dueAt 不变、无额外状态广播、到期仅发送一次；设备应答后空 Enter 不被误当非空提交。

## 结论与证据边界

没有其他确认的任务相关阻塞，源码可交由父会话构建。父会话负责 compiled FakePTY 真实时钟复现反转、新包与快捷方式交付；本报告的假时钟测试不冒充真实 CLI/当前应用的发送证明。未知或残缺协议保持保守取消，这是本次明确边界，不声称支持任意终端控制序列。
