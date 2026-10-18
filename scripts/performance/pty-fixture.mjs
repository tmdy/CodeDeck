import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

const [home, id] = process.argv.slice(2);
if (!home || !id || process.env.CODEDECK_PERF_FIXTURE !== "1") throw new Error("Isolated benchmark only");
const directory = path.join(home, "sessions", "2026", "10", "11");
mkdirSync(directory, { recursive: true });
const file = path.join(directory, `rollout-2026-10-11T00-00-00-${id}.jsonl`);
const append = (record) => appendFileSync(file, `${JSON.stringify({ timestamp: new Date().toISOString(), ...record })}\n`);
append({ type: "session_meta", payload: { id, cwd: process.cwd() } });
appendFileSync(path.join(home, "session_index.jsonl"), `${JSON.stringify({ id, thread_name: `性能测试 ${id.slice(0, 8)}`, cwd: process.cwd(), updated_at: new Date().toISOString() })}\n`);
process.stdout.write(`\x1b]0;${id}\x07PERF_READY 中文🙂\r\n`);
let busy = false;
const input = createInterface({ input: process.stdin });
input.on("line", async (line) => {
  if (line.trim() === "exit") { input.close(); process.exit(0); }
  if (line.trim() !== "flood" || busy) return;
  busy = true;
  const turnId = "performance-turn";
  append({ type: "event_msg", payload: { type: "task_started", turn_id: turnId } });
  for (let index = 0; index < 400; index += 1) {
    process.stdout.write(`\x1b[32m${String(index).padStart(4, "0")} 中文🙂 ${"x".repeat(500)}\x1b[0m\r\n`);
    await delay(5);
  }
  append({ type: "event_msg", payload: { type: "task_complete", turn_id: turnId } });
  process.stdout.write("PERF_DONE 中文🙂\r\n");
  busy = false;
});
