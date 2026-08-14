# Technical Design

## Architecture Boundary

该能力属于 Codex 启动计划，而不是 Agent Bridge 协议或 Profile 持久化。`LaunchService` 已经同时服务桌面启动和 Bridge 启动，应当成为信任目录的唯一决策点；`command-builder` 只负责把已决定的目录编码成稳定 argv。

数据流：

```text
selected runtime cwd
  -> LaunchService normalized runtime
  -> CodexCommandOptions.trustedProjectPath
  -> buildCodexArgs structured tokens
  -> monitored/direct launch + command preview
```

Claude 分支不接收 `trustedProjectPath`。

## Command Contract

Codex argv 应新增：

```text
-c
projects.D:\CodeDeck.trust_level=trusted
```

第二项是单个 argv 值。Codex 0.147.0 的 `-c` dotted-key 解析器不能把 quoted path segment 正确解析为项目键，而且项目键必须与 Codex 在 Windows 上识别的当前目录表示一致。因此帮助函数必须先把 Windows 盘符或 UNC 路径规范为反斜杠，再生成完全无引号的 `projects.${nativePath}.trust_level=trusted`。该值直接进入结构化 argv，不经过 PowerShell 字符串拼接或 `parseCliArgs()` 二次解析。

参数顺序：

1. resume 子命令和 session 标识；
2. Profile、模型、思考程度及用户参数；
3. CodeDeck 生成的 trusted project 覆盖；
4. `--disable hooks`。

最后写入的同键 CLI 覆盖必须代表 CodeDeck 当前执行目录。

## Launch Coverage

- `buildNativeArtifacts()` 为原生 Codex 传递可信目录。
- `buildCodexArtifacts()` 为托管 Codex Profile 传递可信目录。
- 两个分支都从 `normalizedRuntime.cwd` 获取同一个源值。
- `buildCodexCommand()` 与 `buildCodexArgs()` 使用同一 options，避免预览和执行参数分叉。
- 不扩展 Agent Bridge 公共请求协议；Bridge 仍只提交 `cwd`，不能提交任意 trust/config 内容。

## Compatibility And Safety

- `-c` 是单次进程覆盖，不写任何配置文件。
- trusted 项目会允许 Codex 加载项目级 `.codex`、rules 和 Skills；这是本功能的预期结果。
- `--disable hooks` 独立保留，项目可信不会重新启用 hooks。
- 现有运行时交互页面检测与显式 `continue` 输入能力保留，因此旧 Codex 或异常环境仍可以进入 `awaiting_input`。
- Skill 不解析信任页或提交兼容回复；它对所有 `awaiting_input` 统一将 `question` 原样报告给用户，只在获得明确指示后才能继续会话。
- Skill 的唯一安装位置是用户级 `~/.codex/skills/codedeck-agent-bridge`，仓库不保存副本或发现链接。CodeDeck 使用独立 `CODEX_HOME`；只有启用全局能力继承的 Profile 才会通过 capability overlay 获得该全局 Skill。

## Rollback

回滚只需停止向 Codex command options 传递 `trustedProjectPath`。不存在配置迁移或持久化数据清理。
