# 当前 CLI 最终失败落盘实测

日期：2026-10-10。父会话使用当前 node-pty / Windows ConPTY 和 Codex 0.160.1。

- 创建独立 OS 临时目录及 CODEX_HOME；没有读取、复制真实 config/auth，没有调用外部模型或向用户会话注入输入。
- 本机 HTTP 服务仅返回 503 JSON：`error.message = high demand temporary errors`。测试 provider 使用 responses 协议，request_max_retries / stream_max_retries 为 0，启动提示词 `say test`。
- 实际 JSONL 出现 `event_msg.task_started` 和相同 turn_id 的 `event_msg.task_complete`。
- 最终 error 形状：`{ message: "unexpected status 503 Service Unavailable: high demand temporary errors, url: http://127.0.0.1:<port>/v1/responses", codex_error_info: { http_connection_failed: { http_status_code: 503 } } }`。task_complete 同时包含 started_at / completed_at / duration_ms。
- raw PTY 同时出现最终 `■ unexpected status 503 ...` 和 thread-id OSC。因此当前版本有结构化最终失败，不需要仅按屏幕错误词回退授权。
- CLI 同时显示首次 Windows sandbox 设置页，未自动选择选项；这次证据仅证明本地 503 最终失败与落盘格式，不代表完整应用交互验证。
- 停止阶段 node-pty console helper 打印 `AttachConsole failed`；脚本退出码为 0，专用临时目录已清理。仍需确认完整应用关闭清理行为，不能隐去该诊断。

此实验不等于已更新正在运行的 CodeDeck 构建，也不覆盖成功回复、并发会话或自动继续端到端。
