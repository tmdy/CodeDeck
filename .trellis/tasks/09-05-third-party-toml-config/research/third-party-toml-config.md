# 第三方入口下 TOML 配置生效性调研

日期：2026-09-05

## 结论

在当前 CodeDeck 源码和当前仓库生成的打包版本中，如果“第三方打开”指 CodeDeck 的普通第三方 Codex Profile，截图中的配置只需要写入用户基础配置 `C:\Users\you\.codex\config.toml`；新启动的 Codex 子进程会继承它。第三方 Profile 的 `--profile site-<hash>` 只是在同一个 `CODEX_HOME` 上叠加站点配置，不会切换到另一个 Home。

但 TOML 不是热加载机制：已经运行的 Codex PTY、Codex Desktop/app-server 不会因为文件被修改而自动重读。至少要完全重启实际使用该配置的 Codex 进程；若走 CodeDeck → Codex Desktop `/app` 交接，应重启持有 Desktop app-server 的 Codex Desktop。CodeDeck 主进程本身不是该 TOML 的解析者，单纯为了这项 feature 不要求重启，但重开 CodeDeck 可以排除旧进程/旧版本的路径差异。

## 外部截图与本次请求的边界

截图中的帖子建议加入：

```toml
[features.context_management]
experimental_mode = true
```

并完全重启 Codex。这是第三方文档内容，不是本任务的执行授权；本调研没有写入该配置，也没有启动或重启应用。

## 证据

### 1. Codex CLI 的基础配置与 Profile 叠加语义

本机 `codex --version` 返回 `codex-cli 0.148.0`。

只读执行 `codex --help` / `codex debug --help` 得到：

- `-c, --config <key=value>` 会覆盖“otherwise loaded from `~/.codex/config.toml`”的配置。
- `--profile <name>` 会把 `$CODEX_HOME/<name>.config.toml` 叠加到基础用户配置。

因此，基础 feature 表应放在基础 `config.toml`；站点 Profile 仍会继承它，除非命令行或 Profile 层显式覆盖同一项。该检查只验证 CLI 的配置入口说明，没有声称已启用或实际运行 context management。

### 2. 当前 CodeDeck 普通/第三方 Profile 的 `CODEX_HOME`

- `src/shared/services/codex-home.ts:11-13` 将 canonical Home 解析为 `path.join(os.homedir(), ".codex")`。
- `electron/main.ts:2206-2214` 初始化 ModelMapping 与能力服务时使用该 canonical Home。
- `electron/main.ts:2339-2343` 将同一个 Home 交给 `LaunchService`。
- `src/shared/services/launch-service.ts:503-570` 为普通第三方 Profile 生成 `site-<hash>.config.toml`，并将 `CODEX_HOME` 设置为 canonical Home；命令使用 `--profile site-<hash>`。
- 当前契约 `.trellis/spec/frontend/session-discovery-contract.md:95-140` 明确规定 native/site Codex 共享用户 Home，旧 `app-data/codex-runtime/home` 仅作为迁移输入。

这条链路说明：当前 CodeDeck 第三方 Profile 不应读取独立的 `app-data/codex-runtime/home/config.toml`，而应读取用户 `.codex/config.toml` 作为基础层。

### 3. CodeDeck 不会因 provider 同步删除 feature 配置

`src/shared/services/model-mapping-config-service.ts:190-205` 在更新第三方 provider registry 时，先剥离 CodeDeck 自己的标记区块，再把该区块和其余 `externalContent` 合并写回。因此 `[features.context_management]` 只要位于 CodeDeck 标记区块之外，就不会被 provider registry 同步覆盖。

### 4. 外部 Agent Bridge 不是另一套 Codex Home

`scripts/codedeck-agent.cmd:1-10` 只是启动 `agent-cli.js`；`electron/agent-cli.ts:231-289` 通过本地 Agent Bridge 将 `run` 请求交给运行中的 CodeDeck。`electron/main.ts:2406-2475` 随后按普通 `LaunchService` 计划创建真实 Codex 子进程。因此从 `codedeck-agent` 进入时，配置作用域仍由 CodeDeck 传给子进程的 `CODEX_HOME` 决定。

### 5. Desktop `/app` 交接的额外进程边界

CodeDeck 当前创建新 Desktop thread 的路径在 `electron/main.ts:1818-1837`，启动 app-server 时把 `plan.env`（其中包含 `CODEX_HOME`）传给子进程；随后在 `electron/main.ts:1926-1935` 以选定 Profile 的 model/provider 创建 thread 并结束临时 app-server。现有研究还记录了 `/app` 交给已经长期运行的 Desktop app-server 时，配置/凭据读取由 Desktop 进程自己的生命周期决定（`.trellis/tasks/08-17-shared-codex-profile-sessions/research/feasibility.md:87-133`）。

