# 修复 SQLite logs 写入与 WAL 增长

## Goal

阻止 Codex 日志库继续向 `logs` 表写入，清理现有 WAL，并用可重复脚本验证数据库稳定。修复覆盖 Codex 全局数据和本项目内的 Codex 数据。

## Confirmed Facts

- 全局数据库：`C:\Users\you\.codex\logs_2.sqlite`。
- 项目数据库：`app-data/codex-profiles/**/logs_2.sqlite` 与 `app-data/codex-runtime/home/logs_2.sqlite`。
- 所有目标库均有 `logs` 表，主键为自增 `id`，当前为 `journal_mode=wal`。
- 本项目没有 SQLite 业务封装，修复应以仓库内可审计维护脚本执行。

## Requirements

1. 对每个目标数据库及其 `-wal`/`-shm` 文件在任何写操作前创建带时间戳备份。
2. 安装持久化 SQLite `BEFORE INSERT` trigger，使用 `RAISE(IGNORE)` 拦截新行，保留历史数据和 `MAX(id)`。
3. 执行 `PRAGMA wal_checkpoint(TRUNCATE)`，不静默忽略 busy/错误结果。
4. 输出备份路径、trigger 状态、checkpoint 结果、`MAX(id)`、WAL 字节数。
5. checkpoint 后采样两次 `MAX(id)` 和 WAL 大小；两次采样期间不得出现新日志行，WAL 不得增长。
6. 脚本支持幂等重复执行，数据库不可访问时以非零状态退出。

## Acceptance Criteria

- [ ] 所有目标库在修改前都有可恢复备份，原库仍可被 SQLite 打开。
- [ ] `sqlite_master` 存在预期 trigger，尝试插入 `logs` 后行数与 `MAX(id)` 不变。
- [ ] checkpoint 成功，WAL 不存在或大小为 0。
- [ ] 两次采样的 `MAX(id)` 相等，WAL 大小不增加；任一数据库失败都会使脚本失败。
- [ ] 自动化测试覆盖 trigger 幂等、拦截写入、checkpoint/采样失败路径。

## Out of Scope

- 删除或压缩已有 `logs` 数据。
- 修改 Codex 二进制、Electron UI 或日志查询语义。
- 清理非 SQLite 文本日志。

## Risks / Deferred Items

- 若 Codex 进程仍持有写事务，checkpoint 可能返回 `busy`；脚本应报告并失败，而不是强行删除 WAL。
- trigger 会永久丢弃后续日志写入；恢复需手动删除 trigger 并从备份回滚。
