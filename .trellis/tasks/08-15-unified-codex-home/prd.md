# 统一 Codex Home 与共享会话

## Goal

以用户 Codex Home（默认 `~/.codex`）作为唯一会话状态根目录，让原生 Codex 与 CodeDeck 第三方站点 Profile 原地读取和恢复同一会话，消除每次恢复前的跨 Home 会话复制。

## Background

- Codex 官方语义中，`CODEX_HOME` 同时承载本地配置与状态；`--profile <name>` 只叠加 `$CODEX_HOME/<name>.config.toml`，不会创建独立会话仓库。
- 当前 CodeDeck 将所有 Codex 启动强制指向 `app-data/codex-runtime/home`，同时扫描该目录和用户 `~/.codex`。
- 当前从用户 Codex 会话恢复时，会把目标 session JSONL 和索引记录复制到 App Runtime，然后从副本恢复。
- 本机当前用户 `~/.codex` 与 App Runtime 分别包含大量会话，App Runtime 还保存 CodeDeck 生成的站点 Profile 文件。
- CodeDeck 当前还会向 Runtime Home 写基础 `config.toml`、全局规则、Agent 定义以及能力 Overlay；这些写入不能未经隔离直接迁移到用户 Home。

## Requirements

- R1. 使用用户 `~/.codex` 作为原生 Codex 与第三方站点 Profile 的共同 `CODEX_HOME`。
- R2. 原生 Codex 与第三方站点启动继续通过 `--profile site-<hash>` 区分模型提供方、模型与站点连接配置，而不是通过不同 `CODEX_HOME` 隔离。
- R3. CodeDeck 会话列表、详情和恢复只使用用户全局 `~/.codex`，不再扫描、合并、显示或恢复旧 App Runtime 会话。
- R4. 恢复任何已有 canonical Home 会话时必须原地使用相同 session ID 和 transcript，不得在启动路径中复制 JSONL 或追加复制索引记录。
- R5. 站点 API Key 继续只通过启动子进程环境变量注入；Profile 文件只引用环境变量名，不得把密钥写入用户 `.codex`。
- R6. CodeDeck 只能修改具有明确 CodeDeck 所有权的 Profile/辅助文件，不得清理、重排或覆盖用户 `config.toml` 中无关的 Profile、Provider、MCP、Plugin、Project 或其他配置。
- R7. 共享 Home 后不得写入会影响直接 Codex 的全局 Codex 权限规则；本阶段明确移除 Codex 的“禁止 Git push/危险删除”两项限制。Claude 的同名权限行为保持不变。
- R8. CodeDeck 的站点 Worker Agent 和能力继承不得泄漏到未选择该站点 Profile 的直接 Codex 会话。
- R9. 共享 Home 时复用用户已有 MCP、Plugins、Skills 与基础配置，禁止把同一 Home 的能力复制或链接回自身。
- R10. 本任务不执行现有 App Runtime 会话归并，也不删除或修改旧 Runtime 数据；旧会话在当前产品界面中被完全忽略，并留待后续独立迁移任务处理。

## Acceptance Criteria

- [ ] AC1. 从 CodeDeck 通过第三方 Profile 新建的会话，无需复制即可由直接 Codex 使用 session ID 或 `resume --all` 发现并恢复。
- [ ] AC2. 直接 Codex 创建的会话，无需复制即可由 CodeDeck 选中，并使用任意有效第三方 Profile 继续同一 session ID。
- [ ] AC3. 恢复前后 canonical Home 中不会因启动操作新增第二份相同会话 JSONL，也不会由 CodeDeck 为正常恢复改写 `session_index.jsonl`。
- [ ] AC4. 直接 Codex 不带 CodeDeck 站点 Profile 启动时，仍使用用户原有认证和基础配置，不受最后一次 CodeDeck Profile 的 Provider、权限规则或 Worker Agent 污染。
- [ ] AC5. CodeDeck Profile 删除、重建或切换不会修改无关的用户 Profile 和基础配置块。
- [ ] AC6. 第三方 Profile 启动仍能正确注入站点 API Key、Provider、模型和必要能力，且敏感值不落入 Profile 文件；Codex 不再生成或加载 CodeDeck 全局 Git push/危险删除规则。
- [ ] AC7. 无权限或无效 Home 等失败给出可操作错误，不破坏原始会话；本阶段不触发旧会话迁移。
- [ ] AC8. 会话列表缓存、详情读取、收藏和分页在单 Home 模式下保持正确，旧双 Home 缓存不会产生幽灵或重复会话。
- [ ] AC9. 相关单元测试、类型检查和构建通过。
- [ ] AC10. 旧 App Runtime 中独有的会话不会出现在会话列表或恢复选择器中，选择和恢复流程也不会触发任何跨 Home 复制。

## Out of Scope

- 改变 Codex 官方 session JSONL、索引或 Profile 文件格式。
- 在 CodeDeck 内实现一套独立于 Codex 的会话数据库。
- 通过仅 junction/symlink `sessions/` 的非官方混合状态布局长期运行。
- 自动删除旧 App Runtime；完成迁移验证前必须保留回滚来源。
- 将现有 App Runtime 会话、索引或历史归并到用户 `~/.codex`；该工作延后到共享 Home 正常运行后的独立迁移阶段。
- 为 Codex 重新实现 Profile 级 Git push/危险删除拦截；本阶段接受该限制移除。
