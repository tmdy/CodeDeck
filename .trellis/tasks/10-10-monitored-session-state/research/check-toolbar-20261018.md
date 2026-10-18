# 2026-10-18 工具栏与真实继续计划独立复核

## 确认并修复

`TerminalSessionManager.flushPendingAutoContinue` 在写 PTY 失败后已将计划置为 `send_failed` 并清除 pending generation。之后 renderer 重新 attach 会无条件进入 generation 复验，错误地将这个失败结果当成过时队列清除；新连接看不到失败原因。

自修：没有真正 pending input 时不进入 flush 校验。失败结果保留到新输入、回合变化、暂停/关闭等明确取消动作；不会因 renderer 重连二次尝试写入。仍有 pending input 的 `waiting_for_renderer` 保持原复验及发送路径。

新增具体回归先红后绿：PTY 写入失败 → renderer detach/attach → 失败状态和错误文本保留 → write 仍仅调用一次 → 新用户输入清除失败状态。

## 已复核路径

- 计划使用 controller 实际采样值与主进程排队时刻，dueAt 为二者之和，不由 Renderer 从均值重新随机。
- snapshot 深复制计划对象；状态去重比较 delay、queuedAt、dueAt、phase、error，计划变化可下发。
- 成功、暂停、禁用、新输入、会话切换、退出、关闭均取消待发送计划并通知状态；成功发出后清空计划。
- 真实 PTY write 抛错才显示 send_failed，不将输入失败报告成已发送，也不自动再排队。
- 本地倒计时单独子组件每秒更新，不逐秒 IPC、fit 或 resize；依赖计划时间与 phase，转入无计划/等待连接/失败或卸载时清 interval。
- 长标题和状态行有最小宽度与省略处理；控件区左对齐、允许窄屏换行，按钮与输入同排。父会话实际 Renderer 布局 fixture 的宽度数据见 `toolbar-20261018/renderer-measurements.json`，不把 fixture 当真实 CLI 失败证据。
- 配置均值/标准差与已排队的实际采样值区分；无队列时不根据配置捏造下次发送时间。暂停/禁用会取消队列，普通配置更新不重新采样已有队列。

## 验证

- manager 52、auto-continue 19、Bridge 35：三个文件共 106 项通过。
- TerminalApp layout：一个文件 6 项通过，含实际采样、倒计时、等待连接、无计划、发送失败、interval 清理和逐秒无额外 fit/resize。
- `npm run typecheck`：通过。
- 本轮 Renderer、styles、manager 和 manager tests 的限定 `git diff --check`：通过，仅既有换行提示。
- 项目没有 lint 脚本，未报告不存在的 lint 检查通过。未重跑无变化全套测试。

## 交付边界

本复核没有构建、替换或关闭用户应用/CLI，没有提交或发布。父会话负责随后新包和快捷方式交付。已提醒父会话补量测 1280 宽 schedule 的实际可见宽度，避免整体 header 无溢出但末尾倒计时被单行省略；最后结果以父会话新增视觉证据为准。

父会话随后补量测：2558、1920、1280、1100、1024、800 宽度的 `.terminal-schedule` 均 `scrollWidth === clientWidth`，`clipped=false`；1280 宽左栏约 377 px 可完整显示实际等待、时刻和倒计时。倒计时期间 resize 调用 13 → 13，页面错误为空。更新结果位于 `toolbar-20261018/renderer-measurements.json` 与 `toolbar-header-scheduled.png`。无需额外改动 UI。
