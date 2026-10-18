# 2026-10-18 Focus 不取消自动继续：独立包交付

来源为当前完整工作树，没有产品源码修改、旧包回退或部分修复挑选。

## 构建结果

以下命令均 exit 0：

1. `npm run build:electron`（完成后立即告知主会话，可使用当前编译模块执行独立 realclock FakePTY 验证）
2. `npx vite build`
3. `npm run prepare:package`
4. `npx electron-builder --win dir --x64 --publish never -c.electronDist=D:/CodeDeck/node_modules/electron/dist -c.directories.output=D:/CodeDeck/release/terminal-focus-retry-20261018-200548`

新执行文件：`D:/CodeDeck/release/terminal-focus-retry-20261018-200548/win-unpacked/CodeDeck.exe`。产品版本 0.2.1，Electron 39.8.10；复用已安装 Electron 分发，没有重复下载。

## 包内容与来源核验

- app.asar 中全部 107 个编译 JavaScript 模块、18 个 Renderer JS / CSS / HTML 资源与本次 dist-electron / dist 逐字节相同。Renderer 已完整重建，当前内容 hash 与此前 toolbar 交付一致。
- `terminal-input.js` 含 TerminalInputClassifier、协议响应白名单、cursorRequests 时效过滤、resetQueries 和 bracketedPaste 语义。
- `terminal-session-manager.js` 含 classified.cancelAutoContinue / classified.userInput 分离、raw 输入转发、resetQueries 回合边界清理，以及 autoContinueSchedule / send_failed。
- 原 terminal-output-buffer、terminal-turn-lifecycle、terminal-session-identity、codex-resume-repair-writer、codex-provider-resume-repair 及 `tui.terminal_title=['thread-id']` literal 均保留。
- archive 共 812 个路径，无根 app-data、library、.codex、.claude，以及 auth.json、profiles.json、config.toml；唯一 workspace seed 数据为 translations.json。unpacked node-pty native pty.node 存在。

SHA256：

- app.asar：`b98e4e54fe5dc4ac338cdde25a0d21c7200b639a40ed6dff9ebcccd0898a3cb9`
- CodeDeck.exe：`a785c562ee7bc9302e57e8bfcd34608e107c4cc2dea6f2b1e2113f4e7662923e`

## 保持与限制

未覆盖 `terminal-toolbar-schedule-20261018-195124` 或其他运行目录，未停止 / 启动 CodeDeck 或用户 CLI，未操作快捷方式、真实数据，未提交 / 推送 / 发布，未生成安装器。

主会话负责真实时钟模块验证和开始菜单快捷方式更新。产物检查证明新包包含当前实现，不代表当前运行旧实例已经切换，也不冒充新包实际窗口验证。
