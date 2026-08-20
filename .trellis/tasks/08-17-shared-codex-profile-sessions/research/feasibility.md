# Codex Profile 共享会话与跨 Profile 恢复可行性

## 结论

可以实现，并且会话列表实际上已经共享。当前失败不是 TOML 文件格式或会话目录隔离问题，而是恢复请求缺少本次启动 Profile 的显式 `modelProvider` 覆盖。

最小实现不应复制、迁移或改写会话 JSONL，也不应把所有第三方密钥注入官方 Codex 进程。应在恢复会话时让“当前选中的 Profile”显式覆盖历史会话记录的 provider。

## 本机证据

- 会话 `01a0101d-9f27-7bd1-96d8-e62193e1b750` 位于全局 `C:\Users\you\.codex\sessions`，元数据记录 `model_provider = "site_provider_46af1e48d1a0fe41"`。
- 主 `C:\Users\you\.codex\config.toml` 当前只定义 `codex` 和 `openai_http`，没有上述 site provider。
- `site-46af1e48d1a0fe41.config.toml` 只定义自己的 site provider；其他 `site-*.config.toml` 也只定义各自 provider。
- Codex CLI `resume --help` 明确说明 `--profile <name>` 会把 `$CODEX_HOME/<name>.config.toml` 叠加到基础用户配置。
- 不带 provider override 调用 App Server `thread/resume`，稳定复现 `Model provider ... not found`。
- 对同一会话显式传 `modelProvider = "openai_http"` 后，`thread/resume` 成功；返回的当前 provider 为 `openai_http`，历史 thread 元数据仍保留原 site provider。
- 使用 ConPTY 启动 `codex resume <id> -c model_provider="openai_http"` 能进入 TUI，没有再出现 provider not found。验证过程中未发送用户消息或调用模型。

## 当前代码行为

- CodeDeck 的 Codex 会话列表只使用 canonical global Codex home：`electron/main.ts:1456-1469`。
- 指定会话恢复也只校验该全局 home：`electron/main.ts:1471-1489`。
- 第三方 Profile 启动会生成稳定的 `site-<hash>.config.toml`，并通过 `--profile` 显式加载：`src/shared/services/launch-service.ts:496-557`。
- site provider ID 和 API key 环境变量名按 Profile ID 稳定派生：`src/shared/services/model-mapping-config-service.ts:35-52`。
- 官方 Codex 原生启动只设置 `CODEX_HOME`，恢复命令没有 `--profile` 或 `model_provider` override：`src/shared/services/launch-service.ts:338-398`。
- CLI 命令构建器支持把额外参数放到 `resume` 命令后：`src/shared/provider/codex/command-builder.ts:25-64`。

## 原因

Codex 恢复会话时区分：

1. rollout 中持久化的历史 provider；
2. 本次 `thread/resume` 的显式 provider override。

没有显式 override 时，Codex 尝试解析历史 `site_provider_46af...`，主配置中不存在该 provider，因此 bootstrap 失败。

第三方 Profile 通过 `--profile site-...` 提供了本次启动的显式 `model_provider`，所以可以切换到当前第三方 provider 恢复其他 Profile 创建的会话。官方 Profile 只依赖基础 `config.toml` 默认值，该默认值没有被当作 resume override，因此失败。

## 推荐实现边界

1. 保持所有 Codex Profile 使用 canonical global Codex home，不新增会话复制或合并逻辑。
2. 对官方 Codex 的 resume 启动，解析当前有效官方 provider，并向命令追加显式 `-c model_provider=<provider>`。
3. 第三方 Profile 保持现有 `--profile site-...` 和单 key 环境注入，不改变认证隔离。
4. 不修改 rollout 中的 `model_provider`；恢复成功后由 Codex 自己记录本次 thread settings。
5. 仅在 resume 模式注入 provider override；新会话保持官方原生启动语义。

## Provider 解析建议

优先使用 Codex 自身的有效配置语义获取官方 provider，而不是假设固定为 `openai`：

- 当前用户配置可能显式使用 `openai_http` 或其他自定义 provider。
- `config.toml` 之外还可能存在项目配置层或 managed config。
- Codex App Server 的 `config/read` 能返回指定 cwd 下的 effective config，但为一次 CLI 启动引入常驻 App Server 不符合最小修改原则。

MVP 可以先读取 canonical home 的基础 `config.toml` 顶层 `model_provider`，缺省时使用 Codex 内置 `openai`。如果项目当前明确要求完整支持项目/managed 配置层，再使用 Codex `config/read`，不要自行实现完整 TOML/config layering。

## 不推荐方案

