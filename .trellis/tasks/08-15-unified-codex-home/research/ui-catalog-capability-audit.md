# Research: UI、Favorites、SessionCatalog 与 Capability Overlay 单 Home 审计

- Query: 在 Codex 只使用用户全局 `~/.codex`（`global_codex`）作为 canonical Home 时，只读审计 UI、收藏、SessionCatalog/session-list-cache 与 capability overlay 的必要变更、测试缺口和兼容风险。
- Scope: mixed（仓库代码 + OpenAI 官方 Codex 文档）
- Date: 2026-08-16

## Findings

### 1. 关键结论 / 当前规划需要补充的约束

1. **仅把 Electron 的 Codex homes 改成 `[global_codex]` 不足以隐藏旧 Runtime 会话。** `SessionCatalog.createPage()` 当前按 provider/cwd 过滤整个持久化 snapshot，没有限制 entry 必须属于本次传入的 active homes（`src/shared/electron/session-catalog.ts:373-409`）。现有 v2 snapshot 中的 `app_runtime` entry 会继续作为“幽灵会话”出现。至少需要使旧 snapshot 失效（提升 `CATALOG_VERSION`，当前为 2，见 `src/shared/electron/session-catalog.ts:17`）；更稳妥的是同时在读页边界只接受 `sourceKeysFor(provider, codexHomes)` 中的 source，以覆盖未来 canonical Home 改路径的情况。
2. **旧 `app_runtime` 收藏会绕过会话列表继续可见、可读。** 收藏页直接展示全部持久化 favorites（`src/App.tsx:687-702`），详情请求继续转发收藏保存的 `source_home`（`src/App.tsx:2602-2621`）。因此只改 session:list 仍不满足“旧 Runtime 会话完全忽略”。UI 必须过滤/禁用 `codex + app_runtime` 收藏，且主进程详情边界必须忽略或拒绝非 canonical `source_home`；仅做 UI 过滤不是安全边界。
3. **收藏 key 兼容性必须显式选择。** 当前 key 是 `provider|source_kind|source_home|session_id`（`src/shared/state/local-state.ts:256-265`）。若单 Home 摘要仍保留 `global_codex` 和 canonical path，则已有全局收藏可继续命中；若新摘要去掉 source 元数据，则已有收藏会显示为未收藏，并可能为同一 session 产生第二条收藏。低风险过渡方案是继续给 canonical 摘要附带 `global_codex`/`source_home`，只隐藏 legacy `app_runtime` 收藏；若要简化成 `provider + session_id`，需添加明确的收藏 key 迁移/别名测试。
4. **Codex capability overlay 在 shared Home 下应跳过，而不是把目标改成 `~/.codex` 后继续执行。** 当前实现从全局 Codex Home 读取配置/skills/plugins，再向 `profileHome` 写 junction/copy（`src/shared/services/capability-overlay-service.ts:115-142`）。当 `profileHome === codexHome` 时，插件 source/target 重合，skill 仍可能被写入同一 Home 的 `.agents/skills`；这既是无意义的 self-overlay，也会把 CodeDeck 行为变成用户全局配置变更。共享 Home 已由 Codex 配置层天然继承用户 base config、MCP、plugins 和 skills，Codex 分支应 no-op/跳过；Claude overlay 保持原样。
5. **`inherit_global_capabilities=false` 的产品语义出现冲突。** 当前开关在 UI 中是 provider 无关的“继承全局 Skills / MCP / Plugins”（`src/components/settings/ParameterSettingsPanel.tsx:64-75`），而 Electron 仅在开关为 true 时准备 overlay（`electron/main.ts:1276-1300`）。共享 `CODEX_HOME` 后，即使跳过 overlay，Codex Profile 仍自然叠加在用户 base config 之上，因此该开关无法再隔离 Codex 全局能力。规划需明确：要么文案/行为改成 Claude-only（Codex 始终复用 canonical Home 能力，符合 R9），要么另行设计完整的 Codex 能力禁用层；不能继续声称 false 会隔离 Codex。

### 2. SessionCatalog 与 session-list-cache

