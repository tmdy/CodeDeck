# Design

- 沿用现有 `StatusBadge`、按钮和原生 `details`，只调整组合结构和 CSS。
- 渠道健康徽章直接复用现有 presentation 输出，在组件内追加格式化延迟；完整详情写入 `title`。
- 签到摘要包含奖励，完整 message、奖励、时间和诊断编号写入徽章 `title`；人工验证按钮保留在徽章旁。
- 全局设置第一张卡使用 `settings-form-list` / `settings-form-row`，页面容器通过 `max-width: 680px` 控制宽度。
- 余额检测底层 endpoint 元信息不再传给会话面板；会话提示和最近检测时间也不再占据独立文本行。
