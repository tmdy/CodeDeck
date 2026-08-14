# Codex 执行目录单次自动信任

## Goal

用户在 CodeDeck 中选择执行目录并启动任意 Codex Profile 时，CodeDeck 自动把该目录作为本次 Codex 进程的可信项目，避免每次新会话都停在目录信任确认页，同时不写入 Profile、CodeDeck 运行时 `config.toml` 或用户全局 Codex 配置。

## Background

- 此前 CodeDeck 只为所有托管和原生 Codex 启动追加 `--disable hooks`，而该参数不会跳过首次目录信任页。
- Codex CLI 0.147.0 支持 `-c` / `--config` 单次覆盖；其 dotted-key 解析器要求使用完全无引号的 `projects.<path>.trust_level=trusted`，且 Windows 项目键必须使用与 Codex 当前目录一致的原生反斜杠表示。
- 桌面启动和 Agent Bridge 都复用 `LaunchService` 与 Codex 命令构建器，因此底层统一生成可避免不同入口行为漂移。
- Codex Profile 的 API 地址、模型、思考程度、sandbox 和 approval policy 与项目信任是相互独立的启动输入。

## Requirements

- 所有由 CodeDeck 发起且 Provider 为 Codex 的启动，都必须使用当前所选执行目录生成单次 `projects.<path>.trust_level=trusted` 覆盖，包括托管 Profile、原生 Profile、桌面启动和 Agent Bridge 启动。
- 新会话、继续最近会话、会话选择器和指定会话恢复必须采用相同规则。
- 信任覆盖必须由底层结构化 argv 生成，不允许把带 Windows 反斜杠的配置文本直接拼进用户 `extra_args`，也不允许为项目路径段或 `trusted` 值生成引号。
- 路径编码必须正确处理 Windows 盘符、正反斜杠输入、空格和非 ASCII 字符；生成的 Windows 项目键必须规范为原生反斜杠，并且只信任实际传给启动计划的执行目录。
- Bridge 调用方不能提交任意 Codex 配置覆盖；信任值由 CodeDeck 根据已校验的启动目录生成。
- 生成的信任覆盖必须晚于用户提供的普通 CLI 参数，从而防止同键的较早参数覆盖 CodeDeck 选定目录；`--disable hooks` 仍保持在最终参数之后。
- 命令预览必须反映实际执行的信任参数，实际 argv 与预览不得分叉。
- Claude Profile 不追加 Codex 项目信任参数，现有 Claude 行为保持不变。
- 不得修改已保存 Profile、`runtime_by_profile`、CodeDeck 运行时 `config.toml`、用户 `~/.codex/config.toml` 或官方桌面 Codex 的全局状态。
- Agent Bridge Skill 不识别或自动处理目录信任页；任何 `awaiting_input` 响应都必须将 `question` 原样报告给用户并等待明确指示。
- Agent Bridge Skill 安装在用户级 `~/.codex/skills/codedeck-agent-bridge`；项目内不得保留 `.codex/skills` 源目录或 `.agents/skills` 发现入口。CodeDeck Profile 仅在启用全局能力继承时把该 Skill 注入自身 `CODEX_HOME`。
- 原有模型/思考程度单次覆盖、Profile 权限、Agent Bridge 生命周期与 `--disable hooks` 语义必须保持不变。

## Out of Scope

- 为 Claude 增加等价的目录信任机制。
- 持久化任意项目的 trusted 状态。
- 新增用户可编辑的任意 `-c` / `--config` 端口字段。
- 修改 sandbox、approval policy、Profile 黑名单或 Agent Bridge 身份验证。
- 自动信任所选执行目录之外的父目录、Git 根目录或其他推测路径。

## Acceptance Criteria

- [x] 托管 Codex Profile 的启动 argv 恰好包含一组针对当前执行目录的无引号 `-c projects.<native-path>.trust_level=trusted`，并通过真实 Bridge/TUI 启动验证不会进入目录信任页。
- [x] 原生 Codex Profile 的启动 argv 包含相同覆盖；显式模型与思考程度覆盖仍正确生效且不写回 Profile。
- [x] Codex 的所有启动/恢复模式都包含该覆盖，Claude 的所有启动模式均不包含。
- [x] 包含正反斜杠输入、空格和中文的 Windows 路径能规范为原生反斜杠，作为单个且不含 `"` 的 argv 值传递，并实际命中 Codex 当前目录。
- [x] 用户参数之后由 CodeDeck 生成的信任覆盖具有最终优先级，且命令仍以 `--disable hooks` 收尾。
- [x] 命令预览与实际 `commandArgs` 描述同一个信任目录。
- [x] 启动前后保存的 Profile、runtime 设置及 Codex 配置文件内容不因该功能发生变化。
- [x] Agent Bridge Skill 和协议参考不包含自动信任页回复，并明确将所有 `awaiting_input` 问题交给用户。
- [x] Agent Bridge Skill 已迁移到用户级 `~/.codex/skills` 并通过校验，项目内副本和发现入口已移除。
- [x] 相关单元测试通过，并完成 `npm test`、`npm run typecheck` 和 `npm run build:electron` 验证。
