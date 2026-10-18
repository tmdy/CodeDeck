# CodeDeck 开发约定

CodeDeck 是个人使用的 Windows 桌面应用，基于 Electron、React、TypeScript 和 Vite，管理 Claude Code / Codex 的 Profile、权限、Skills、会话和受监控终端。当前开发环境以 Windows 11 + PowerShell 为准，打包目标为 Windows x64；Node.js 版本要求以 `package.json` 的 `engines` 为准。

本文件补充项目事实和修改入口；通用工程取舍、授权、备份与沟通沿用个人开发工作约定。Trellis 流程以 `.trellis/workflow.md` 和当前任务状态为准，具体业务契约按需读取，不在此复制整套流程。

## 开始工作

- 先检查 `git status --short` 和目标文件差异，保护已有未提交工作；只修改当前需求及必需关联内容。
- 从下面的入口定位调用链，功能与测试索引见 `docs/features.md`。命令以 `package.json`、测试发现规则以 `vite.config.ts`、运行行为以当前代码为准；文档不一致时先核实实现。
- `.trellis/spec/frontend/index.md` 同时索引界面与 Electron / 服务层业务契约。只读相关文档；标为 `To fill` 的通用模板不能当作已经建立的项目约定。

## 目录与职责

| 入口 | 职责与修改位置 |
| --- | --- |
| `src/main.tsx`、`src/App.tsx`、`src/TerminalApp.tsx` | Renderer 入口、主窗口与终端窗口；页面及可复用界面放在 `src/components/`，样式在 `src/styles.css` |
| `electron/main.ts`、`electron/preload.ts`、`src/env.d.ts` | 应用生命周期、IPC 注册、受控桥接 API 与 Renderer 类型声明 |
| `src/shared/services/` | Profile、启动计划、会话、模型、余额、签到和配置等服务 |
| `src/shared/provider/`、`src/shared/profile/` | Provider 差异、CLI 参数构建、Profile 结构与权限模型 |
| `src/shared/electron/` | Electron 相关运行逻辑，包括 PTY、浏览器账号会话、会话目录与缓存 |
| `src/shared/agent-bridge/`、`electron/agent-cli.ts` | 本地 AI 委托协议、任务管理、服务端与 CLI 入口 |
| `src/shared/crypto/`、`src/shared/state/`、`src/shared/app-workspace.ts` | 加密配置、本地状态与工作区路径解析 |
| `src/shared/__tests__/`、`scripts/`、`docs/` | 按领域组织的测试、维护 / 打包脚本与使用文档 |

`src/shared/` 也包含依赖 Node / Electron 的代码，不表示所有模块都能在 Renderer 中运行。界面通过 preload API 调用本地能力，避免把文件系统、凭据处理和进程控制放进组件。

## 修改时保持的边界

- **IPC**：增改接口时同步主进程处理器、preload、`src/env.d.ts`、领域类型和实际调用方；Skills 通道沿用 `src/shared/code-deck-ipc.ts`。事件订阅保留解除监听路径，维持窗口的 `contextIsolation: true`、`nodeIntegration: false`。
- **启动与运行时**：命令预览和执行沿用 `src/shared/services/launch-service.ts` 的启动计划及 Provider 构建器。分别核实官方原生 Profile、站点 Profile 和健康检测的配置 / `CODEX_HOME` 来源；从 `electron/main.ts` 的服务初始化与 `src/shared/services/codex-home.ts` 查起，避免根据旧文档假定所有启动共享同一种隔离方式。
- **权限与凭据**：Claude 与 Codex 的权限模型分别处理。余额 / 签到的后台账号凭据和模型 API Key 按已有契约区分；浏览器身份及缓存作用域沿用账号分区规则，避免同站点多账号串用会话。
- **状态与界面**：异步结果须对应当前 Profile、Provider 或请求；沿用已有请求去重、缓存失效和终端生命周期实现。涉及 Skills 批量操作时，保留现有预览、执行和回滚语义。
- **代码风格**：TypeScript、React 函数组件、两空格缩进、双引号、分号；组件用 PascalCase，服务 / 工具用 kebab-case。保留已有 ESM 导入扩展名约定，尤其是 Electron / shared 代码中的 `.js`，与 `tsconfig.node.json` 的 NodeNext 编译保持一致。