- `SessionCatalog` 的 source identity 包含 provider + source_home（`src/shared/electron/session-catalog.ts:58-71`），后台 build 也只替换当前 source 的 entries（`src/shared/electron/session-catalog.ts:233-278`）。停止传入 App Runtime 后，不会有任何 build 主动删除旧 App Runtime source。
- 当前排序还把 `app_runtime` 置于 `global_codex` 之前（`src/shared/electron/session-catalog.ts:99-107`）。若旧 snapshot 未失效，重复 session 仍优先保留 App Runtime 版本（`src/shared/electron/session-catalog.ts:389-406`），与 canonical Home 决策相反。
- 现有 stale snapshot 测试只覆盖 v1 被 v2 拒绝（`src/shared/__tests__/electron/session-catalog.test.ts:237-262`），未覆盖“当前版本 snapshot 含旧 App Runtime、active homes 仅 global”的升级场景。
- `session-list-cache` 是进程内 TTL cache，key 已包含规范化后的完整 homes 数组（`src/shared/electron/session-list-cache.ts:39-64`）。从双 Home 切换成单 global Home 会自然形成新 key，因此它本身不会把旧双 Home响应命中到新请求；provider invalidation 仍可用（`src/shared/electron/session-list-cache.ts:75-93`）。这里主要是更新测试 fixture，而不是重写缓存算法。
- 现有 cache 测试仍大量以 `app_runtime`/双 Home 为基准（`src/shared/__tests__/electron/session-list-cache.test.ts:31-58,61-94,136-189`）。应改为单 global Home，并新增断言：双 Home legacy key 与单 global key 不同；单 global 请求绝不会执行 App Runtime loader。

### 3. UI 与 Favorites

- Profile picker 显示 `global_codex` 为“全局 .codex”、`app_runtime` 为“App Runtime”（`src/components/launcher/SessionPicker.tsx:31-39`），Session page 有同样分支（`src/components/launcher/SessionList.tsx:13-21`）。canonical 模式下正常列表不应再出现 App Runtime；保留 legacy label 没有功能价值，但真正的验收重点是上游过滤，而不是只删文案。
- 收藏页独立于 catalog/list：`visibleHistorySessions` 在 favorites 视图直接返回 `sortedSessionFavorites`（`src/App.tsx:698-702`）。因此 catalog 修复不会自动修复旧收藏泄漏。
- 收藏 normalization 继续接受 `app_runtime`（`src/shared/state/local-state.ts:209-213`）并保存其 source_home（`src/shared/state/local-state.ts:267-319`）。建议保留原始收藏记录以避免隐式破坏用户状态，但在可见集合、详情和恢复入口统一判定 canonical；若产品决定清理收藏元数据，应明确这不是删除旧 session 文件，并写升级测试。
- Profile picker 以 `session_id` 选择行（`src/components/launcher/SessionPicker.tsx:56-58,120-130`），单 Home 下不会有同 ID 多 source 冲突；Session page/favorites 仍以 favorite key 选择（`src/components/launcher/SessionList.tsx:86-98`、`src/App.tsx:704-706`）。过渡期若保留 source 元数据，无需改选择协议。
- 需要新增 App 级回归：bootstrap state 同时含 global 与 app_runtime Codex 收藏时，Favorites 只展示 global；旧 App Runtime 收藏不能触发 `getSessionDetail` 或 launch；global 收藏仍显示星标且可恢复。相关现有测试入口为 `src/shared/__tests__/components/app-session-history-provider-race.test.tsx`，组件级 fixture 中的 `app_runtime` favorite key 也需改为 canonical（`src/shared/__tests__/components/session-list.test.tsx:125-169`、`src/shared/__tests__/components/profiles-launch-panel.test.tsx:94-140`）。
- `src/shared/__tests__/state/store.test.ts:292-367` 已覆盖 global source 收藏的标准化/去重；应补 legacy App Runtime 收藏的保留或过滤策略测试，以及 canonical key 兼容测试。

### 4. Capability overlay

- Codex overlay source roots包括用户 `~/.agents/skills`、`~/.codex/skills` 及额外全局技能目录（`src/shared/services/capability-overlay-service.ts:189-205`）；target 固定为 `profileHome/.agents/skills` 和 `profileHome/plugins/cache`（`src/shared/services/capability-overlay-service.ts:124-133`）。该设计只适用于隔离的 App Runtime Home。
- skill target 已存在时会跳过，插件 target 已存在时会检测 junction/copy（`src/shared/services/capability-overlay-service.ts:282-297,306-333`），但这不是可靠的 shared-Home no-op：来自 `~/.agents/skills` 等不同根的技能仍会被写入 canonical Home，且 manifest/overlay 目录仍会被刷新。
- 现有测试明确断言目标路径包含 `codex-runtime` 并发生 skill/plugin copy/link（`src/shared/__tests__/services/capability-overlay-service.test.ts:93-160,169-235`）。共享 Home 后这些断言应删除或改成：Codex launch path 不调用 overlay；若保留 service 防御，`profileHome === codexHome` 时返回空计划且不会创建/修改 target 或 manifest。Claude overlay 测试 `:29-91` 必须保持不变。
- 官方 OpenAI 文档确认：`CODEX_HOME` 是配置、认证、日志、sessions、skills 和包元数据的共同根；`--profile name` 将 `$CODEX_HOME/name.config.toml` 叠加在 base user config 之上。因此共享 Home 本身已经提供能力继承，不需要复制 overlay：
  - https://learn.chatgpt.com/docs/config-file/environment-variables.md
  - https://learn.chatgpt.com/docs/config-file/config-basic.md
  - https://learn.chatgpt.com/docs/config-file/config-advanced.md

