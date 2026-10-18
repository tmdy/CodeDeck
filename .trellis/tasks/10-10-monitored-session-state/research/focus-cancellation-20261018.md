# 焦点报告误取消自动继续

## 现场证据

2026-10-18 用户截图：高峰错误包含 high demand，自动继续启用、limit=-1、随机均值60秒/标准差10秒；已触发1次但未安排自动继续。当前运行包核实为 terminal-toolbar-schedule-20261018-195124。

- 会话4039...c3d8在北京时间19:54:49.994被识别为 retryable failed，19:54:49.996 queued，delayMs=65608，即预计19:55:55.604输入。
- 同一会话19:55:38.787的 `terminal:send-input` IPC参数是纯焦点报告 `ESC[I`；之后没有该动作的flushed日志。
- manager.sendInput的非空data分支会先无条件cancelPendingAutoContinue，错误地把终端协议上报当作手动输入。
- 父会话通过compiled manager+FakePTY隔离复现：建立65608ms计划后只传ESC[I，schedule立即消失，matchCount仍为1，PTY仅收到ESC[I而没有继续。这解释了截图显示未安排但计数1；次数是触发计划数，不是成功发送数。

未向用户真实会话注入任何输入。用户随后明确授权修复。

## 实施约束

仅对可明确识别的焦点、鼠标和设备应答消息保留已排队动作，原始数据仍转发给PTY；用户文本/粘贴/按键和混合真正输入继续取消，未知或不完整有歧义的控制序列保持保守。不能把所有ESC序列都视为非用户消息，方向键、Esc、Ctrl+C仍是用户操作。同步回归schedule原dueAt不变、到期一次发送、既有暂停/完成/关闭取消边界。

## 实施与独立验证

- 实施与回归见 `input-protocol-cancellation-20261018.md`，独立检查见 `check-focus-20261018.md`。独立5文件157项通过；测试范围与实施161项重叠，不相加。typecheck/diff-check通过。
- 增加有界TerminalInputClassifier。纯明确报告不触碰等待/idle fallback或输入行，混合数据保留真正输入用于tracking，所有原始字节仍写PTY。普通CPR存在功能键歧义，仅对已观测、短时、一次性查询授权；回合/切换清查询但保留粘贴上下文。
- 父会话使用当前编译模块、真实时钟和FakePTY单独核实：80ms计划，10ms后发送focus-in/out，dueAt保持，最终恰好一次继续；同样条件追加真实字符x则零次继续。两个场景原始焦点字节均完整转发，最终队列清空、matchCount保持1。没有连接真实CLI或向用户会话输入。

## 交付

新包 `release/terminal-focus-retry-20261018-200548/win-unpacked/CodeDeck.exe` 已完成构建和包内107模块/18项Renderer资源来源一致性核对；详细证据 `package-focus-20261018.md`。开始菜单 CodeDeck.lnk 已从 terminal-toolbar-schedule-20261018-195124 更新为该新目标，并回读验证存在。旧应用/用户CLI未停止，修复须完全退出旧CodeDeck再从快捷方式启动后生效；已被旧代码取消的计划不作未经授权的补发。
