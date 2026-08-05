# Implementation Plan

1. 添加维护脚本和命令行参数（项目根、Codex 根、采样间隔）。
2. 实现发现、备份、trigger 安装、checkpoint、采样和严格错误处理。
3. 添加 Python unittest，覆盖临时 WAL 数据库的备份、幂等 trigger、插入拦截和稳定采样。
4. 先对真实全局/项目数据库执行脚本，记录每个库的备份与验证结果。
5. 运行 `python -m unittest`、`npm run typecheck`、`npm test`，并审查 git diff。

## Rollback Points

- 执行前：timestamped backup。
- trigger 安装后：可执行 `DROP TRIGGER codex_block_logs_insert` 恢复写入。
- checkpoint 失败：保留 WAL，不删除文件，依据报告处理锁。
