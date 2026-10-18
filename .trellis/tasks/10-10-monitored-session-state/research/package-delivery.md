# 2026-10-10 本地独立目录交付

用户授权更新开始菜单 CodeDeck 快捷方式，使其打开包含本任务修复的新版本。构建代理只生成独立目录，快捷方式和运行实例由主会话处理。

## 构建

以下命令均 exit 0：

1. `npx vite build`
2. `npm run build:electron`
3. `npm run prepare:package`
4. `npx electron-builder --win dir --x64 --publish never -c.directories.output=D:/CodeDeck/release/monitored-session-state-20261010-173632`

新执行文件：`D:/CodeDeck/release/monitored-session-state-20261010-173632/win-unpacked/CodeDeck.exe`。

版本仍为 package.json 的 0.2.1；Electron builder 实际采用锁定依赖的 39.8.10。未生成安装器、未发布、未提交，未覆盖旧 `release/win-unpacked`。构建更新了生成目录 dist、dist-electron、build 和 node-pty 打包所需 native rebuild，没有产品源码修改。

## 产物检查

- app.asar 内 main、terminal-session-manager、terminal-auto-continue、terminal-session-identity、terminal-turn-lifecycle、session-service、Codex command-builder 七个编译文件与本次 dist-electron 来源逐字节相同。
- Renderer `SettingsPage-OOAl8D7v.js` 含新标签“自动继续累计上限”。
- app.asar 共 809 个路径，无根 app-data、library、.codex、.claude，以及 auth.json、profiles.json、config.toml。
- 唯一 workspace seed 数据文件为 `resources/workspace-seed/app-data/translations.json`；node-pty 的 unpacked `build/Release/pty.node` 存在。
- `app.asar` SHA256：`1af7af9b03366c2b2e72be0bda8ddfedf55fbfaa82aa58bdad28d0961c4338b0`。
- `CodeDeck.exe` SHA256：`041b23596fd1baae36100f5a3525f88c289edc93d3c91d46fa185735541272e1`。

首次 asar 检查使用了 POSIX 路径，Windows asar API 因路径分隔符报未找到；修正为 Windows 分隔符后七模块一致性通过。首次标签检查使用了未采用的“自动继续上限”，核实源码实际文字为“自动继续累计上限”后通过；上述均检查脚本问题，不涉及产物改动。

## 工作区与限制

旧执行文件邻近未发现 `CodeDeck.project-root.txt`。新目录位于同仓库 release 子树，主会话已核实 main 的 nearest-workspace 查找仍会得到 `D:/CodeDeck`，不需要复制真实用户数据。

本报告仅证明构建及产物内容。快捷方式解析、启动新版进程、应用窗口及任务栏现场结果由主会话另行验证；构建代理没有结束用户进程或启动新实例。
