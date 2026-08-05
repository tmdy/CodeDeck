import importlib.util
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("repair-codex-logs-wal.py")
SPEC = importlib.util.spec_from_file_location("repair_codex_logs_wal", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class RepairCodexLogsWalTests(unittest.TestCase):
    def test_trigger_is_idempotent_and_blocks_insert(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            database = root / "logs_2.sqlite"
            connection = sqlite3.connect(database)
            connection.executescript(
                "PRAGMA journal_mode=WAL;"
                "CREATE TABLE logs(id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, "
                "ts_nanos INTEGER NOT NULL, level TEXT NOT NULL, target TEXT NOT NULL, estimated_bytes INTEGER NOT NULL DEFAULT 0);"
                "INSERT INTO logs(ts, ts_nanos, level, target) VALUES(1, 0, 'INFO', 'test');"
            )
            connection.close()
            result = MODULE.repair(database, root / "backups", 0)
            self.assertTrue(result.stable)
            connection = sqlite3.connect(database)
            self.assertEqual(connection.execute("SELECT COUNT(*), MAX(id) FROM logs").fetchone(), (1, 1))
            MODULE.repair(database, root / "backups-2", 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name=?", (MODULE.TRIGGER_NAME,)).fetchone()[0], 1)
            connection.close()


if __name__ == "__main__":
    unittest.main()
