# 常见问题

## `npm run dev` 提示 5173 端口被占用

开发脚本使用 `--strictPort`，不会自动换端口。找到占用进程并确认用途，再关闭它或稍后重试。

```powershell
Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
```

## Electron 无法加载 `node-pty`

依赖可能是为另一套 Node/Electron ABI 构建的。先运行：

```powershell
npm run rebuild:native
```

如果问题仍在，删除依赖再安装属于破坏性操作，应先确认工作区没有依赖本地补丁。

## 浏览器预览提示必须通过 Electron 运行

这是预期行为。`npm run preview` 只提供 Renderer 静态文件，主界面需要 preload 注入的 Skills、Profile 和 Terminal API。使用 `npm run dev` 启动完整应用。

## 找不到 `claude` 或 `codex`

CodeDeck 启动真实 CLI 前会检查命令。先在 PowerShell 中确认：

```powershell
Get-Command claude -ErrorAction SilentlyContinue
Get-Command codex -ErrorAction SilentlyContinue
```

命令不存在时，请按对应项目的官方方式安装，并重新打开终端让 `PATH` 生效。

## 忘记加密口令

当前加密存储没有口令恢复机制。保留加密文件只能帮助找回文件本身，不能绕过口令解密。

免口令模式使用 Windows 系统保护的随机密钥，不代表配置以明文保存。同一 Windows 账户可自动解锁；换用其他账户、迁移到另一台电脑或重装系统后，原免口令密钥可能无法解密。需要跨环境迁移时，应先在全局设置中启用自己保存的配置口令。

首次创建口令时必须输入两次，应用会在进入主界面前写出加密文件。若写入失败，应用会停留在创建界面并保留旧文件；不要通过删除旧文件绕过错误。若加密文件已经验证成功、但操作系统拒绝删除迁移后的旧文件，应用会继续使用新加密文件并在主界面显示旧文件路径；退出应用后应手动删除该旧文件，避免敏感数据残留。

## Codex 为什么没有直接使用全局 `.codex`

CodeDeck 为所有 Codex Profile（包括官方 Codex）设置隔离的 `CODEX_HOME`，避免修改全局配置。全局 MCP、Skills 和启用插件可以通过 runtime overlay 接入；App Runtime 会话直接恢复，全局会话只在用户从 CodeDeck 选择恢复时导入。若 App Runtime 尚未保存官方登录态，Codex 会使用自己的交互式登录流程；CodeDeck 不复制全局 `auth.json`。

## 余额或签到失败

这类请求访问 Profile 配置的外部站点。检查 Base URL、凭据、Cookie、用户 ID 和真实 HTTP 响应。UI 能显示 Profile 不代表站点接口可用。
