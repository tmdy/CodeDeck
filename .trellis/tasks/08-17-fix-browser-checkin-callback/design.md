# Technical design

## Boundaries

保持 `electron/main.ts` 的签到编排与 `CheckinVerificationService` 的任务生命周期不变，仅调整验证结果解析及其回归测试；浏览器账号仍通过已有 `ManagementRequestContext` 发起轮询请求。

## Data flow

```text
验证码窗口 -> 站点签到请求
          -> CheckinVerificationService.pollTask()
          -> fetch /api/user/checkin?month=...
          -> inspectVerificationStatus()
          -> completeTask()
          -> main.ts merge/persist -> renderer progress
```

成功判定必须同时满足：验证身份已确认、响应表示今日记录已签到。解析器应支持当前已存在的 `stats.checked_in_today` / `checked_in_today`，以及有明确日期的签到历史记录；历史日期、错误响应和非布尔模糊文本不应命中。

## Compatibility and rollback

只增加纯函数解析分支与测试，不改变请求 headers、partition、cookie 或窗口安全策略。若真实站点响应字段尚未得到证据，保留现有字段并先补充诊断 fixture；可单独回滚解析器变更。
