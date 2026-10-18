# 隔离 ConPTY 集成验证

2026-10-10，父会话使用本次 `build:electron` 编译出的 manager、identity resolver 和 lifecycle parser，连接真实 node-pty / Windows ConPTY / Codex 0.160.1。

- 独立临时 CODEX_HOME、cwd 和本机 HTTP 服务；未复制真实 auth/config，未调用外部模型、改用户历史或向已有终端输入。
- raw OSC 解析出的 hint 由 metadata 解析为 UUID 和 session file，实际关联成功。
- 服务返回 503 high demand，真实 task_complete.error 解析为 failed；manager 创建一次 matched/queued/flushed，PTY 实际写入 `继续\r`。
- 然后由本测试提交下一次输入并让本机服务返回合成 responses SSE。真实 CLI 写出 task_complete success；manager 最终 activity 为 idle。
- 合成成功回答正文包含 `high demand`，没有新增自动继续动作。累计 matchCount 保持 1；与用户原始 -1 无限上限不同，此实验设置 limit=1 以严格限制测试写入。
- 生命周期观察为 started / failed / started / completed；活动观察为 busy_output、turn_failed idle、submitted_input busy、turn_completed idle。
- 关闭后 PTY exit=true，临时目录已清理；node-pty console helper 仍打印 AttachConsole failed。这是实测限制，不能报告完整应用退出无诊断。

此实验使用模拟 Renderer subscriber 与父会话增量读 JSONL 后调用 reportTurnLifecycle，没有覆盖 main.ts watcher、实际 BrowserWindow / Windows 任务栏及安装包。HTTP 请求包括 CLI 辅助请求，不按请求数量推断回合数量。成功文本为本机测试服务合成，不代表真实模型可用性。

独立检查随后修复显式 thread switch 清除旧展示名称；该修复须以相应回归/类型检查核实，不冒充已包含在上述实验中。
