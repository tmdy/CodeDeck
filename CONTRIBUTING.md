# 参与贡献

CodeDeck 目前集中维护 Windows 上的 Claude Code 与 Codex 工作流。提交代码前先确认问题属于这个范围；支持新平台或新 CLI 往往会同时影响配置格式、命令生成、会话目录和打包流程。

## 开始之前

1. 搜索现有 Issue，避免重复工作。
2. 较大的功能先开 Issue，说明使用场景和边界。
3. 不要在 Issue、提交或截图中包含凭据、Cookie、个人路径和私人会话。

## 本地开发

```powershell
git clone https://github.com/tmdy/CodeDeck.git
cd CodeDeck
npm ci
npm run dev
```

需要 Node.js 22.12 或更高版本。真实启动 Claude Code 或 Codex 时，还要安装对应 CLI。

## 代码约定

- 使用 TypeScript 和 React 函数组件。
- 保持现有的两空格缩进、双引号和分号。
- 组件文件使用 PascalCase，服务和工具文件使用 kebab-case。
- 可测试的领域逻辑放在 `src/shared/`；窗口、IPC 和 Electron 生命周期留在 `electron/`。
- 修改现有中文注释时继续使用中文，不把同一模块改成中英文混杂。

实现应尽量直接。先解决当前问题，避免为尚未出现的 Provider、平台或协议预留一套抽象层。

## 测试

提交前运行：

```powershell
npm run typecheck
npm test
npm run build
```

修改权限、命令参数、运行时配置、状态迁移或 IPC 时，应增加对应测试。UI 变化还需要手动检查，并附脱敏截图。

## Pull Request

PR 说明至少包括：

- 用户能看到的变化；
- 执行过的验证命令；
- 已知限制或未处理范围；
- UI 修改的截图或短录屏。

请只提交本次修改涉及的文件。`app-data/`、`library/`、构建产物和本机日志不属于 PR。
