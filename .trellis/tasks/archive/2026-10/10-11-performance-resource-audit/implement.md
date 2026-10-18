# 实施顺序与验证

## 阶段 A：审计与修复前基线

- [x] 检查 Git、已有任务/契约、实际运行产物；建立本任务，记录已有 dirty 边界。
- [x] 完成相关入口与资源所有权审计。
- [x] 增加合成模块基准、Windows 进程树采样、隔离 Electron 可复用场景。
- [x] 在修改产品代码前保存基线；运行现有相关功能测试。

## 阶段 B：确认后的低风险修复

- [x] manager 关闭释放、退出清理与解除订阅闭包。
- [x] 有界增量输出缓冲、状态变化通知；Renderer 增量提示与尺寸去重。
- [x] SessionListCache 有限容量与惰性过期清理。
- [x] 针对退出/重连/跨块输出/状态变化/缓存并发建立具体回归。

## 阶段 C：验证与交付

- [x] 运行 terminal manager/activity/auto-continue/lifecycle/identity、TerminalApp、Agent Bridge、session-list-cache/session-service/catalog 相关测试。
- [x] `npm run typecheck`；根据真实跨模块风险决定是否需要其余测试，不运行安装器打包。
- [x] 用相同负载重复模块及 Electron 测量，保存原始结果与比较。
- [x] `git diff --check` 与局部差异审阅，更新报告和本任务进度。

## 最终验证记录

- 修改前相关回归 161 项；扩展检查 230 项通过，批次有重叠。
- 最终关闭清理修正：`terminal-session-manager` 40、`terminal-resource-lifecycle` 6、Bridge task-manager 35、health main-integration 3，共 84 项通过；最终 typecheck 通过。
- 最终 Electron：`after-final-electron.json`，12 场景完整，4 个 xterm 结束标记通过，20 次开关及 60 秒空闲恢复；源码 hash 与当前产品代码一致。
- 最终模块：`after-final-core.json`（3×2,000 活动块）与 `after-settled.json`（3×2,000 settled 块），原始输出全部一致；200 次关闭后保留为 0。
- 进程复测识别并修正“已退出 PTY 跳过 kill 导致输出 Worker 存活”的中间回退；窗口历史、尾部排空和 kill 重试仍正确。
- 既存 `PipeWrap`/conhost 残留、活动回合重放和前台/长期真实 CLI 验收未完成，详见报告后续排序。本轮没有降低轮询频率、引入 GC 或修改依赖。
- `electron/main.ts` 与 `terminal-activity.ts` 当前 SHA256 与修复前构建一致；不将这些文件内其他任务的既有变更归到本轮。

最终报告必须包含问题根因、文件/逻辑、收益机制、测量口径/前后数据、验证结果、未测项、未解决问题及下一阶段排序。没有 Git 提交/发布授权，不提交、不推送、不更换用户运行产物。
