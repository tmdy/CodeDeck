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

首次打开时，可保留“使用配置口令”并输入两次口令，也可关闭该选项进入免口令模式。两种模式都会在进入主界面前立即创建加密文件：口令模式在下次启动时要求解锁；免口令模式使用当前 Windows 账户保护的随机密钥自动解锁。配置口令无法找回，免口令密钥也不适合作为跨账户或系统重装后的恢复方式。

检测到旧明文 Profile 时，首次界面会显示迁移操作，可选择口令或免口令模式。只有新加密文件写入并验证成功后，旧文件才会被删除。两种模式可在全局设置中切换。安装包不预装开发机器上的 Skills，可在进入应用后自行导入。

## 创建第一个 Profile

1. 打开 Profiles 页面，选择 Claude Code 或 Codex。
2. 新建站点 Profile，填写 Base URL、凭据和模型；也可以直接选择 Profile 列顶部的官方 CLI Profile。
3. 选择工作目录与启动模式。
4. 检查命令预览和环境变量摘要。
5. 选择系统直连或受监控终端，再启动 CLI。

凭据错误、站点不可用或 CLI 不在 `PATH` 时，启动或后续请求会失败。CodeDeck 不会伪造可用状态。

官方 CLI Profile 直接调用 `claude` 或 `codex`，使用用户全局的 `~/.claude` 或 `~/.codex`。工作目录仍按 Profile 选择，会话恢复会按相同工作目录筛选全局项目会话。

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
