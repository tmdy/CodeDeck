# 技术设计

## 边界与数据流

本次只改两处用户级状态：

1. `C:\Users\you\.codex\config.toml`：作为 Codex 基础配置，加入 `features.context_management.experimental_mode = true`。
2. 全局 npm prefix 下的 `@openai/codex`：使用官方 npm 更新方式升级 CLI。

当前 CodeDeck 第三方 Profile 的数据流是：

```text
第三方入口 / CodeDeck Profile
  -> CODEX_HOME=C:\Users\you\.codex
  -> 基础 config.toml
  -> site-<hash>.config.toml Profile overlay
  -> 新启动的 Codex 子进程
```

因此 feature 放在基础配置层即可被普通第三方 Profile 继承；Profile 层或命令行若显式覆盖同一键，仍以更高优先级为准。

本次实际执行顺序固定为：先升级并验证全局 CLI，再修改并解析基础 TOML；升级失败时不执行 TOML 修改。

## 修改策略

- 修改前只读取相关 section/key，记录文件 SHA-256，不输出配置值或凭据。
- 以最小补丁插入一组独立 TOML table，避免触碰现有 provider、plugin 和 project 配置。
- 通过只读 TOML 解析确认语法和目标值。
- 执行 `npm install -g @openai/codex`，再用全局包列表与 `codex --version` 交叉确认 CLI 入口已更新。

## 兼容与回滚

- 现有 Codex 进程不会热加载 TOML；本次不自动重启，用户完全重启后才验证新配置读取。
- 若配置修改需要回滚，只删除本次新增的 context-management table；升级回滚可显式安装修改前已确认的 `0.148.0`。
- 不把 npm CLI 升级当作 ChatGPT Desktop 升级；Desktop 版本和 app-server 生命周期独立。

## 风险

- 全局安装可能受 npm 权限、网络或 registry 状态影响；升级前已确认当前 prefix、当前版本和 latest。
- context management 的配置存在不等于当前 provider/账号一定支持该功能；本次不发送模型请求验证。
