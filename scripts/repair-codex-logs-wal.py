#!/usr/bin/env python3
"""Back up Codex log databases, block new log inserts, and verify WAL stability."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sqlite3
import sys
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

TRIGGER_NAME = "codex_block_logs_insert"


@dataclass
class Result:
    database: str
    backup: str
    wal_bytes_before: int
    wal_bytes_after: int
    max_id_before: int | None
    max_id_after: int | None
    checkpoint: tuple[int, int, int]
    stable: bool


def discover(project_root: Path, codex_root: Path) -> list[Path]:
    candidates = [codex_root / "logs_2.sqlite"]
    candidates.extend((project_root / "app-data" / "codex-profiles").glob("**/logs_2.sqlite"))
    candidates.append(project_root / "app-data" / "codex-runtime" / "home" / "logs_2.sqlite")
    return sorted({p.resolve() for p in candidates if p.is_file()})


def backup_database(path: Path, backup_dir: Path) -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    identity = hashlib.sha256(str(path).encode("utf-8")).hexdigest()[:10]
    target_dir = backup_dir / f"{path.stem}-{identity}-{stamp}"
    target_dir.mkdir(parents=True, exist_ok=False)
    target = target_dir / path.name
    source = sqlite3.connect(str(path), timeout=10)
    destination = sqlite3.connect(str(target))
    try:
        source.backup(destination)
    finally:
        destination.close()
        source.close()
    for suffix in ("-wal", "-shm"):
        sidecar = Path(str(path) + suffix)
        if sidecar.exists():
            shutil.copy2(sidecar, target_dir / sidecar.name)
    return target


def wal_size(path: Path) -> int:
    sidecar = Path(str(path) + "-wal")
    return sidecar.stat().st_size if sidecar.exists() else 0


def max_id(connection: sqlite3.Connection) -> int | None:
    row = connection.execute("SELECT MAX(id) FROM logs").fetchone()
    return row[0] if row else None


def repair(path: Path, backup_dir: Path, sample_seconds: float) -> Result:
    backup = backup_database(path, backup_dir)
    connection = sqlite3.connect(str(path), timeout=10, isolation_level=None)
    try:
        connection.execute("PRAGMA busy_timeout=10000")
        if connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='logs'").fetchone() is None:
            raise RuntimeError("logs table is missing")
        before_id = max_id(connection)
        before_wal = wal_size(path)
        connection.execute(
            f"CREATE TRIGGER IF NOT EXISTS {TRIGGER_NAME} "
            "BEFORE INSERT ON logs BEGIN SELECT RAISE(IGNORE); END"
        )
        trigger = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='trigger' AND name=?", (TRIGGER_NAME,)
        ).fetchone()
        if trigger is None:
            raise RuntimeError("trigger was not created")
        connection.execute(
            "INSERT INTO logs(ts, ts_nanos, level, target, estimated_bytes) "
            "VALUES(strftime('%s','now'), 0, 'INFO', 'codex-repair-probe', 0)"
        )
        probe_id = max_id(connection)
        if probe_id != before_id:
            raise RuntimeError(f"trigger failed: MAX(id) changed from {before_id} to {probe_id}")
        checkpoint = tuple(connection.execute("PRAGMA wal_checkpoint(TRUNCATE)").fetchone())
        if len(checkpoint) != 3 or checkpoint[0] != 0:
            raise RuntimeError(f"checkpoint failed: {checkpoint}")
        after_checkpoint_wal = wal_size(path)
        if after_checkpoint_wal != 0:
            raise RuntimeError(f"WAL was not truncated: {after_checkpoint_wal} bytes")
        time.sleep(max(0.0, sample_seconds))
        after_id = max_id(connection)
        after_wal = wal_size(path)
        stable = after_id == before_id and after_wal <= after_checkpoint_wal
        if not stable:
            raise RuntimeError(
                f"unstable sample: MAX(id) {before_id}->{after_id}, WAL {after_checkpoint_wal}->{after_wal}"
            )
        return Result(str(path), str(backup), before_wal, after_wal, before_id, after_id, checkpoint, stable)
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument("--codex-root", type=Path, default=Path.home() / ".codex")
    parser.add_argument("--backup-dir", type=Path)
    parser.add_argument("--sample-seconds", type=float, default=2.0)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    backup_dir = args.backup_dir or (args.project_root / "app-data" / "backups" / "codex-logs-wal")
    databases = discover(args.project_root.resolve(), args.codex_root.expanduser().resolve())
    if not databases:
        print("No Codex logs_2.sqlite databases found", file=sys.stderr)
        return 1
    results: list[Result] = []
    errors: list[str] = []
    for database in databases:
        try:
            results.append(repair(database, backup_dir, args.sample_seconds))
        except Exception as error:  # noqa: BLE001 - CLI must report every database failure.
            errors.append(f"{database}: {error}")
    payload = {"results": [asdict(result) for result in results], "errors": errors}
    print(json.dumps(payload, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