### 5. 必要测试清单

1. `SessionCatalog`：加载包含 `app_runtime` + `global_codex` 的旧 v2 snapshot，active homes 仅 global；结果、cursor、`has_more` 均不含 App Runtime，且 snapshot 版本升级后从 canonical source 重建。
2. `SessionCatalog`：同 session ID 两 source 的旧 snapshot 中，不能再因 `sourcePriority(app_runtime)` 选中旧版本。
3. `session-list-cache`：单 global Home key 稳定；legacy 双 Home key 不相等；provider invalidation 仍使 global 请求重载。
4. Favorites/App：旧 App Runtime 收藏在 UI 不可见、详情不读取旧 source_home、恢复不发起；global 收藏保持星标/详情/恢复；Claude 收藏行为不变。
5. 收藏 key：明确采用“保留 global source 元数据”或“canonical key 迁移”后，覆盖旧 global favorite 与新 session summary 的匹配。
6. Capability overlay：shared Home Codex launch 不创建 junction/copy、不改写用户 `config.toml`/skills/plugins/manifest；Claude overlay 原测试继续通过。
7. 参数 UI：若开关改为 Claude-only，断言文案/禁用状态；若 Codex 仍显示该开关，测试必须证明 false 的真实隔离语义，而不是只跳过 overlay 函数。

### 6. 建议验证命令

```powershell
npx vitest run src/shared/__tests__/electron/session-catalog.test.ts src/shared/__tests__/electron/session-list-cache.test.ts
npx vitest run src/shared/__tests__/services/capability-overlay-service.test.ts src/shared/__tests__/state/store.test.ts
npx vitest run src/shared/__tests__/components/app-session-history-provider-race.test.tsx src/shared/__tests__/components/session-list.test.tsx src/shared/__tests__/components/profiles-launch-panel.test.tsx
npm test
npm run typecheck
npm run build:electron
```

## Files Found

- `src/shared/electron/session-catalog.ts` — 持久化 catalog、source identity、后台刷新、最终过滤/分页。
- `src/shared/electron/session-list-cache.ts` — renderer/main 请求的 TTL/in-flight cache identity。
- `src/shared/services/capability-overlay-service.ts` — Claude/Codex 全局能力 overlay 的读取、junction/copy 与 manifest。
- `src/shared/state/local-state.ts` — 收藏 schema、source normalization、favorite key 与去重。
- `src/App.tsx` — favorites 可见集合、详情请求、恢复请求与收藏切换。
- `src/components/launcher/SessionPicker.tsx` — Profile 恢复 picker 的来源标签与选中/收藏行为。
- `src/components/launcher/SessionList.tsx` — Sessions/Favorites 页面展示、来源详情与恢复入口。
- `src/components/settings/ParameterSettingsPanel.tsx` — 全局能力继承开关 UI。
- `electron/main.ts` — Codex overlay 准备与 session IPC 的集成边界。
- `src/shared/__tests__/electron/session-catalog.test.ts` — catalog build/pagination/version 测试。
- `src/shared/__tests__/electron/session-list-cache.test.ts` — home-aware cache key 与 invalidation 测试。
- `src/shared/__tests__/services/capability-overlay-service.test.ts` — overlay link/copy 现有契约。
- `src/shared/__tests__/state/store.test.ts` — favorites 持久化/标准化测试。
- `src/shared/__tests__/components/app-session-history-provider-race.test.tsx` — App 会话/收藏/恢复集成测试入口。

## Related Specs

- `.trellis/spec/frontend/session-discovery-contract.md` — SessionCatalog 是最终过滤/分页边界，snapshot schema 变化需提升版本。
- `.trellis/spec/frontend/agent-bridge-contract.md` — Codex launch 与能力/配置 overlay 变更需保持 Claude 路径不变并覆盖 launch-service 测试。
- `.trellis/spec/frontend/index.md` — frontend spec 索引。

## Caveats / Not Found

- 本审计未修改产品代码，也未重复实现其他代理的变更。
- “旧 App Runtime 收藏是保留在存储但隐藏，还是从 local state 迁移/移除”仍需产品决策；无论选择哪种，旧 `app-data/codex-runtime/home` session 文件都不应被修改或删除。
- `inherit_global_capabilities=false` 在 shared Home 下无法沿用原隔离语义，是当前规划最明确的未决兼容点。
