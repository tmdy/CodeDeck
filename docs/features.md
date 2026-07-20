# 功能证据

这份清单记录 README 主要功能对应的实现位置。它不是 API 文档，作用是防止功能描述跑到代码前面。

| 功能 | 实现 | 测试 |
| --- | --- | --- |
| Profile、启动计划与敏感值预览 | `src/shared/profile/types.ts`、`src/shared/services/launch-service.ts` | `src/shared/__tests__/services/launch-service.test.ts` |
| Claude/Codex 权限生成 | `src/shared/profile/permissions.ts`、`src/shared/services/model-mapping-config-service.ts` | `src/shared/__tests__/services/launch-service-permissions.test.ts` |
| Codex runtime 和全局能力 overlay | `src/shared/services/capability-overlay-service.ts` | `src/shared/__tests__/services/capability-overlay-service.test.ts` |
| Skills 扫描、预览、批处理和回滚 | `src/shared/skills-service.ts` | `src/shared/skills-service.test.ts` |
| PTY、终端状态和自动继续 | `src/shared/electron/terminal-session-manager.ts`、`src/shared/electron/terminal-auto-continue.ts` | `src/shared/__tests__/electron/terminal-session-manager.test.ts`、`terminal-auto-continue.test.ts` |
| Claude/Codex 会话读取与导入 | `src/shared/services/session-service.ts` | `src/shared/__tests__/services/session-service.test.ts` |
| 本地加密存储 | `src/shared/crypto/` | `src/shared/__tests__/crypto/store.test.ts`、`fernet.test.ts` |
| 余额与站点会话 | `src/shared/services/balance-service.ts`、`src/shared/balance/` | `src/shared/__tests__/services/balance-service.test.ts` |

公开文档不应根据 UI 文案推断功能。新增条目时至少要有实现入口，涉及数据或命令生成的行为还应有测试。
