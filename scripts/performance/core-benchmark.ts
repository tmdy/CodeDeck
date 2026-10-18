import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { PtyProcess, PtyProcessExitEvent } from "../../src/shared/electron/terminal-session-manager.js";

// No GC flags, real credentials, model calls, or user session writes. Each trial is a fresh Node process.
const args = process.argv.slice(2);
const option = (name: string, fallback: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? fallback : fallback;
};
const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.resolve(option("--output", "release/performance-audit/core.json"));
const compiledBuild = option("--compiled-build", "");
if (compiledBuild && !/^[a-z0-9_-]+$/i.test(compiledBuild)) throw new Error("Invalid compiled build label");
const chunks = Number(option("--chunks", args.includes("--settled") ? "2000" : "8000"));
if (!Number.isInteger(chunks) || chunks < 1 || chunks > 8000) throw new Error("--chunks must be 1..8000");
const moduleRoot = compiledBuild ? path.join(root, "release/performance-audit", compiledBuild, "dist-electron") : root;
const moduleUrl = (file: string) => pathToFileURL(path.join(moduleRoot, file)).href;
const { TerminalSessionManager } = await import(moduleUrl("src/shared/electron/terminal-session-manager.js")) as typeof import("../../src/shared/electron/terminal-session-manager.js");
const { createSessionListCache } = await import(moduleUrl("src/shared/electron/session-list-cache.js")) as typeof import("../../src/shared/electron/session-list-cache.js");
const { listCodexSessions, readCodexSessionTitle } = await import(moduleUrl("src/shared/services/session-service.js")) as typeof import("../../src/shared/services/session-service.js");
const sources = [
  "src/shared/electron/terminal-session-manager.ts", "src/shared/electron/terminal-output-buffer.ts",
  "src/shared/electron/session-list-cache.ts", "src/shared/services/session-service.ts", "src/TerminalApp.tsx",
];
let activePtyListeners = 0;
class TestPty implements PtyProcess {
  pid = 0;
  data = new Set<(data: string) => void>();
  exit = new Set<(event: PtyProcessExitEvent) => void>();
  write() {}
  resize() {}
  kill() {}
  onData(listener: (data: string) => void) {
    this.data.add(listener); activePtyListeners += 1;
    return () => { if (this.data.delete(listener)) activePtyListeners -= 1; };
  }
  onExit(listener: (event: PtyProcessExitEvent) => void) {
    this.exit.add(listener); activePtyListeners += 1;
    return () => { if (this.exit.delete(listener)) activePtyListeners -= 1; };
  }
  emit(data: string) { for (const listener of this.data) listener(data); }
  finish() { for (const listener of this.exit) listener({ exitCode: 0 }); }
}
function createManager() {
  let pty = new TestPty();
  const manager = new TerminalSessionManager({ createPtyProcess: () => (pty = new TestPty()) });
  return { manager, getPty: () => pty };
}
const sessionOptions = {
  provider: "codex", cwd: root, commandExecutable: "synthetic", commandArgs: [], env: {},
  autoContinue: { enabled: false, limit: 1, prompt: "continue", keywords: [] },
};
async function measured<T>(operation: () => Promise<T>) {
  const memoryBefore = process.memoryUsage();
  const cpuBefore = process.cpuUsage();
  const start = performance.now();
  const result = await operation();
  const elapsedMs = performance.now() - start;
  const cpu = process.cpuUsage(cpuBefore);
  return { elapsedMs, cpuMs: (cpu.user + cpu.system) / 1000, memoryBefore, memoryAfter: process.memoryUsage(), result };
}

