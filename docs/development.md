# 开发与打包

## 工程入口

CodeDeck 是 Electron、React、TypeScript 和 Vite 项目，使用 npm 与 `package-lock.json`。

启动链路：

1. `electron/main.ts` 编译为 `dist-electron/electron/main.js`。
2. Electron 主进程加载 `electron/preload.ts` 暴露的受控 API。
3. `index.html` 加载 `src/main.tsx`。
4. 默认窗口渲染 `App.tsx`，终端窗口渲染 `TerminalApp.tsx`。

生产窗口加载 `dist/index.html`；开发窗口读取 `VITE_DEV_SERVER_URL`。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `npm ci` | 按锁文件安装依赖 |
| `npm run dev` | 启动完整 Electron 开发环境 |
| `npm run dev:renderer` | 只启动端口 `5173` 上的 Vite Renderer |
| `npm run typecheck` | 检查 Renderer 和 Electron TypeScript |
| `npm test` | 运行一次 Vitest |
| `npm run test:watch` | 监听测试 |
| `npm run build` | 类型检查、构建 Renderer、编译 Electron |
| `npm run rebuild:native` | 为 Electron 重建 `node-pty` |
| `npm run dist:win` | 生成 Windows x64 NSIS 安装包 |
| `npm run dist:win:dir` | 生成解压目录 |
| `npm run dist:win:zip` | 生成 ZIP 包 |

`npm run preview` 不会提供 Electron preload API，只适合检查 Renderer 构建能否被 Vite 加载。

## 目录职责

- `src/components/`：Renderer 组件。
- `src/shared/`：领域模型、服务和可测试逻辑。
- `electron/`：主进程、preload、IPC 和窗口管理。
- `docs/`：面向使用者和贡献者的说明。
- `scripts/`：打包准备和维护脚本。

`dist/`、`dist-electron/`、`release/`、`app-data/` 和 `library/` 是构建或本机数据，不是源码入口。

## 打包

`electron-builder` 配置位于 `package.json`。当前目标只有 Windows x64，且所有打包脚本都带有 `--publish never`。

`prepare:package` 会重建 `build/workspace-seed`，并从 `src/assets/hero.png` 生成安装器图标。运行该命令前不要在 `build/workspace-seed` 放手工维护的文件。

## 提交前检查

```powershell
npm run typecheck
npm test
npm run build
git status --short
```

修改权限、IPC、启动参数或状态结构时，应补充对应测试。提交时按路径选择文件，不要把本机 Profile、日志和打包产物一并加入。
