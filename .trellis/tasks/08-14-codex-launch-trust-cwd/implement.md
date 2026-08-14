# Implementation Plan

1. 在 Codex command builder 中增加可信项目路径的结构化参数，将 Windows 路径规范为原生反斜杠后生成无引号 `projects.<cwd>.trust_level=trusted` argv 值。
2. 在 `LaunchService` 的原生和托管 Codex 分支统一传入 `normalizedRuntime.cwd`，确保所有启动与恢复模式覆盖。
3. 保证生成信任覆盖位于用户参数之后、`--disable hooks` 之前，并让命令预览复用同一 argv 构建结果。
4. 扩展 command-builder 与 launch-service 测试，覆盖托管/原生、桌面/Bridge 共用计划、恢复模式、Claude 排除、参数优先级，并断言正斜杠 Windows 输入会规范为原生反斜杠，含空格/中文的路径保持为不含 `"` 的单 argv token。
5. 更新用户级 `~/.codex/skills/codedeck-agent-bridge` 及协议参考，删除信任页自动处理，将所有 `awaiting_input` 问题原样交给用户，并移除项目内 Skill 副本与发现入口。
6. 更新 Agent Bridge contract 中关于 trust、Skill 和测试要求的陈旧描述。
7. 运行 `npm test`、`npm run typecheck`、`npm run build:electron`，检查命令预览与实际 argv 一致，并通过正常打包版 Bridge 启动真实 Codex TUI，确认不会进入目录信任页。

## Risk And Rollback Points

- 修改参数顺序前后分别检查现有 `--disable hooks` 与模型/思考程度测试，防止覆盖优先级回归。
- 路径必须作为单个且不含 `"` 的 argv 值生成；若需要再次进入字符串解析器，应停止并调整设计，而不是增加脆弱的转义层。
- 不修改 Profile/config 写入代码；一旦测试发现持久化内容变化，应回滚该路径并把逻辑收敛回启动参数。
