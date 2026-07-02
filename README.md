# CodeDeck

AI CLI 工具统一管理桌面应用 — Skills 管理 + Profile 配置启动器 + 模型映射 + 参数设置

## 技术栈

- **前端**：React 19 + TypeScript + Vite
- **桌面**：Electron 38
- **测试**：Vitest + Testing Library

## 开发

```bash
# 安装依赖
npm install

# 启动开发环境
npm run dev

# 类型检查
npm run typecheck

# 构建
npm run build

# 运行测试
npm test
```

## 启动加载策略

- `npm run dev` 会在打开 Electron 前预热 `/src/main.tsx` 和 `/src/App.tsx`，降低首次窗口加载时的 Vite transform 等待。
- Vite dev server 忽略 `app-data/`、`dist/`、`dist-electron/`、`release/` 等运行时和构建目录，避免 Codex/Skills 运行数据变更触发整页 reload。
- Skills 面板保持按需加载；Profiles 页 chunk 会在解锁页渲染后空闲预热，不阻塞解锁首屏。

## Profiles 行为

- 工作目录支持全局收藏：在 Profile 运行时设置里点击星标可收藏/取消当前目录，使用“收藏”下拉可快速切换到常用目录。
- 站点后台会话选择“新建会话”但未填写 Access Token 和 User ID 时，离开 Profiles 页会自动回到“API Key 自动”，不会保存空后台会话。

## 会话恢复

- Codex 历史会话会同时读取应用运行时目录 `app-data/codex-runtime/home` 和用户全局 `.codex` 目录。
- 当 `session_index.jsonl` 落后于实际 `sessions/*.jsonl` 文件时，恢复列表会合并两边信息，避免新会话缺失。
- 从全局 `.codex` 恢复 Codex 会话时，会先导入到应用运行时目录再启动恢复。
- 会话页支持跨 Claude/Codex 收藏历史会话；点击列表或详情里的星标可收藏/取消收藏，“收藏”入口会按收藏时间展示全部收藏，并按原 provider 恢复。
- Profiles 里的恢复会话列表保持独立滚动；选中会话时列表高度提升到可展示约 5 条最近会话，“当前选中”详情直接向下展开，由主窗口滚动查看长图片路径和开头问答。
- Profiles 右侧启动区使用紧凑按钮布局：主启动按钮整行显示，其余启动模式两列排列，为恢复会话列表留出更多首屏空间。

## 打包

```bash
# Windows NSIS 安装包
npm run dist:win

# Windows 目录包（无需安装）
npm run dist:win:dir
```

## 许可

MIT License
