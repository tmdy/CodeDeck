# Journal - tmdy (Part 1)

> AI development session journal
> Started: 2026-08-01

---



## Session 1: SQLite logs trigger and WAL repair

**Date**: 2026-08-05
**Task**: SQLite logs trigger and WAL repair
**Branch**: `main`

### Summary

Backed up Codex global and CodeDeck project logs_2.sqlite databases, installed codex_block_logs_insert triggers, checkpointed/truncated WAL, verified MAX(id) and WAL stability, added maintenance script/tests/spec, and passed typecheck plus 773 Vitest tests.

### Git Commits

| Hash | Message |
|------|---------|
| `d85969c` | (see git log) |

### Status

[OK] **Completed**


## Session 2: Hide Codex subagent sessions

**Date**: 2026-08-11
**Task**: Hide Codex subagent sessions
**Branch**: `main`

### Summary

Added a default-on Codex sub-agent session visibility filter across settings, session parsing, catalog pagination, request caches, and both session list entry points; verified 807 tests, typecheck, and Windows NSIS packaging.

### Git Commits

| Hash | Message |
|------|---------|
| `7bfc731` | (see git log) |

### Status

[OK] **Completed**


## Session 3: 即时参数、持久多代理与浏览器鉴权

**Date**: 2026-08-14
**Task**: 即时参数、持久多代理与浏览器鉴权
**Branch**: `main`

### Summary

实现保存参数即时记忆、持久化 Agent Bridge 讨论与中断控制、浏览器托管后端鉴权和签到，并完成 Electron 冒烟测试与 Windows NSIS 打包。

### Git Commits

| Hash | Message |
|------|---------|
| `5776223` | (see git log) |
| `560bc2e` | (see git log) |
| `2d266dc` | (see git log) |

### Status

[OK] **Completed**


## Session 4: Codex working directory trust

**Date**: 2026-08-15
**Task**: Codex working directory trust
**Branch**: `main`

### Summary

Trust the selected Codex cwd per launch, preserve hooks disablement, normalize Windows project keys, and verify arbitrary Bridge cwd without a trust prompt.

### Git Commits

| Hash | Message |
|------|---------|
| `54d4f14` | (see git log) |
| `8c2ed68` | (see git log) |

### Status

[OK] **Completed**


## Session 5: 修复站点登录态浏览器分区

**Date**: 2026-08-16
**Task**: 修复站点登录态浏览器分区
**Branch**: `main`

### Summary

修复打开 Base URL 与浏览器登录检测分区不一致导致页面已登录但识别 403 的问题；新增结构化 ProfileBrowserTarget、pending 分区生命周期、主进程分区路由、默认最低浏览器槽位选择及回归测试。定向 39 项与 typecheck 通过；全量测试唯一失败属于并行 ProfileEditForm 映射断言。

### Git Commits

| Hash | Message |
|------|---------|
| `bd69a2a` | (see git log) |

### Status

[OK] **Completed**


## Session 6: 统一 Codex Home 与共享会话

**Date**: 2026-08-16
**Task**: 统一 Codex Home 与共享会话
**Branch**: `main`

### Summary

统一 CodeDeck 与原生 Codex 使用用户 ~/.codex；第三方站点保留 Profile，恢复不再复制会话；旧 Runtime 本阶段忽略；完成测试、类型检查并在独立发布目录生成安装包。

### Git Commits

| Hash | Message |
|------|---------|
| `db450d3` | (see git log) |

### Status

[OK] **Completed**


## Session 7: 修复浏览器验证码签到回调

**Date**: 2026-08-17
**Task**: 修复浏览器验证码签到回调
**Branch**: `main`

### Summary

扩展人工签到验证轮询对当日签到历史记录的识别，恢复成功后的窗口关闭与状态回写；生成 Windows NSIS 安装包。

### Git Commits

| Hash | Message |
|------|---------|
| `d6a33bf` | (see git log) |

### Status

[OK] **Completed**


## Session 8: 自定义余额与签到兼容

**Date**: 2026-08-20
**Task**: 自定义余额与签到兼容
**Branch**: `main`

### Summary

完成可选的自定义余额/签到兼容规则：支持独立 API、网页 CSS selector、页面签到与人工验证码回流；统一账号 partition、跨 origin 明确授权和旧路径兼容。聚焦测试、完整测试与 typecheck 通过；Windows 打包受运行中的 CodeDeck 进程锁定而未完成。其他并行任务改动未纳入。

### Git Commits

| Hash | Message |
|------|---------|
| `9b19563` | (see git log) |

### Status

[OK] **Completed**


## Session 9: 修复 Profile 浏览器首次可见延迟

**Date**: 2026-08-20
**Task**: 修复 Profile 浏览器首次可见延迟
**Branch**: `main`

### Summary

确认 Profile Base URL 窗口因等待初始导航完成才显示而体感缓慢；改为先显示和聚焦窗口，再执行 30 秒有界导航，保留分区、安全导航与失败关闭行为，并通过完整测试和类型检查。

### Git Commits

| Hash | Message |
|------|---------|
| `3dfcfd3` | (see git log) |

### Status

[OK] **Completed**
