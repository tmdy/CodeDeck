# 2026-10-11 复发修复独立包交付

构建来源为当前完整工作树，包括本轮 title literal、Ask Codex 占位符和最终 separator 边界修复，以及已经使用的性能 / resume repair 实现；未回退到旧包或只提取部分修复。

## 命令与结果

- `npx vite build`：exit 0。
- `npm run build:electron`：exit 0。
- `npm run prepare:package`：exit 0。
- 原始 electron-builder 在 packaging 阶段等待 Electron 分发获取，尚未生成输出目录。核实本次 builder PID / CommandLine 后只停止该 builder node 进程；没有停止用户 CodeDeck 或 CLI。
- `npx electron-builder --win dir --x64 --publish never --config.directories.output=D:/CodeDeck/release/monitored-session-state-20261011-095220 --config.electronDist=D:/CodeDeck/node_modules/electron/dist`：exit 0。已安装 Electron 版本为 39.8.10，builder 也报告 39.8.10；复用本地分发避免下载等待，无依赖 / 产品配置修改。

新执行文件：`D:/CodeDeck/release/monitored-session-state-20261011-095220/win-unpacked/CodeDeck.exe`。package.json 产品版本仍为 0.2.1。

## 产物校验

以下 12 个 app.asar 编译模块与当前 dist-electron 来源逐字节相同：main、terminal-activity、terminal-session-manager、terminal-auto-continue、terminal-session-identity、terminal-turn-lifecycle、terminal-output-buffer、session-list-cache、codex-resume-repair-writer、codex-provider-resume-repair、session-service、Codex command-builder。

包内确认 `tui.terminal_title=['thread-id']` literal，以及 `ask codex to do anything`、completion separator 完整匹配、separator 后必须为新 prompt 边界和 `hasOpenCodeFence` 引用示例保护。

app.asar 共 812 个路径，无根 app-data、library、.codex、.claude，以及 auth.json、profiles.json、config.toml；唯一 workspace seed 为 translations.json。node-pty unpacked native pty.node 存在。

- app.asar SHA256：`98a890c8ce096043946962ba87d067b5533ee35bcd7218e1c8a829eb7175fb87`。
- CodeDeck.exe SHA256：`89b2aec03179ac2e7abda0ef4da1c6bedc928d0137b2809c2b27d9de7a3d749e`。

## 边界与限制

只新增本交付证据和生成内容，未修改产品源码、旧执行文件、真实数据、快捷方式或用户运行会话；未提交、推送、发布或生成安装器。

构建期间旧 `release/codex-resume-repair-20261010/win-unpacked/CodeDeck.exe` 的四个进程仍运行。快捷方式由主会话更新；不为验证新包关闭旧实例或用户 CLI。因 single-instance 存在，当前正在运行旧实例不等同于已启动新包，实际 UI / 任务栏验证留待安全切换后进行。
