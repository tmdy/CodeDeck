# 入门指南

CodeDeck 当前以 Windows 10/11 x64 为开发和打包目标。普通使用可以从 [GitHub Releases](https://github.com/tmdy/CodeDeck/releases) 下载安装包；下面说明如何从源码运行。

## 准备环境

需要 Node.js 22.12 或更高版本，以及 npm。只有在启动真实会话时才需要 Claude Code CLI 或 Codex CLI。

先检查本机命令：

```powershell
node --version
npm --version
Get-Command claude -ErrorAction SilentlyContinue
Get-Command codex -ErrorAction SilentlyContinue
```

至少安装一个 AI CLI 即可使用对应的 Profile。CodeDeck 不会代替它完成登录或购买 API 服务。

## 安装与启动

```powershell
git clone https://github.com/tmdy/CodeDeck.git
cd CodeDeck
npm ci
npm run dev
```

`npm run dev` 同时运行 Vite、Electron TypeScript watch 和 Electron。Vite 固定使用 `5173` 端口，并在端口占用时退出。

首次打开时，应用会要求设置本地加密口令。这个口令用于解锁 Profile 文件，项目无法替你找回。

## 创建第一个 Profile

1. 打开 Profiles 页面，选择 Claude Code 或 Codex。
2. 新建 Profile，填写名称、Base URL、凭据和模型。
3. 选择工作目录与启动模式。
4. 检查命令预览和环境变量摘要。
5. 选择系统直连或受监控终端，再启动 CLI。

凭据错误、站点不可用或 CLI 不在 `PATH` 时，启动或后续请求会失败。CodeDeck 不会伪造可用状态。

## 本地验证

```powershell
npm run typecheck
npm test
npm run build
```

如果 Electron 报告 `node-pty` ABI 不匹配：

```powershell
npm run rebuild:native
```

仍无法启动时，查看[常见问题](troubleshooting.md)。
