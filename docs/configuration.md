# 配置与本地数据

CodeDeck 没有统一的 `.env` 文件。大部分配置由界面写入本地状态，少数启动行为可以用环境变量覆盖。

## 工作区

开发模式默认使用当前仓库。打包模式默认使用 Electron `userData` 下的 `workspace`，首次运行时可以从安装包资源初始化内容。

打包应用选择工作区时，启动代码按下面的顺序查找：

1. `CodeDeck.project-root.txt` 中的第一条有效路径。
2. 可执行文件、resources 或当前目录附近已经存在的便携工作区。
3. `CODEDECK_PROJECT_ROOT` 环境变量。
4. 没有覆盖时使用打包应用的默认 workspace。

`CodeDeck.project-root.txt` 可以放在当前目录、可执行文件目录或 resources 目录。空行和以 `#` 开头的行会被忽略。

```text
C:\Projects\CodeDeckWorkspace
```

这只影响 CodeDeck 的 `app-data/` 与 `library/`，不等同于 Codex CLI 的 `CODEX_HOME`。

## 环境变量

| 名称 | 用途 |
| --- | --- |
| `CODEDECK_PROJECT_ROOT` | 在没有配置文件和便携工作区时指定 CodeDeck workspace |
| `CLAUDE_PROFILE_LAUNCHER_PASSPHRASE` | 主进程无法从界面取得口令时，用它解锁加密配置 |
| `CODEDECK_KDF_ITERATIONS` | 开发或测试时覆盖 PBKDF2 迭代次数；默认是 `480000` |
| `CLAUDE_CONFIG_DIR` | 覆盖 Claude 会话扫描使用的配置目录 |
| `VITE_DEV_SERVER_URL` | 开发脚本传给 Electron 的 Renderer 地址 |
| `CODEDECK_AI_RESEARCH_LIST` | `tag:ai-research` 辅助脚本的输入文件，仅用于维护标签 |

不要把口令、Token 或 Cookie 写进受版本控制的脚本。

## 主要数据

| 路径 | 内容 |
| --- | --- |
| `app-data/claude_profiles.encrypted.json` | 加密后的 Profile 和站点会话 |
| `app-data/local_state.json` | 界面设置、收藏和全局参数 |
| `app-data/manifest.json` | Skills 扫描缓存和最近操作信息 |
| `app-data/operations/` | Skills 批处理记录 |
| `app-data/backups/` | 需要回滚时使用的备份 |
| `app-data/codex-runtime/home/` | CodeDeck 管理的 Codex runtime home |
| `app-data/runtime-overlays/` | 从全局配置接入的 MCP、Skills 和插件能力 |
| `library/codex/`、`library/claude/` | 当前未启用的托管 Skills |

`.gitignore` 默认排除这些运行数据和构建产物，只保留仓库已有的公开翻译、标签文件。

## 外部请求

应用本身不要求配套后端。以下功能会访问外部地址：

- Claude Code 或 Codex 发起的模型请求；
- 从 Profile 站点读取模型列表；
- 余额与签到检查；
- npm 安装依赖。

请求目标取决于用户配置。调试问题时应同时检查本地配置和真实网络响应。
