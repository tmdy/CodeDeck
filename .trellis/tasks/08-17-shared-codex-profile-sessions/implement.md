# Implementation Plan

## 1. Current-Profile Resume Override

- [x] 在 Codex launch request/command builder 的现有结构化参数中加入 resume provider override，避免拼接用户 CLI 文本。
- [x] 仅对 native Codex resume 解析并追加当前有效 provider；新会话保持现状。
- [x] 保持 site Profile 的 `--profile site-<hash>` 与当前 model/provider 优先语义。
- [x] 添加最小测试：native resume 有 override、native new 无 override、site resume 不读取历史 provider。

## 2. CodeDeck-Owned Provider Registry

- [x] 在现有 model mapping/config service 中增加 managed provider block 的生成和原子同步。
- [x] 保留 `config.toml` managed block 外的原始内容，检测同名外部 provider 冲突。
- [x] 从已保存 Codex site Profiles 生成非敏感 provider 定义；保存、更新、删除和解锁后同步。
- [x] 添加最小测试：首次插入、幂等更新、删除、外部内容字节保持、冲突拒绝、写入失败保留旧文件。

## 3. Single-Provider Credential Broker

- [x] 扩展现有本地 Bridge 协议，增加只接受稳定 provider ID 的 token 请求与明确错误码。
- [x] Electron handler 从已解锁 `EncryptedConfigStore` 精确映射一个 Codex Profile，并返回一个 token。
- [x] 为 packaged `codedeck-agent` 增加 `auth-token --provider <id>`，成功时 stdout 只输出 token，失败时 stdout 为空。
- [x] 确认成功响应、异常和测试快照均不记录 token。
- [x] 添加协议、server、CLI 测试：成功、未运行、未解锁、未知 provider、错误 provider、无 token 泄漏。

## 4. Unify Site Authentication

- [x] 将 site Profile provider 从 `env_key` 改为与全局 registry 相同的 `auth.command/args`。
- [x] 删除 site launch 的临时 API key 环境注入，保留现有 provider/model/base URL/wire API 行为。
- [x] 通过 Electron main 注入稳定的 packaged auth helper 路径；测试使用显式 fixture 路径。
- [x] 添加测试确保有效 provider 不会同时包含 `env_key` 与 `auth.command`。

## 5. Lifecycle Integration

- [x] 在存储解锁成功后同步 registry；在 Codex site Profile 保存、更新、删除后同步。
- [x] 锁定或退出时不删除 registry，但 broker 必须拒绝秘密请求；退出时清理 pipe/connection file。
- [x] 失败路径向现有调用方返回可诊断错误，不做明文或环境变量回退。

## 6. Validation

- [x] 运行相关 Vitest：launch service、command builder、model mapping config、Agent Bridge server/CLI、Electron launch/runtime。
- [x] 运行 `npm run typecheck`。
- [x] 运行 `npm run build:electron`。
- [x] 只读/真实 smoke：官方 Profile 恢复第三方会话；第三方 Profile 恢复官方和另一第三方会话。
- [x] Desktop smoke：使用用户指定的 Codex Profile“星辰AI”，先关闭当前运行的旧版/旧构建 CodeDeck EXE，启动本次新构建，再通过新建的有头监控会话端口执行 `/app` 并发送一条测试消息；随后验证 CodeDeck 未运行或锁定时不含秘密的失败行为。
- [x] 对比 smoke 前后会话 JSONL 路径与 session ID，确认未复制或预处理；检查 `config.toml` managed block 外内容未变化。

Smoke 记录（2026-08-18）：

- 新目录构建使用进程级代理 `http://127.0.0.1:10808` 成功；`release/win-unpacked/CodeDeck.exe` SHA-256 为 `FF9C21697777AF6D3D8EE8467AC899600628846EF9EAD54ED735F21FB509C97B`。
- packaged CodeDeck 已启动并解锁；有头 Agent Bridge 会话使用 `codex::星辰·AI` / `gpt-5.6-sol` 返回 `APP_BRIDGE_READY`，无 provider/auth 错误。
- 同一监控会话执行 `/app` 后 Desktop 显示相同 prompt 和响应，证明全局 provider registry、Desktop 会话发现和 broker 成功路径可用。Codex session ID 为 `01a01092-a309-7fc0-b1d1-8782a018ee56`。
- CLI 监控任务正常结束后，用户在 Desktop 人工点击“重试”，占用提示消失且 composer 可用；Desktop 继续使用会话原始 `site_provider_46af1e48d1a0fe41`，不受 CodeDeck 当前选中 Profile 影响。
- 跨 Profile 真实续发通过：星辰·AI 创建的 `01a010a0-ca82-7711-928b-45593a96c525` 由官方 provider 原 ID 续接并返回 `CROSS_OFFICIAL_RESUME`，当前官方模型为 `gpt-5.6-terra`；官方创建的 `01a010a1-eef8-7bb3-983d-ce26b66b97bd` 由星辰·AI 原 ID 续接并返回 `CROSS_SITE_RESUME`；999Code 创建的 `01a010a2-d28d-79d1-8909-3ee3295e7d8d` 由星辰·AI 原 ID 续接并返回 `CROSS_OTHER_SITE_RESUME`。
- 三个续接命令的 `thread.started.thread_id` 均与原 session ID 完全一致；会话继续写入全局 `C:\Users\you\.codex\sessions`，没有复制或预处理 JSONL。
- 当前 `config.toml` 去掉 CodeDeck managed block 后，与同步前备份 `config.toml.bak.2026-08-17T16-31-42-683Z` 逐字符相等（均为 6953 字符）；managed begin/end 标记各一个。
- CodeDeck 未运行/存储锁定等无秘密失败路径由 Agent Bridge CLI/server 测试覆盖；未为重复验证而破坏当前已解锁运行状态。

## 7. Spec and Review Gate

- [x] 更新 session discovery 与 Agent Bridge contracts，使实现和 source of truth 一致。
- [x] 检查 git diff 仅包含当前任务必要文件，不处理无关工作树变化。
- [x] Trellis check 已完成：`npm test`（103 files / 1040 tests）、`npm run typecheck`、`npm run build:electron`、`git diff --check` 均通过。
- [ ] 未经用户明确确认不执行 `git commit` 或 `git push`。

## Rollback Points

- CLI resume override 可独立回滚，不影响会话数据。
- provider registry 同步失败必须保留原 `config.toml`；人工回滚只删除 CodeDeck managed block。
- broker/site auth 迁移应作为同一阶段落地，避免只写入 `auth.command` 而 helper 尚不可用。
