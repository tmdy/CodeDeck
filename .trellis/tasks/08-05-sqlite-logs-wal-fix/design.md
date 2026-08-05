# Technical Design

## Boundaries

新增 `scripts/repair-codex-logs-wal.py`，只操作显式发现的 Codex `logs_2.sqlite` 文件，不修改 Electron 运行时源码。脚本仅依赖 Python 标准库 `sqlite3`、`pathlib` 和 `shutil`。

## Flow

1. 解析全局 Codex 根目录和项目根目录，去重发现目标数据库。
2. 对数据库、WAL、SHM 做 timestamped sibling backup；数据库备份使用 SQLite 在线 backup API，旁车文件按字节复制。
3. 以 timeout 打开数据库，启用 WAL，创建固定名称 trigger `codex_block_logs_insert`。
4. 在同一连接执行 `PRAGMA wal_checkpoint(TRUNCATE)`，检查 busy/error 状态。
5. 读取 `MAX(id)`、WAL size；等待采样间隔后再次读取，要求 max id 相等且 WAL 不增长。
6. 任一目标失败则汇总错误并退出码 1。

## Compatibility / Rollback

trigger 使用 `CREATE TRIGGER IF NOT EXISTS`，重复执行不会增加对象。回滚是删除 trigger；数据恢复使用 timestamped `.sqlite` 备份。脚本绝不直接 unlink 活跃 WAL。

## Trigger Contract

```sql
CREATE TRIGGER IF NOT EXISTS codex_block_logs_insert
BEFORE INSERT ON logs
BEGIN
  SELECT RAISE(IGNORE);
END;
```
