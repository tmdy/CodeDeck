# 2026-10-18 终端栏压缩与自动继续排队可见性

用户通过截图明确要求将“应用”按钮并入上排，设置向左利用空白、降低header高度以增加终端可视区域；左侧应展示本次随机等待的真实秒数与预计下一次输入时间，使排队等待和没有安排自动继续可区分。

## 实施范围

- 复用当前终端manager的唯一实际发送队列。抽样一次，快照传递实际delay与到期时间；界面不再次随机采样，不用分布均值伪造下次发送时间。
- 明确显示已排队等待、到期等待终端接收、未安排输入，以及现有暂停/关闭/次数用尽状态。成功、新输入、终止、暂停等取消时清理计划并发布状态；旧计划不能残留。
- Renderer只在有计划时使用本地秒级倒计时，避免每秒IPC及无效PTY fit；保持事件去重和输出buffer性能改动。
- 宽屏设置与应用按钮同排；收紧标题/控件占比，关键词合理收缩；窄窗口可换行但不横向溢出。已有输入、复制粘贴和运行时草稿行为保留。
- 验证manager队列时间/取消边界、组件倒计时及无计划文案、相关typecheck，并用实际Renderer的测试API快照在多个宽度检查布局。此视觉验证不冒充真实CLI发送或已更新运行安装包。

本次延续现有已授权监控任务；不改重试授权/次数预算/分布算法，不向用户正在工作的终端注入输入，不主动停止会话或提交发布。

## 验证结果

- 实施相关 5 文件 113 项测试/typecheck 通过；独立检查修复 send_failed 在 renderer 重连时被误清除的边界，相关 4 文件 112 项/typecheck 通过。这些测试范围重叠，不相加为独立总数。
- Playwright 实际加载当前 Vite Renderer，注入专用 terminalManager fixture，不连接真实 CLI 或账户。2558/1920/1280 宽度 header 约 75.14px，暂停与应用按钮同高，无横向溢出；800 宽正常两排 header 约 131.18px。
- 真实排版量测 .terminal-schedule 在 2558/1920/1280/1100/1024/800 宽均 scrollWidth 等于 clientWidth；1280 左栏 377px 仍完整显示本次 48.6 秒、具体时间与倒计时。
- 配置均值 50 秒、实际计划 48.6 秒，界面显示 48.6 秒，倒计时变化正常；到期等待连接与取消后未安排文案均正确。倒计时期间 resizeSession 调用保持 13→13，没有页面异常。
- 首次补充宽度检查遇 Chromium 导航 ERR_ABORTED；以 DOMContentLoaded 并对该单一瞬时错误重试后，完整检查通过。最终结果见 `toolbar-20261018/renderer-measurements.json`；预览见 `toolbar-20261018/toolbar-header-scheduled.png`。
- 这证明 Renderer 布局与 schedule 投影；真实队列行为由 manager 回归验证，不宣称 fixture 是真实模型调用或当前运行包已热更新。

## 交付

- 独立新包：`release/terminal-toolbar-schedule-20261018-195124/win-unpacked/CodeDeck.exe`；构建与包内字节核对见 `package-toolbar-20261018.md`。
- 开始菜单 `C:/Users/you/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/CodeDeck.lnk` 已设置为新目标并回读校验；旧目标为 `release/monitored-session-state-20261011-095220/win-unpacked/CodeDeck.exe`。
- 原运行应用及CLI未关闭；新主进程与终端UI须完全退出旧应用再通过快捷方式启动后生效，不把快捷方式变更冒充现有窗口热更新。
- 父会话专用 Vite 测试服务已停止，Playwright测试浏览器已关闭。未提交、推送或上传安装包。