async function trial() {
  const stream = await measured(async () => {
    const { manager, getPty } = createManager();
    const session = await manager.createSession(sessionOptions);
    const settled = args.includes("--settled");
    if (settled) manager.reportTurnLifecycle(session.sessionId, "completed");
    let statusEvents = 0; let statusChars = 0; let outputChars = 0;
    const streamedHash = createHash("sha256");
    const expectedHash = createHash("sha256");
    const detach = manager.attachSession(session.sessionId, {
      onOutput(chunk) { outputChars += chunk.length; streamedHash.update(chunk); },
      onStatus(snapshot) { statusEvents += 1; statusChars += JSON.stringify(snapshot).length; },
    });
    for (let index = 0; index < chunks; index += 1) {
      const chunk = `\x1b[32m${index.toString().padStart(6, "0")} 中文🙂 ${"x".repeat(480)}\x1b[0m\r\n`;
      expectedHash.update(chunk);
      getPty().emit(chunk);
    }
    const bufferedChars = manager.getSnapshot(session.sessionId)!.output.length;
    const identicalOutput = streamedHash.digest("hex") === expectedHash.digest("hex");
    detach();
    await manager.closeSession(session.sessionId);
    return { settled, chunks, outputChars, statusEvents, statusChars, bufferedChars, identicalOutput };
  });
  const churn = await measured(async () => {
    const { manager, getPty } = createManager();
    const ids: string[] = [];
    // Keep returned disposers, as AgentTaskManager keeps completed task records.
    const disposers: Array<() => void> = [];
    for (let index = 0; index < 200; index += 1) {
      const session = await manager.createSession(sessionOptions);
      ids.push(session.sessionId);
      getPty().emit(`${index}:中文${"中".repeat(65_536)}`);
      disposers.push(manager.attachSession(session.sessionId, { onOutput() {}, onStatus() {} }));
      await manager.closeSession(session.sessionId);
      disposers.at(-1)!();
    }
    const retained = ids.map((id) => manager.getSnapshot(id));
    return {
      createdAndClosed: ids.length, retainedSessions: retained.filter(Boolean).length,
      retainedOutputChars: retained.reduce((total, snapshot) => total + (snapshot?.output.length ?? 0), 0),
      activePtyListeners, retainedDisposers: disposers.length,
    };
  });
  const exitedHistory = await measured(async () => {
    const { manager, getPty } = createManager();
    const session = await manager.createSession(sessionOptions);
    getPty().emit("\x1b[32m历史中文🙂\x1b[0m\r\n");
    getPty().finish();
    const snapshot = manager.getSnapshot(session.sessionId);
    const listenersAfterExit = activePtyListeners;
    await manager.closeSession(session.sessionId);
    return { status: snapshot?.status, historyPreserved: snapshot?.output.includes("历史中文🙂"), listenersAfterExit };
  });
  const cache = await measured(async () => {
    const cache = createSessionListCache({ nowMs: () => 1_000 });
    let loads = 0;
    async function request(index: number) {
      return cache.run({
        request: { provider: "codex", scope: "global_recent", limit: 20, offset: index * 20 }, codexHomes: [],
        load: async () => {
          loads += 1;
          return Array.from({ length: 20 }, (_, row) => ({
            provider: "codex" as const, session_id: `${index}:${row}`, cwd: root,
            updated_at: "2026-10-11T00:00:00Z", preview: `${index}:${row}:${"合成摘要".repeat(50)}`,
          }));
        },
      });
    }
    for (let index = 0; index < 4_000; index += 1) await request(index);
    const beforeProbe = loads;
    await request(3_999);
    const hotCacheHit = loads === beforeProbe;
    await request(0);
    return { requests: 4_000, hotCacheHit, oldestEntryReloaded: loads > beforeProbe };
  });
  const temp = await mkdtemp(path.join(os.tmpdir(), "codedeck-perf-index-"));
  let index;
  try {
    const lines = Array.from({ length: 20_000 }, (_, id) => JSON.stringify({
      id: `perf-${id}`, thread_name: `性能索引 ${id}`, cwd: root, updated_at: "2026-10-11T00:00:00Z",
    }));
    await writeFile(path.join(temp, "session_index.jsonl"), `${lines.join("\n")}\n`);
    index = await measured(async () => {
      await readCodexSessionTitle(temp, "perf-19999");
      const started = performance.now();
      for (let round = 0; round < 500; round += 1) await readCodexSessionTitle(temp, "perf-19999");
      const warmTitleLookupMs = performance.now() - started;
      const times: number[] = [];
      let sessions = 0;
      for (let round = 0; round < 20; round += 1) {
        const before = performance.now();
        sessions = (await listCodexSessions({ provider: "codex", scope: "global_recent", limit: 50, detail: "summary" }, temp)).length;
        times.push(performance.now() - before);
      }
      return { indexEntries: lines.length, titleLookups: 500, warmTitleLookupMs, pageSessions: sessions, pageTimesMs: times };
    });
  } finally {
    // Only the exact fresh mkdtemp path is removed; no user Home is a deletion target.
    await rm(temp, { recursive: true, force: true });
  }
  return { stream, churn, exitedHistory, cache, index, activeResources: process.getActiveResourcesInfo() };
}

if (args.includes("--worker")) {
  process.stdout.write(JSON.stringify(await trial()));
} else {
  const runs = Number(option("--runs", "3"));
  if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error("--runs must be 1..20");
  const hashes: Record<string, string | null> = {};
  for (const source of sources) {
    const file = compiledBuild ? source.replace(/\.tsx?$/, ".js") : source;
    hashes[file] = await readFile(path.join(moduleRoot, file)).then((data) => createHash("sha256").update(data).digest("hex")).catch(() => null);
  }
  const trials = [];
  for (let run = 0; run < runs; run += 1) {
    trials.push(JSON.parse(execFileSync(process.execPath, ["--import", "tsx", fileURLToPath(import.meta.url), "--worker", "--chunks", String(chunks),
      ...(compiledBuild ? ["--compiled-build", compiledBuild] : []), ...(args.includes("--settled") ? ["--settled"] : [])], {
      cwd: root, encoding: "utf8", windowsHide: true, maxBuffer: 4 * 1024 * 1024, timeout: 180_000,
    })));
  }
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({
    schemaVersion: 1, measuredAt: new Date().toISOString(), node: process.version, platform: process.platform,
    logicalCpus: os.availableParallelism(), kind: "synthetic module benchmark; JSON serialization simulates status IPC",
    compiledBuild: compiledBuild || null, chunks,
    forcedGc: false, memoryNote: "Heap/RSS samples include normal GC noise; retained counts are separate logical metrics.", hashes, trials,
  }, null, 2));
  console.log(JSON.stringify({ output, trials: trials.length, first: trials[0].stream.result, churn: trials[0].churn.result }));
}
