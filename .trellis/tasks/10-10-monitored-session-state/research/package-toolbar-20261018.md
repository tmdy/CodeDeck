# 2026-10-18 紧凑工具栏与自动继续计划交付

构建来源为当前完整工作树；没有回退、筛选旧包或修改产品源码。

## 构建

以下命令全部 exit 0：

1. `npx vite build`
2. `npm run build:electron`
3. `npm run prepare:package`
4. `npx electron-builder --win dir --x64 --publish never -c.electronDist=D:/CodeDeck/node_modules/electron/dist -c.directories.output=D:/CodeDeck/release/terminal-toolbar-schedule-20261018-195124`

新执行文件：`D:/CodeDeck/release/terminal-toolbar-schedule-20261018-195124/win-unpacked/CodeDeck.exe`。产品版本仍为 0.2.1，Electron 为 39.8.10。使用当前安装的 Electron 分发，无重复下载等待。未生成安装器、提交、推送或发布。

## 包内容校验

- app.asar 全部 107 个编译 JavaScript 模块，以及所有 Renderer JS / CSS / HTML，与本次 dist-electron / dist 来源逐字节相同。
- manager 含 autoContinueSchedule 投影、cloneSnapshot 深拷贝、sameStatus 的 delayMs / queuedAtMs / dueAtMs / phase / error 比较、send_failed 和无 pending input 时的 early guard。
- Renderer `TerminalApp-CsnOck-s.js` 含实际 schedule / countdown 文案、“本次等待”“还剩”、waiting_for_renderer、send_failed 和 terminal-schedule。
- `index-DBjMM_Q4.css` 含 terminal-schedule、terminal-controls、terminal-header-main 当前紧凑样式；布局行为以本任务现有 Renderer 实测证据为准，包内容校验没有重复冒充运行中的打包窗口验证。
- 保留 terminal-output-buffer、codex-resume-repair-writer、codex-provider-resume-repair，以及 `tui.terminal_title=['thread-id']` literal 修复。
- 共 812 个 archive 路径，无根 app-data、library、.codex、.claude，以及 auth.json、profiles.json、config.toml。唯一 workspace seed 数据为 translations.json。unpacked node-pty native pty.node 存在。

SHA256：

- app.asar：`3591530ede87e564f66cb3d158c9ae7d2e9ce4f9fad88883256d32c8955cb7e3`
- CodeDeck.exe：`93afc1260d9dac2eebecf26981ca276c815ae304d27fddf39d67f0f5f713caf1`

## 保持与限制

独立输出目录没有覆盖运行目录；未停止或启动 CodeDeck / 用户 CLI，未操作真实数据或开始菜单快捷方式。主会话负责更新此前授权的快捷方式。因现有 single-instance 行为，更新快捷方式不表示当前旧实例已经切换至新包；实际新版窗口启动和任务栏现场验证须在安全切换后另行判断。
