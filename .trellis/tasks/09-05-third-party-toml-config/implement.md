# 实施计划

## 执行清单

1. 在执行前再次读取目标配置的相关 section/key，并确认全局 `@openai/codex` 当前版本、npm prefix 与 latest；不输出敏感值。
2. 在用户明确确认高风险变更后，记录目标配置文件 SHA-256。
3. 先执行官方 npm 更新命令 `npm install -g @openai/codex`。
4. 验证 `npm list -g @openai/codex --depth=0` 与 `codex --version`，确认升级成功；若升级失败，停止，不执行后续 TOML 修改。
5. 升级成功后，记录目标配置文件 SHA-256，并用最小补丁在 `C:\Users\you\.codex\config.toml` 加入：

   ```toml
   [features.context_management]
   experimental_mode = true
   ```

6. 用 Python `tomllib` 只读解析配置，检查目标键为 `true`，并重新计算 SHA-256。
7. 向用户报告两项变更、验证结果和重启边界；不自动重启 Codex、CodeDeck 或 ChatGPT Desktop。

## 验证命令

- `python -c "import tomllib; tomllib.load(open(r'C:\Users\you\.codex\config.toml','rb'))"`
- `npm list -g @openai/codex --depth=0`
- `codex --version`

## 风险点与停止条件

- 风险文件：`C:\Users\you\.codex\config.toml`；风险操作：全局 npm 安装。
- 若 TOML 解析失败或 npm 升级失败，停止并报告，不修改 CodeDeck 源码，不自动重试破坏性操作。
- 两项验证均通过且重启说明已交付后停止，不追加无关升级或测试。
