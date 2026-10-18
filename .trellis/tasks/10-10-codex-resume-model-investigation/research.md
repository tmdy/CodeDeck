# 会话恢复断流调查

## 结论与证据
- 当前官方启动 argv 已显式指定 `model_provider=openai_http`，配置端点为 `https://chatgpt.com/backend-api/codex`，使用 ChatGPT 认证。不是仍在向第三方发送。
- 同一 CLI 的 fresh 官方回合完成 `OK`。问题线程的只读 ephemeral fork 返回 `invalid_encrypted_content`：历史 encrypted reasoning 无法被官方解密；另一客户端把同类问题表现为 `stream closed before response.completed`。
- 问题原始文件约 166 MB，但有效 replay 是最后 window 31 checkpoint 与 suffix，包含 7 条第三方 opaque reasoning；不能按文件总大小判断请求上下文。
- 修复后的真实结构 fixture 保留 window ID、对齐 metadata、world state、回合控制记录与 226 条非 opaque reasoning 历史项；官方回合完成 `OK`。测试没有向原线程发送消息，临时 fixture 清理完成。

## 文档
- [CLI resume](https://learn.chatgpt.com/docs/developer-commands?surface=cli)：恢复支持显式配置覆盖。
- [配置](https://learn.chatgpt.com/docs/config-file/config-reference)：provider 与 profile 配置来源。
- [App Server](https://learn.chatgpt.com/docs/app-server)：thread/resume、ephemeral fork、turn 的请求与完成事件。
- [Reasoning](https://developers.openai.com/api/docs/guides/reasoning)：opaque encrypted reasoning 的会话携带机制。
- 当前 CLI Rust 源码的 replay/window/state reducer 证据见本任务 `implementation-evidence.md` 的固定版本链接；跨 provider 解密失败的具体结论来自实际官方错误返回，不是从文档推断。

## 实施与验收边界
- 只处理官方 Profile 明确的“恢复选中”；CLI 自己的 picker 和 continue_last 没有明确选中 ID，不自动改写。
- 追加恢复 checkpoint，不替换原文件字节；manifest 记录原长度/hash，保留可恢复依据，不含聊天内容或 Token。
- Windows 排他写句柄、同长度内容变化拒绝、中文与 Unicode 追加保持字节一致已有实际测试。
- 已通过 Computer Use 观察 CodeDeck 官方 Profile、选中会话和实际启动过程。该技能禁止操控 Codex CLI / ChatGPT Desktop，终端发消息验证使用独立协议测试；不宣称完成了 CLI UI 输入自动化。
- 模型列表问题按用户要求移出范围；此前 model/list 调查结果不属于本次修复验收。

## 最终结果

原“排查网络问题”线程已独占追加修复，移除7条不兼容加密推理、保留226条有效历史项，原始文件前缀完整保留。直接加载修复后的原历史，CLI和Desktop的独立官方ephemeral回合均completed、error=null、返回OK。修复幂等、manifest applied。

13项准备模块回归、3项writer回归、96项既有相关测试、typecheck和最终Electron编译通过。Windows x64本地目录包生成成功，Computer Use实际启动修复版并点击官方Profile的恢复选中成功，进程参数包含正确原UUID与model_provider=openai_http。完整证据与操作限制见 `implementation-evidence.md`。
