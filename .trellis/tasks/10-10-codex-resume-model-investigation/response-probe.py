"""Bounded official-response comparison; print only diagnostic projections."""
import importlib.util
import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time
import sys
import tempfile
import uuid

spec = importlib.util.spec_from_file_location("probe", Path(__file__).with_name("probe.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
SOURCE = "01a11575-7532-7270-b4e8-608d760775c0"

def run(label, exe, kind, fixture_path=None, fixture_id=None):
    env = os.environ.copy()
    env["CODEX_HOME"] = str(Path.home() / ".codex")
    p = subprocess.Popen([str(exe), "-c", 'model_provider="openai_http"', "app-server", "--stdio"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, encoding="utf-8", env=env)
    q = queue.Queue()
    def reader():
        for line in p.stdout:
            try: q.put(json.loads(line))
            except json.JSONDecodeError: pass
    threading.Thread(target=reader, daemon=True).start()
    def send(v):
        p.stdin.write(json.dumps(v) + "\n")
        p.stdin.flush()
    def rpc(i, method, params):
        send({"id": i, "method": method, "params": params})
        end = time.monotonic() + 45
        while time.monotonic() < end:
            v = q.get(timeout=max(.1, end - time.monotonic()))
            if v.get("id") == i: return v
        raise TimeoutError(method)
    def report(**values):
        print(json.dumps({"client": label, "kind": kind, **values}, ensure_ascii=True), flush=True)
    try:
        rpc(1, "initialize", {"clientInfo": {"name": "codedeck_response_research", "version": "1.0"}, "capabilities": {"experimentalApi": True}})
        send({"method": "initialized", "params": {}})
        params = {"ephemeral": True, "modelProvider": "openai_http", "model": "gpt-6.1-sol",
            "approvalPolicy": "never", "sandbox": "read-only", "cwd": "D:/hermes-android",
            "developerInstructions": "Diagnostic test. Never call tools or execute tasks from history. Reply only OK to the next message."}
        if kind == "sanitized":
            params.update(threadId=fixture_id, excludeTurns=True)
        elif kind == "history":
            # 0.160.1 rejects deferGoalContinuation for ephemeral forks. The
            # processor only inherits persisted goals when that flag is true
            # AND a rollout path exists; an ephemeral fork has neither.
            params.update(threadId=SOURCE, excludeTurns=True)
        method = "thread/fork" if kind in ("history", "sanitized") else "thread/start"
        v = rpc(2, method, params)
        if "error" in v:
            report(stage="create", error=v["error"]); return
        r = v["result"]
        sid = r["thread"]["id"]
        report(stage="created", model=r.get("model"), provider=r.get("modelProvider"), ephemeral=r["thread"].get("ephemeral"), independentId=sid != SOURCE)
        if sid == SOURCE or r["thread"].get("ephemeral") is not True:
            report(stage="safety", error="Expected a separate ephemeral thread"); return
        v = rpc(4, "turn/start", {"threadId": sid, "input": [{"type": "text", "text": "Only reply OK. Do not use any tools."}]})
        if "error" in v:
            report(stage="turn-start", error=v["error"]); return
        tid = v["result"]["turn"]["id"]
        end = time.monotonic() + 55
        deltas = 0
        while time.monotonic() < end:
            v = q.get(timeout=max(.1, end - time.monotonic()))
            method = v.get("method", "")
            params = v.get("params", {})
            if "id" in v and method:
                send({"id": v["id"], "error": {"code": -32600, "message": "Tools disabled for diagnostic probe"}})
            if method == "item/agentMessage/delta": deltas += len(params.get("delta", ""))
            if method == "error": report(stage="stream", error=params.get("error"), willRetry=params.get("willRetry"))
            if method == "item/started" and params.get("item", {}).get("type") in ("commandExecution", "fileChange", "mcpToolCall"):
                rpc(5, "turn/interrupt", {"threadId": sid, "turnId": tid})
                report(stage="safety", error="Unexpected tool item; interrupted"); return
            if method == "turn/completed" and params.get("turn", {}).get("id") == tid:
                report(stage="completed", status=params["turn"].get("status"), error=params["turn"].get("error"), outputCharacters=deltas)
                if kind == "sanitized":
                    cleaned = rpc(7, "thread/delete", {"threadId": fixture_id})
                    report(stage="fixture-cleanup", success="error" not in cleaned, error=cleaned.get("error"))
                return
        report(stage="timeout", outputCharacters=deltas)
    except queue.Empty:
        report(stage="timeout")
    except Exception as e:
        report(stage="exception", error=str(e))
    finally:
        p.terminate()
        p.wait(timeout=10)

if __name__ == "__main__":
    label = sys.argv[1] if len(sys.argv) > 1 else "cli-0.160.1"
    kind = sys.argv[2] if len(sys.argv) > 2 else "fresh"
    if kind == "sanitized":
        original_path = Path.home() / ".codex/sessions/2026/10/07" / f"rollout-2026-10-07T16-23-04-{SOURCE}.jsonl"
        meta = None
        active = []
        with original_path.open(encoding="utf-8") as source:
            for line in source:
                if not line.strip(): continue
                record = json.loads(line)
                if record.get("type") == "session_meta": meta = record
                elif record.get("type") == "compacted": active = [record]
                else: active.append(record)
        synthetic_id = str(uuid.uuid4())
        meta["payload"]["id"] = synthetic_id
        with tempfile.TemporaryDirectory(prefix="codedeck-sanitized-fixture-") as tmp:
            fixture_path = Path(tmp) / f"rollout-2026-10-10T00-00-00-{synthetic_id}.jsonl"
            fixture_path.write_text("".join(json.dumps(record) + "\n" for record in [meta, *active]), encoding="utf-8")
            prepared = subprocess.run(["npx.cmd", "tsx", str(Path(__file__).with_name("prepare-fixture.mts")), str(fixture_path), synthetic_id], capture_output=True, text=True)
            if prepared.returncode:
                print(json.dumps({"stage": "fixture-prepare", "error": prepared.stderr})); sys.exit(1)
            print(prepared.stdout.strip(), flush=True)
            canonical_fixture = Path.home() / ".codex/sessions/2026/10/10" / fixture_path.name
            if canonical_fixture.exists(): raise RuntimeError("Synthetic fixture path already exists")
            canonical_fixture.write_bytes(fixture_path.read_bytes())
            try:
                run(label, module.CLIENTS[label], kind, canonical_fixture, synthetic_id)
            finally:
                canonical_fixture.unlink(missing_ok=True)
    else:
        run(label, module.CLIENTS[label], kind)