涉及以下行为时，先读对应契约（路径相对 `.trellis/spec/frontend/`），再修改实现：

| 行为 | 契约文件 |
| --- | --- |
| 管理后台鉴权、签到及验证码恢复 | `management-auth-contract.md`、`checkin-provider-contract.md` |
| 自定义余额 / 签到适配、凭据转发 | `custom-compatibility-contract.md` |
| 会话发现、分页与缓存 | `session-discovery-contract.md` |
| 委托任务、父子会话回传与中断 | `agent-bridge-contract.md` |
| Profile 健康检测 | `profile-health-contract.md` |
| Codex SQLite 日志维护 | `codex-log-maintenance.md` |

## 命令与验证

使用 npm 和 `package-lock.json`；依赖已可用时不必重新安装。

| 命令 | 实际作用 |
| --- | --- |
| `npm ci` | 按锁文件重建依赖安装 |
| `npm run dev` | 同时启动 Vite、Electron TypeScript 监听和 Electron 应用 |
| `npm run dev:renderer` | 仅启动 Vite，固定端口 `5173`，占用时直接失败 |
| `npm run typecheck` | 检查 Renderer 与 Electron 两套 TypeScript 配置 |
| `npm test -- <测试文件路径>` / `npm test` | 运行指定 Vitest 测试 / 全部 Vitest 测试；监听模式用 `npm run test:watch` |
| `npm run build:electron` | 编译主进程、preload 和相关 shared 模块到 `dist-electron/` |
| `npm run build` | 类型检查、构建 Renderer、编译 Electron，**并调用 electron-builder 生成 Windows 安装包** |
| `npm run dist:win` | 执行 `build`、准备打包资源，再生成 Windows x64 NSIS 安装包到 `release/`；目录 / ZIP 格式用 `dist:win:dir` / `dist:win:zip` |
| `npm run rebuild:native` | `node-pty` 出现 Electron ABI 不匹配时重建原生模块 |

- Vitest 默认是 Node 环境，只发现 `src/shared/**/*.test.ts` 和 `src/shared/**/*.test.tsx`。测试放在目标模块旁或 `src/shared/__tests__/` 对应领域；需要 DOM 的组件测试沿用 `// @vitest-environment jsdom`。
- 局部逻辑修改优先运行相关测试；类型、IPC 或服务 API 变更加跑 `npm run typecheck`。跨模块影响或窄验证不足时扩大到 `npm test`；新增测试针对具体回归，不默认跑完整打包流程。
- 纯文档修改检查路径、命令事实和 `git diff --check`，无需运行应用测试或构建。打包验证仅在交付需求或相关变更需要时执行；`--publish never` 表示生成本地产物。
- `dev:renderer` 和 `npm run preview` 都不提供完整 Electron preload 环境，不能据此宣称 IPC、PTY 或完整启动链路通过验证。需要实机验证时使用完整应用，并说明实际验证范围。

## 本地数据与交付

- 默认开发工作区位于仓库，打包版默认使用 Electron `userData/workspace`；也支持 `CodeDeck.project-root.txt` 和 `CODEDECK_PROJECT_ROOT`。实际路径及优先级沿用 `src/shared/app-workspace.ts` 与主进程解析，不硬编码开发机器路径。新增环境变量同步 `README.md`。
- `app-data/`、`library/` 和运行时目录可能包含真实 Profile、凭据、浏览器会话和历史，不能作为可随意清理的构建产物。测试使用临时目录与测试凭据，日志、截图和报告中隐藏密钥、Token 与 Cookie。
- `app-data/` 有已跟踪的资源例外：`translations.json`、`tags.json`、`generated-translations/*.json`。是否属于源码以 `.gitignore` 和 `git ls-files` 核实；不要因目录名统一删除、忽略或整目录打包。当前安装包仅逐文件带入 `app-data/translations.json`，不附带本机 `library/`。
- `dist/`、`dist-electron/`、`release/`、`node_modules/` 为生成内容；修改其来源。打包资源配置见 `package.json`，生成准备见 `scripts/prepare-package.mjs`。
- 仅在用户要求时提交、推送或发布；提交明确列出本次已验证文件。提交信息使用简短动作描述，可用 `feat:`、`fix:`、`docs:`；PR 说明用户可见变化、验证结果，界面变更附可用的截图或录屏。

<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->
