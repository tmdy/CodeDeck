# Codex Log Database Maintenance

## 1. Scope / Trigger

This contract applies to maintenance of Codex `logs_2.sqlite` databases in the global Codex home and under this project's `app-data`.

## 2. Signatures

- Command: `python scripts/repair-codex-logs-wal.py [--project-root PATH] [--codex-root PATH] [--backup-dir PATH] [--sample-seconds N]`
- Database object: trigger `codex_block_logs_insert` on table `logs`.

## 3. Contracts

- The command first creates a timestamped SQLite backup and copies existing `-wal`/`-shm` sidecars.
- The trigger is `BEFORE INSERT` and executes `SELECT RAISE(IGNORE)`.
- Success output includes backup path, checkpoint tuple, `MAX(id)` before/after, and WAL bytes.

## 4. Validation & Error Matrix

- Missing `logs` table -> non-zero exit.
- Missing trigger after creation -> non-zero exit.
- `wal_checkpoint(TRUNCATE)` busy/error -> non-zero exit; never unlink WAL manually.
- Changed `MAX(id)` or growing WAL during sampling -> non-zero exit.

## 5. Good / Base / Bad Cases

- Good: backup exists, checkpoint returns `[0, 0, 0]`, WAL is zero, and both samples match.
- Base: database has no WAL sidecar; backup and verification still succeed.
- Bad: an active writer keeps the checkpoint busy; preserve files and report failure.

## 6. Tests Required

The maintenance test must assert trigger idempotence, ignored inserts, unchanged `MAX(id)`, and zero WAL after checkpoint on a temporary WAL database.

## 7. Wrong vs Correct

Wrong: delete `logs_2.sqlite-wal` directly to reduce disk usage.

Correct: back up first, run `PRAGMA wal_checkpoint(TRUNCATE)`, then sample `MAX(id)` and WAL size twice.
