# Implementation plan

1. [x] 检查现有验证轮询 fixture 与站点响应解析，确认成功后未被识别的响应形状。
2. [x] 在 `checkin-verification-service.ts` 中以最小改动扩展“今日已签到”解析，保留严格日期/布尔校验。
3. [x] 增加解析回归测试，覆盖今日历史记录与历史日期排除；现有服务生命周期测试继续覆盖窗口关闭与任务清理。
4. [x] 运行聚焦 Vitest、`npm run typecheck` 与 `git diff --check`；全量测试仅有一个与本次改动无关的既有 UI 失败。
5. [x] 使用 Trellis quality check 复核鉴权隔离、状态流转和回归风险。
