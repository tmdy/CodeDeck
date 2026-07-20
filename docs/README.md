# CodeDeck 文档

README 负责介绍项目和最短上手路径。配置细节、开发约定和排障记录放在这里，避免首页随着实现变化越写越长。

## 使用

- [入门指南](getting-started.md)：安装依赖、启动应用和完成第一个 Profile。
- [配置与本地数据](configuration.md)：环境变量、工作区和敏感数据位置。
- [常见问题](troubleshooting.md)：开发服务器、原生模块、CLI 和会话问题。

## 实现

- [功能证据](features.md)：README 中主要功能对应的代码和测试。
- [开发与打包](development.md)：工程入口、命令、目录职责和发布前检查。
- [权限模型](specs/permissions.md)：Claude Code 与 Codex 的权限映射。
- [V1 设计背景](specs/2026-05-02-codedeck-v1.md)：早期产品模型。它是历史设计，不是当前功能清单。

文档中的命令必须能在仓库脚本或配置中找到依据。行为改动后，优先更新对应主题，不再复制一份相似说明。
