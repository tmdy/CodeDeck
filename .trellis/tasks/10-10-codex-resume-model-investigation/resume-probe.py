import importlib.util
import json
import os
from pathlib import Path
import queue
import subprocess
import tempfile
import threading
import time
import uuid
import contextlib
import shutil

spec = importlib.util.spec_from_file_location("probe", Path(__file__).with_name("probe.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

@contextlib.contextmanager
def temporary_home():
    tmp = tempfile.mkdtemp(prefix="codedeck-resume-research-")
    try:
        yield tmp
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

def run(exe, label, overrides):
    with temporary_home() as tmp:
        home = Path(tmp)
        sid = str(uuid.uuid4())
        session = home / "sessions/2026/10/10" / f"rollout-2026-10-10T00-00-00-{sid}.jsonl"
        session.parent.mkdir(parents=True)
        rows = [
            {"timestamp": "2026-10-10T00:00:00.000Z", "type": "session_meta", "payload": {"id": sid, "timestamp": "2026-10-10T00:00:00.000Z", "cwd": str(home), "originator": "codex_cli_rs", "cli_version": "0.160.1", "source": "cli", "model_provider": "site_provider_research_missing"}},
            {"timestamp": "2026-10-10T00:00:01.000Z", "type": "response_item", "payload": {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Synthetic fixture only. No real user history."}]}},
            {"timestamp": "2026-10-10T00:00:02.000Z", "type": "turn_context", "payload": {"cwd": str(home), "approval_policy": "never", "sandbox_policy": {"type": "read-only"}, "model": "gpt-5.6-sol", "effort": "medium", "summary": "auto"}},
        ]
        session.write_text("".join(json.dumps(x)+"\n" for x in rows), encoding="utf-8")
        (home / "config.toml").write_text('model = "gpt-6.1-sol"\nmodel_provider = "openai_http"\n[model_providers.openai_http]\nname = "OpenAI HTTP only"\nbase_url = "https://api.openai.com/v1"\nwire_api = "responses"\nrequires_openai_auth = true\n', encoding="utf-8")
        before = session.read_bytes()
        env = os.environ.copy()
        env["CODEX_HOME"] = str(home)
        p = subprocess.Popen([str(exe), "app-server", "--stdio"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, encoding="utf-8", env=env, cwd=tmp)
        q = queue.Queue()
        def reader():
            for line in p.stdout:
                try: q.put(json.loads(line))
                except json.JSONDecodeError: pass
        threading.Thread(target=reader, daemon=True).start()
        def rpc(i, method, params):
            p.stdin.write(json.dumps({"id": i, "method": method, "params": params})+"\n")
            p.stdin.flush()
            end = time.monotonic()+20
            while time.monotonic()<end:
                v=q.get(timeout=max(0.1,end-time.monotonic()))
                if v.get("id")==i: return v
        try:
            rpc(1,"initialize",{"clientInfo":{"name":"codedeck_research","version":"1.0"}})
            p.stdin.write('{"method":"initialized","params":{}}\n'); p.stdin.flush()
            v=rpc(2,"thread/resume",{"threadId":sid,**overrides})
            r=v.get("result",{})
            print(json.dumps({"client":label,"overrides":overrides,"error":v.get("error"),"model":r.get("model"),"modelProvider":r.get("modelProvider"),"sameId":r.get("thread",{}).get("id")==sid,"fixtureUnchanged":before==session.read_bytes()}),flush=True)
        except Exception as e:
            print(json.dumps({"client":label,"overrides":overrides,"error":str(e)}),flush=True)
        finally:
            subprocess.run(["taskkill", "/PID", str(p.pid), "/T", "/F"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            p.wait(timeout=10)

for label,exe in module.CLIENTS.items():
    for overrides in ({},{"modelProvider":"openai_http"},{"modelProvider":"openai_http","model":"gpt-6.1-sol"}):
        run(exe,label,overrides)
