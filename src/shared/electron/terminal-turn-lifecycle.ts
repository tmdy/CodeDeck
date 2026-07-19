export type TerminalTurnLifecyclePhase = "started" | "completed";

export interface TerminalTurnLifecycleEvent {
  phase: TerminalTurnLifecyclePhase;
  timestampMs?: number;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function parseTimestampMs(record: JsonRecord): number | undefined {
  const value = firstString(record.timestamp, record.time, record.created_at, record.createdAt);
  if (!value) {
    return undefined;
  }
  const timestampMs = new Date(value).getTime();
  return Number.isNaN(timestampMs) ? undefined : timestampMs;
}

function parseCodexLifecycle(record: JsonRecord): TerminalTurnLifecycleEvent | null {
  if (record.type !== "event_msg") {
    return null;
  }
  const payload = asRecord(record.payload);
  if (payload?.type === "task_started") {
    return { phase: "started", timestampMs: parseTimestampMs(record) };
  }
  if (payload?.type === "task_complete") {
    return { phase: "completed", timestampMs: parseTimestampMs(record) };
  }
  return null;
}

function parseClaudeLifecycle(record: JsonRecord): TerminalTurnLifecycleEvent | null {
  if (record.isSidechain === true) {
    return null;
  }
  const timestampMs = parseTimestampMs(record);
  if (record.type === "user") {
    const message = asRecord(record.message);
    const content = message?.content;
    const isToolResult = Array.isArray(content) && content.some((entry) =>
      asRecord(entry)?.type === "tool_result"
    );
    if (!isToolResult) {
      return { phase: "started", timestampMs };
    }
    return null;
  }
  if (record.type === "assistant") {
    const message = asRecord(record.message);
    const stopReason = firstString(message?.stop_reason, message?.stopReason);
    if (stopReason === "end_turn" || stopReason === "stop_sequence") {
      return { phase: "completed", timestampMs };
    }
  }
  return null;
}

export function parseTerminalTurnLifecycleLine(
  provider: string,
  line: string,
): TerminalTurnLifecycleEvent | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  let record: JsonRecord | undefined;
  try {
    record = asRecord(JSON.parse(trimmed));
  } catch {
    return null;
  }
  if (!record) {
    return null;
  }
  return provider.trim().toLowerCase() === "codex"
    ? parseCodexLifecycle(record)
    : parseClaudeLifecycle(record);
}