- 不把所有 `[model_providers.site_provider_*]` 合并进主 `config.toml`：会污染用户 source of truth，并引入同步、删除和冲突处理。
- 不向官方进程注入所有 `CODEX_SITE_API_KEY_*`：扩大凭据暴露范围，且解决问题并不需要。
- 不改写历史 JSONL 的 `model_provider`：破坏原始会话元数据，也会造成不可逆迁移问题。
- 不为每个 Profile 维护独立 sessions 目录再做复制：当前 canonical home 已经统一，复制只会制造重复和索引一致性问题。

## 预计最小文件范围

- `src/shared/services/launch-service.ts`
- `src/shared/launcher/types.ts`（如果通过内部 request 传递已解析 provider）
- `electron/main.ts`（启动前解析官方 provider）
- 对应 `launch-service` / main integration 的最小测试

如采用独立的小型配置读取 helper，再增加一个 `src/shared/services/` 文件及其单元测试；不需要改 UI、会话列表或 session service。

## 验证建议

1. 单元测试：官方 Codex `resume_selected` 命令包含显式 `model_provider` override。
2. 单元测试：官方新会话不增加该 override。
3. 单元测试：第三方 `--profile site-...` 与单 key 环境注入保持不变。
4. 本地只读 smoke：官方 Profile 恢复第三方会话能进入 TUI。
5. 反向 smoke：第三方 Profile 恢复官方会话及另一第三方会话仍成功。
6. 确认会话 JSONL 未被预处理或改写，主 `config.toml` 未被 CodeDeck 合并 site provider。

## 官方资料

- Codex configuration reference: https://developers.openai.com/codex/config-reference
- Codex App Server: https://developers.openai.com/codex/app-server

## Desktop `/app` 扩展研究

### 结论

`/app` 打开 Desktop 后继续第三方 Profile 会话也可以实现，但不能只靠 CLI 的 provider override。

本机 Codex Desktop 复用一个已经长期运行的 App Server。`codex app`/`/app` 把工作区交给既有 Desktop 实例时，当前 CodeDeck 终端的 `CODEX_SITE_API_KEY_*` 不会注入已经运行的进程。因此，仅把 provider 定义同步到主 `config.toml` 会把错误从“provider not found”推进到“provider credential missing”。

### 官方可用机制

Codex custom provider 支持：

```toml
[model_providers.<id>.auth]
command = "..."
args = ["..."]
```

Codex 在需要 bearer token 时执行该命令，并从 stdout 读取 token。官方文档明确要求该方式不能与 `env_key`、`experimental_bearer_token` 或 `requires_openai_auth` 同时使用。

### 推荐架构

1. CodeDeck 将所有已启用站点的非敏感 provider 定义同步到主 `config.toml`，但不写入明文 token。
2. provider 使用 `auth.command` 调用一个 CodeDeck 凭据代理，并传入稳定 provider/Profile 标识。
3. 凭据代理通过现有本地命名管道连接正在运行且已解锁的 CodeDeck，由 CodeDeck 从现有加密 Profile 存储读取对应 token。
4. stdout 只输出 token；stderr、日志和错误对象不得包含 token。
5. CodeDeck 未运行、未解锁、Profile 已删除或连接文件无效时，代理明确失败，不回退到明文文件或用户环境变量。
6. Desktop 继续使用会话原始 provider；CodeDeck 内跨 Profile 恢复仍可使用当前选中的 Profile override。

### 可复用能力

- CodeDeck 已有 `EncryptedConfigStore` 保存 Profile 密钥。
- 免口令模式使用 Electron `safeStorage` 保护自动解锁密钥。
- 已有 `AgentBridgeServer`、Windows named pipe、随机连接 token、连接文件和 `agent-cli`，可复用传输与进程发现模式。

### 安全边界

- 不使用 `experimental_bearer_token`，官方文档也不推荐该明文配置方式。
- 不把站点密钥写入 Windows 用户环境变量；该方式需要 Desktop 重启且扩大持久化明文范围。
- 不在通用 Agent Bridge 现有命令中直接暴露“列出全部 token”能力。
- token 请求必须限定单一 provider，并考虑独立命令/协议、最小日志、请求速率和 CodeDeck 解锁状态。

### 生命周期限制

MVP 下，第三方 provider 的 Desktop 对话要求 CodeDeck 正在运行且 Profile 存储已解锁。这符合 `/app` 从 CodeDeck 启动会话的主要路径，也避免新增常驻 Windows 服务或第二套凭据存储。

如果要求 CodeDeck 完全退出后 Desktop 仍能访问第三方 provider，则需要额外设计 Windows Credential Manager/DPAPI 凭据存储或常驻 broker，明显扩大安全和运维范围，不应作为最小实现默认包含。

### 任务拆分建议

- 子任务 A：CodeDeck CLI Profile 跨会话恢复，使用当前 Profile provider override。
- 子任务 B：Desktop `/app` provider registry 与命令式凭据代理。

两个子任务共享 provider ID 映射，但验收和风险独立；Desktop 子任务需要额外安全审查与真实 Desktop smoke test。
