import { createReadStream } from "node:fs";
import { mkdir, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { createInterface } from "node:readline";
import { resolveCanonicalCodexHome } from "../../src/shared/services/codex-home.js";
import { listCodexSessions } from "../../src/shared/services/session-service.js";

// Read-only. Persist counts, sizes and timings, never session titles, prompts, credentials or raw log contexts.
const args = process.argv.slice(2);
function option(name: string, fallback: string): string {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1] ?? fallback;
}
const codexHome = path.resolve(option("--codex-home", resolveCanonicalCodexHome()));
const logDirectory = path.resolve(option("--logs", "app-data/logs"));
const output = path.resolve(option("--output", "release/performance-audit/existing-data.json"));
function distribution(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (p: number) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  return { count: sorted.length, p50Ms: quantile(0.5), p95Ms: quantile(0.95), maxMs: sorted.at(-1) ?? null };
}
const indexStat = await stat(path.join(codexHome, "session_index.jsonl")).catch(() => null);
const times: number[] = [];
let count = 0;
for (let index = 0; index < 20; index += 1) {
  const start = performance.now();
  count = (await listCodexSessions({ provider: "codex", scope: "global_recent", limit: 50, detail: "summary", hide_subagent_sessions: true }, codexHome)).length;
  times.push(performance.now() - start);
}
const events: Record<string, number> = {};
const timings: Record<string, number[]> = {};
let records = 0; let malformedLines = 0; let bytes = 0;
let firstTime = ""; let lastTime = "";
const files = (await readdir(logDirectory).catch(() => [])).filter((name) => /^codedeck\.log(?:\.\d+)?$/.test(name));
for (const name of files) {
  const file = path.join(logDirectory, name);
  bytes += (await stat(file)).size;
  const stream = createReadStream(file, "utf8");
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      try {
        const record = JSON.parse(line);
        records += 1;
        const event = typeof record.event === "string" ? record.event : "unknown";
        events[event] = (events[event] ?? 0) + 1;
        if (typeof record.time === "string") {
          if (!firstTime || record.time < firstTime) firstTime = record.time;
          if (record.time > lastTime) lastTime = record.time;
        }
        const channel = record.context?.channel;
        if (event === "ipc_success" && typeof channel === "string" && /session|model.*fetch|fetch.*model/i.test(channel)
          && typeof record.duration_ms === "number") (timings[channel] ??= []).push(record.duration_ms);
      } catch { malformedLines += 1; }
    }
  } finally { lines.close(); stream.destroy(); }
}
const report = {
  schemaVersion: 1, measuredAt: new Date().toISOString(), node: process.version,
  source: "current source with existing read-only Codex Home; logs may be from older running builds",
  codexHome, indexBytes: indexStat?.size ?? null,
  sessionList: { requested: 50, returned: count, detail: "summary", hideSubagents: true, timesMs: times, coldMs: times[0], warm: distribution(times.slice(1)) },
  logs: { files: files.length, bytes, records, malformedLines, firstTime, lastTime, events,
    timings: Object.fromEntries(Object.entries(timings).map(([key, values]) => [key, distribution(values)])) },
};
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ output, indexBytes: report.indexBytes, sessionList: report.sessionList, logRecords: records, skipped: events.auto_continue_skipped ?? 0 }));