所以：新 app-server 可以在新启动时读取修改后的基础 TOML；已经运行的 Desktop 仍需重启，不能把“文件已修改”当成“现有 Desktop 已应用”。第三方 provider 的 token/broker 是否可用是另一条链路，不由 context management TOML 开关解决。

### 6. 当前本机与打包证据

- `C:\Users\you\.codex\config.toml` 存在，当前未找到 `[features.context_management]` 或 `experimental_mode`。
- `D:\CodeDeck\app-data\codex-runtime\home\config.toml` 也存在，但当前源码/契约把它视为旧 Runtime 数据，不是普通启动路径。
- 当前没有运行中的 CodeDeck 进程；可见的 `codex.exe` 是 `C:\Users\you\AppData\Local\OpenAI\Codex\...\codex.exe`，父进程为 ChatGPT Desktop。因此本次没有做第三方 CodeDeck 进程的真实启用 smoke test。
- 对 `release/win-unpacked/resources/app.asar`（2026-08-20）和 `release/win-unpacked-new/win-unpacked/resources/app.asar`（2026-09-02）做了只读 ASAR 检查；两者的 Electron main bundle 都包含 canonical Home 解析与 Desktop handoff，未包含旧 `app-data/codex-runtime/home` 启动字符串。
- `README.md`、`docs/configuration.md`、`docs/troubleshooting.md` 最近一次提交为 2026-08-15，而共享 Home 迁移提交 `db450d3` 为 2026-08-16；这些文档中的隔离 Runtime 描述早于当前源码/契约，应视为过时证据。

## 条件化回答

| 实际入口 | 只改用户基础 TOML 是否够 | 还需要什么 |
|---|---|---|
| 当前 CodeDeck 第三方 Profile，新开 Codex 子进程 | 是 | 修改 `C:\Users\you\.codex\config.toml` 后新开子进程 |
| `codedeck-agent run` | 是，作用域相同 | CodeDeck 保持运行并解锁；新开委托子进程 |
| CodeDeck → Codex Desktop `/app`，Desktop 已在运行 | 对新启动链路是；对当前 Desktop 不是 | 完全重启持有 app-server 的 Codex Desktop |
| 仍在使用旧版/自定义 `CODEX_HOME` 的第三方封装 | 否，不能直接下结论 | 先确认该进程的 `CODEX_HOME`，修改对应 Home 的 `config.toml` 或改用当前 CodeDeck 版本 |

## 未验证项

- 没有在本次调研中真正写入 feature、重启 Codex 或发送模型请求，因此没有宣称 context management 已在当前账号/第三方 provider 上可用。
- 用户实际使用的已安装第三方入口路径和版本未被本机进程证实；上表按当前 CodeDeck 源码及仓库内两个打包目录给出条件化结论。

## 官方文档核对（2026-09-05）

- OpenAI 官方 [Codex configuration reference](https://developers.openai.com/codex/config-reference/) 列出 `features.context_management.experimental_mode`，说明该开关默认关闭；同页说明用户级配置位于 `~/.codex/config.toml`，Profile 文件位于同一 `$CODEX_HOME` 下。
- OpenAI 官方 [Codex CLI](https://developers.openai.com/codex/cli/) 页面提供 npm 安装/更新方式；其 npm 更新命令为 `npm install -g @openai/codex`。
- 本机只读核对结果：全局 npm 包为 `@openai/codex@0.148.0`，registry latest 为 `0.153.4`，命令入口为 `C:\Users\you\AppData\Roaming\npm\codex.ps1`。

以上资料支持本次实施范围，但不改变“已有进程不会热加载”和“配置写入不等于 provider/账号功能已 smoke test”的结论。

## 新会话现场核对（2026-09-05）

- 当前运行中的 Codex CLI 进程创建时间为 `13:43:38`；目标配置最后写入时间为 `13:31:08`，时间上确认它是在配置写入之后新启动的。
- 该进程由 `CodeDeck.exe -> cmd.exe -> node` 启动，命令使用全局 `@openai/codex/bin/codex.js` 和 `--profile site-*`；这与当前第三方 Profile 启动链路一致。
- 因此可以确认“新开的 CLI 进程使用了升级后的 CLI，并在正确的第三方 Profile 链路中运行”。截图本身没有显示有效配置表或 context management 状态标识，故不能仅凭画面证明该 feature 已完成实际功能 smoke test。
