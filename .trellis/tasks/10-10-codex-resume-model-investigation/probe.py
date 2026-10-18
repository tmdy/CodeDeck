import json
import os
from pathlib import Path
import queue
import subprocess
import threading
import time

CLIENTS = {
    "cli-0.160.1": Path.home() / "AppData/Roaming/npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
    "desktop-0.162.0-alpha.2": Path.home() / "AppData/Local/OpenAI/Codex/bin/9691020b546a15b2/codex.exe",
}

def probe(label, exe, provider):
    env = os.environ.copy()
    env["CODEX_HOME"] = str(Path.home() / ".codex")
    p = subprocess.Popen([str(exe), "-c", f'model_provider="{provider}"', "app-server", "--stdio"],
                         stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                         text=True, encoding="utf-8", env=env)
    q = queue.Queue()
    def reader():
        for line in p.stdout:
            try:
                q.put(json.loads(line))
            except json.JSONDecodeError:
                pass
    threading.Thread(target=reader, daemon=True).start()
    def send(v):
        p.stdin.write(json.dumps(v) + "\n")
        p.stdin.flush()
    def rpc(i, method, params):
        send({"id": i, "method": method, "params": params})
        end = time.monotonic() + 35
        while time.monotonic() < end:
            v = q.get(timeout=max(0.1, end-time.monotonic()))
            if v.get("id") == i:
                return v
        raise TimeoutError(method)
    try:
        rpc(1, "initialize", {"clientInfo": {"name": "codedeck_research", "version": "1.0"}})
        send({"method": "initialized", "params": {}})
        v = rpc(2, "model/list", {"limit": 100, "includeHidden": False})
        rows = [{"model": x.get("model"), "isDefault": x.get("isDefault")} for x in v.get("result", {}).get("data", [])]
        print(json.dumps({"client": label, "provider": provider, "models": rows, "error": v.get("error")}, ensure_ascii=True), flush=True)
    except Exception as e:
        print(json.dumps({"client": label, "provider": provider, "error": str(e)}, ensure_ascii=True), flush=True)
    finally:
        p.terminate()
        p.wait(timeout=10)

if __name__ == "__main__":
    for label, exe in CLIENTS.items():
        for provider in ("openai_http", "openai"):
            probe(label, exe, provider)
