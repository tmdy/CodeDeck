# 开始菜单快捷方式交付

2026-10-10，用户授权更新指定 CodeDeck.lnk，使其打开本次新版。

- 快捷方式：`C:/Users/you/AppData/Roaming/Microsoft/Windows/Start Menu/Programs/CodeDeck.lnk`。
- 原目标：`D:/CodeDeck/release/win-unpacked/CodeDeck.exe`，无参数。
- 新目标：`D:/CodeDeck/release/monitored-session-state-20261010-173632/win-unpacked/CodeDeck.exe`，无参数，工作目录同步到该目录，图标使用新版 exe。
- 独立目录构建和包内源码一致性检查见 `package-delivery.md`。旧目录未覆盖或删除，快捷方式可恢复到上面的原目标。
- 重启前旧路径只有四个 CodeDeck Electron 进程，没有其他 CLI 子进程；停止范围严格限定该可执行路径，未终止其他项目进程。
- 从更新后的 .lnk 启动，进程检查确认四个 CodeDeck 进程均来自新路径，旧路径已退出。
- 新应用日志在 2026-10-10T09:38:38–39Z 记录 main_window_did_finish_load、root_mounted、bootstrap_ready 和 main_content_committed。原工作区及已有 Profile 正常载入。

本次证明新包实际启动且主界面加载成功；没有向用户模型会话提交输入，Windows 任务栏完成态的真实 CLI 回合验收仍不同于该启动验证。
