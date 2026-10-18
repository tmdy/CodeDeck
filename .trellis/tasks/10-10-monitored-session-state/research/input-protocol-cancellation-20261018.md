# 终端协议应答误取消队列修复

日期：2026-10-18。实现基于当前 dirty 工作树追加，不回退性能、恢复、生命周期与顶部排队显示改动。

## 证据与原因

父会话只读现场记录及 compiled manager 复现见 `focus-cancellation-20261018.md`：一次 `delayMs=65608` 的计划，在到期前收到 `terminal:send-input` 的 `ESC [ I` 焦点报告后被清空，无真正发送。manager 把所有非空输入当作人工操作取消队列，但 xterm 的焦点、鼠标和设备应答也通过同一 onData / sendInput 通道传入。

已核对已安装 xterm 源码：`CoreBrowserTerminal.ts` 的焦点、颜色、窗口尺寸应答，以及 `InputHandler.ts` 的设备属性、状态、光标位置、mode/window 和 DECRQSS 回应。不扩大通用 CSI 豁免，不把方向键或功能键当作设备回复。

## 实现

- `TerminalInputClassifier` 放在已有 `terminal-input.ts`：完整焦点、鼠标、明确 DA/DSR、private CPR、window/mode、RGB color 与 DECRQSS 回复不取消；实际文本、按键、中断、未知及不完整帧仍取消。
- 原始 input 每一块始终原样送入 PTY，分类仅决定是否取消计划及哪些字节进入 controller/activity 用户输入状态。混合包中的真实文本仍取消，纯应答不污染下次空 Enter。
- 普通 CPR 的 `CSI row;col R` 与 modified F3 存在形状重叠，因此只在已观测输出侧 `CSI 6n` 查询后一秒内认可一次，并在回合 / 会话切换边界清除旧查询授权。
- 跨块保留有界解析上下文；不完整帧当下立即取消，不引入等待 timer。后续若补成明确应答则不再把控制残片喂给输入行。未知未闭合字符串遇提交 / 中断按实际用户输入处理，不能吞掉后续提交。
- bracketed paste 起止支持跨块；粘贴正文里的 literal escape 始终按用户内容处理。清查询授权不会破坏粘贴上下文。
- manager 只在分类为人工 / 不明确输入时取消 idle fallback 与恢复队列。完整纯协议包保留 `delayMs / queuedAtMs / dueAtMs / phase`，不增加状态心跳。

## 验证

- 精确时序回归：计划 65.608 秒，在 48.791 秒注入 focus-in/focus-out，dueAt 不变，状态通知次数不变，最终只写一次继续；原始焦点字节完整保留。
- 覆盖鼠标、明确设备回复、DSR 查询相关 CPR、旧查询失效、split response 不污染空 Enter、mixed 文本、方向键、Escape、Ctrl+C、功能键及 bracketed paste literal escape。
- 现有暂停、成功、输入、关闭 / 退出取消、排队状态去重、send_failed、输出资源生命周期与 UI 投影回归保持通过。
- 相关 6 个文件 **161 项测试通过**：terminal-input、terminal-session-manager、terminal-resource-lifecycle、terminal-activity、terminal-auto-continue、terminal-app-layout。
- `npm run typecheck` 通过；限定四个源码 / 测试文件 `git diff --check` 通过（现有 LF/CRLF 提示）。

## 限制与交付

不完整 / 不明确控制序列仍会保守取消，这是刻意边界；没有把所有 ESC/CSI 放行。标准 CPR 仅有近期查询时认可，过期或无查询时按用户输入。没有向真实会话注入测试、写真实历史、终止应用、打包、提交或发布。父会话负责独立检查与构建交付。
