# 调查设计

仅研究会话来源与恢复配置优先级，模型目录移出范围。沿用 canonical Codex Home；从官方 CLI / config / app-server 文档校对现有 prepareLaunchExecution → LaunchService → command builder 链路。读取安全的配置投影和打包源码，不输出认证内容。定位实际失败后在已有职责层修复，同步必需调用方。

实测 fresh 官方会话完成 OK；问题历史的 ephemeral fork 返回 invalid_encrypted_content，确认不是路由仍在第三方。官方恢复 prepare 阶段仅针对明确 resume_selected：重建最后 checkpoint 与后续 response items，移除其他 provider 的 opaque encrypted reasoning，保留可见消息、工具调用与结果、索引对齐元数据、窗口 ID、retained/guardian 状态和最新控制记录。

prepare 只读；commit 在 Windows FileStream 独占写句柄下核对原长度/SHA256，追加新 compaction 与控制状态，不覆盖原字节。write/flush 异常在同句柄内截断回原长度。保存不包含对话内容的恢复 manifest（原长度/hash/追加hash）。不强制中断写入helper，避免半行写入。

marker 与 runtime provider 归属保证后续官方生成的正常 encrypted reasoning 不被重复清理。分页 checkpoint 与控制状态依据当前 CLI 源码和真实同结构 fixture验证；不支持的 rollback/损坏结构直接拒绝，保留原文件。

最终 GUI 验收沿用 Computer Use 技能；遵守其支持范围，若运行时不可用或目标被禁止则记录阻塞，不用其他自动化绕过。
