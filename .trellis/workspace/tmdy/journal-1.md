# Journal - tmdy (Part 1)

> AI development session journal
> Started: 2026-08-01

---



## Session 1: SQLite logs trigger and WAL repair

**Date**: 2026-08-05
**Task**: SQLite logs trigger and WAL repair
**Branch**: `main`

### Summary

Backed up Codex global and CodeDeck project logs_2.sqlite databases, installed codex_block_logs_insert triggers, checkpointed/truncated WAL, verified MAX(id) and WAL stability, added maintenance script/tests/spec, and passed typecheck plus 773 Vitest tests.

### Git Commits

| Hash | Message |
|------|---------|
| `d85969c` | (see git log) |

### Status

[OK] **Completed**


## Session 2: Hide Codex subagent sessions

**Date**: 2026-08-11
**Task**: Hide Codex subagent sessions
**Branch**: `main`

### Summary

Added a default-on Codex sub-agent session visibility filter across settings, session parsing, catalog pagination, request caches, and both session list entry points; verified 807 tests, typecheck, and Windows NSIS packaging.

### Git Commits

| Hash | Message |
|------|---------|
| `7bfc731` | (see git log) |

### Status

[OK] **Completed**
