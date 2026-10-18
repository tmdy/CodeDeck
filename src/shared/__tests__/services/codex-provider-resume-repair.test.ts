import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { prepareCodexProviderResumeRepair } from "../../services/codex-provider-resume-repair.js";

const roots: string[] = [];
const sessionId = "11111111-2222-3333-4444-555555555555";
const message = { type: "message", role: "user", content: [{ type: "input_text", text: "Keep my message" }] };
const reasoning = { type: "reasoning", id: "rs_fixture", summary: [], encrypted_content: "fixture-encrypted" };
const row = (type: string, payload: object, metadata?: object) => ({ timestamp: "2026-10-10T00:00:00Z", type, payload, ...(metadata ? { metadata } : {}) });

async function fixture(rows: object[], provider = "site_provider_fixture") {
  const root = await mkdtemp(path.join(os.tmpdir(), "codedeck-provider-repair-"));
  roots.push(root);
  const filePath = path.join(root, "fixture.jsonl");
  const original = [row("session_meta", { id: sessionId, model_provider: provider }), ...rows].map((value) => JSON.stringify(value)).join("\n") + "\n";
  await writeFile(filePath, original);
  return { filePath, original, options: { filePath, sessionId, targetProvider: "openai_http" } };
}

afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

describe("Codex provider resume repair preparation", () => {
  it("removes only opaque reasoning and preserves messages, tool pairs and aligned metadata", async () => {
    const call = { type: "function_call", call_id: "call1", name: "exec_command", arguments: "{}" };
    const output = { type: "function_call_output", call_id: "call1", output: "done" };
    const plainReasoning = { type: "reasoning", summary: [{ type: "summary_text", text: "Plain summary" }], encrypted_content: null };
    const f = await fixture([
      row("compacted", { message: "summary", replacement_history: [message, reasoning, call], replacement_history_metadata: [{ user_input_order: 1 }, {}, { execution: "keep" }], retained_context: null, resume_metadata: { last_started_turn_id: "old-turn" }, window_number: null }),
      row("response_item", output, { execution: "output" }), row("response_item", plainReasoning), row("response_item", reasoning),
    ]);
    const plan = await prepareCodexProviderResumeRepair(f.options);
    expect(plan?.removedReasoningItems).toBe(2);
    expect(plan?.originalSize).toBe(Buffer.byteLength(f.original));
    expect(plan?.originalSha256).toBe(createHash("sha256").update(f.original).digest("hex"));
    const appended = JSON.parse(plan!.appendText.trim().split("\n")[0]);
    expect(appended.payload.replacement_history).toEqual([message, call, output, plainReasoning]);
    expect(appended.payload.replacement_history_metadata).toEqual([{ user_input_order: 1 }, { execution: "keep" }, { execution: "output" }, {}]);
    expect(appended.payload.resume_metadata.last_started_turn_id).toBe("old-turn");
    expect(await readFile(f.filePath, "utf8")).toBe(f.original);
  });

  it("does nothing for same-provider history or already sanitized history", async () => {
    const same = await fixture([row("response_item", reasoning)], "openai_http");
    expect(await prepareCodexProviderResumeRepair(same.options)).toBeNull();
    const clean = await fixture([row("response_item", message)]);
    expect(await prepareCodexProviderResumeRepair(clean.options)).toBeNull();
  });

  it("ignores superseded opaque reasoning before the latest complete compaction", async () => {
    const f = await fixture([row("response_item", reasoning), row("compacted", { message: "summary", replacement_history: [message], window_number: null })]);
    expect(await prepareCodexProviderResumeRepair(f.options)).toBeNull();
  });

  it.each([
    row("event_msg", { type: "thread_rolled_back", num_turns: 1 }),
    row("inter_agent_communication", { type: "unknown" }),
    row("compacted", { message: "unsupported legacy summary" }),
  ])("rejects unsupported active history without altering the rollout: %j", async (unsupportedRow) => {
    const f = await fixture([row("response_item", reasoning), unsupportedRow]);
    await expect(prepareCodexProviderResumeRepair(f.options)).rejects.toThrow("无法安全还原");
    expect(await readFile(f.filePath, "utf8")).toBe(f.original);
  });

  it("rejects inconsistent checkpoint metadata instead of silently reassigning it", async () => {
    const f = await fixture([row("compacted", { replacement_history: [reasoning, message], replacement_history_metadata: [{}] })]);
    await expect(prepareCodexProviderResumeRepair(f.options)).rejects.toThrow("元数据不匹配");
  });

  it("preserves paginated window identity and replays world state and completed-turn companions", async () => {
    const world = row("world_state", { full: true, state: { tools: "fixture" } });
    const context = row("turn_context", { turn_id: "turn1", model: "gpt-6.1-sol", history_mode: "paginated" });
    const started = row("event_msg", { type: "task_started", turn_id: "turn1" });
    const completed = row("event_msg", { type: "task_complete", turn_id: "turn1" });
    const usage = row("token_usage_record", { id: "usage1", input_tokens: 12 });
    const retained = row("retained_context", { type: "fixture" });
    const f = await fixture([
      row("compacted", { message: "summary", replacement_history: [message], window_number: 31, first_window_id: "first", previous_window_id: "previous", window_id: "current", retained_context: { fixture: true }, compaction_response_id: "old-provider-response", resume_metadata: { last_started_turn_id: "stale" } }),
      world, context, started, row("response_item", reasoning), usage, retained, completed,
      row("event_msg", { type: "user_message", message: "Do not duplicate visible messages" }),
    ]);
    const plan = await prepareCodexProviderResumeRepair(f.options);
    const rows = plan!.appendText.trim().split("\n").map((line) => JSON.parse(line));
    expect(rows[0].payload).toMatchObject({ window_number: 31, first_window_id: "first", previous_window_id: "previous", window_id: "current", retained_context: { fixture: true }, compaction_response_id: null, resume_metadata: { last_started_turn_id: "turn1", previous_turn_settings: { model: "gpt-6.1-sol", comp_hash: null, realtime_active: null } }, latest_token_usage_record: usage.payload });
    expect(rows[0].payload.replacement_history).toEqual([message]);
    expect(rows.slice(1)).toEqual([world, context, started, usage, retained, completed].map((record) => ({ ...record, codedeck_provider_resume_repair_companion: true })));
    expect(await readFile(f.filePath, "utf8")).toBe(f.original);
  });

  it("rejects mismatched session IDs and incomplete trailing records", async () => {
    const f = await fixture([row("response_item", reasoning)]);
    await expect(prepareCodexProviderResumeRepair({ ...f.options, sessionId: "different" })).rejects.toThrow("ID");
    await writeFile(f.filePath, f.original + '{"unfinished":');
    await expect(prepareCodexProviderResumeRepair(f.options)).rejects.toThrow("未写完");
  });

  it("treats later runtime provider settings as evidence without losing earlier provenance", async () => {
    const f = await fixture([row("response_item", reasoning), row("event_msg", { type: "thread_settings_applied", thread_settings: { model_provider_id: "openai_http" } })]);
    const plan = await prepareCodexProviderResumeRepair(f.options);
    expect(plan?.sourceProviders).toEqual(["site_provider_fixture", "openai_http"]);
    expect(plan?.removedReasoningItems).toBe(1);
  });

  it("keeps target-provider reasoning and does not repeat a completed conversion", async () => {
    const f = await fixture([
      row("response_item", reasoning),
      row("event_msg", { type: "thread_settings_applied", thread_settings: { model_provider_id: "openai_http" } }),
      row("response_item", { ...reasoning, id: "official-reasoning" }),
    ]);
    const plan = await prepareCodexProviderResumeRepair(f.options);
    expect(plan?.removedReasoningItems).toBe(1);
    const checkpoint = JSON.parse(plan!.appendText.trim().split("\n")[0]);
    expect(checkpoint.payload.replacement_history).toEqual([{ ...reasoning, id: "official-reasoning" }]);
    await writeFile(f.filePath, f.original + plan!.appendText + JSON.stringify(row("response_item", { ...reasoning, id: "new-official-reasoning" })) + "\n");
    expect(await prepareCodexProviderResumeRepair(f.options)).toBeNull();
  });

  it("preserves resume hints without a newer started turn and updates completed user-turn settings without a full world snapshot", async () => {
    const inherited = { multi_agent_version: "v1", last_started_turn_id: "old-turn", previous_turn_settings: { model: "old-model", comp_hash: "old-hash", realtime_active: false } };
    const f = await fixture([
      row("compacted", { message: "summary", replacement_history: [reasoning], window_number: 31, resume_metadata: inherited }),
      row("turn_context", { turn_id: "new-turn", model: "current-model", comp_hash: "current-hash", realtime_active: false, multi_agent_version: "v1" }),
      row("response_item", message), row("event_msg", { type: "task_complete", turn_id: "new-turn" }),
    ]);
    const plan = await prepareCodexProviderResumeRepair(f.options);
    const checkpoint = JSON.parse(plan!.appendText.trim().split("\n")[0]);
    expect(checkpoint.payload.resume_metadata).toEqual({ multi_agent_version: "v1", last_started_turn_id: "old-turn", previous_turn_settings: { model: "current-model", comp_hash: "current-hash", realtime_active: false } });
    const noSuffix = await fixture([row("compacted", { message: "summary", replacement_history: [reasoning], window_number: 31, resume_metadata: inherited })]);
    const noSuffixPlan = await prepareCodexProviderResumeRepair(noSuffix.options);
    expect(JSON.parse(noSuffixPlan!.appendText).payload.resume_metadata).toEqual(inherited);
  });

  it("keeps the earlier runtime version when a newer context omits it and restores aborted user-turn settings", async () => {
    const f = await fixture([
      row("compacted", { message: "summary", replacement_history: [reasoning], window_number: 31, resume_metadata: { multi_agent_version: "v1", last_started_turn_id: "old-turn", previous_turn_settings: { model: "old-model", comp_hash: null, realtime_active: false } } }),
      row("event_msg", { type: "task_started", turn_id: "aborted-turn" }),
      row("turn_context", { turn_id: "aborted-turn", model: "current-model", comp_hash: "current-hash", realtime_active: false }),
      row("response_item", message), row("response_item", reasoning), row("event_msg", { type: "turn_aborted", turn_id: "aborted-turn" }),
    ]);
    const plan = await prepareCodexProviderResumeRepair(f.options);
    expect(JSON.parse(plan!.appendText.trim().split("\n")[0]).payload.resume_metadata).toEqual({ multi_agent_version: "v1", last_started_turn_id: "aborted-turn", previous_turn_settings: { model: "current-model", comp_hash: "current-hash", realtime_active: false } });
  });
});
