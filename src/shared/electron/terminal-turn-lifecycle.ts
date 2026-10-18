export type TerminalTurnLifecyclePhase = "started" | "completed" | "failed";

export interface TerminalTurnLifecycleError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface TerminalTurnLifecycleEvent {
  phase: TerminalTurnLifecyclePhase;
  timestampMs?: number;
  turnId?: string;
  error?: TerminalTurnLifecycleError;
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

function isRetryableCodexError(value: unknown, message: string): boolean {
  const record = asRecord(value);
  const info = asRecord(record?.codex_error_info);
  const http = asRecord(info?.http_connection_failed)
    ?? asRecord(info?.response_stream_connection_failed)
    ?? asRecord(info?.response_stream_disconnected)
    ?? asRecord(info?.response_too_many_failed_attempts);
  const status = typeof http?.http_status_code === "number" ? http.http_status_code : undefined;
  if (status === 401 || status === 403) {
    return false;
  }
  if (status !== undefined) {
    return status === 408 || status === 425 || status === 429 || status >= 500 && status <= 599;
  }
  if (typeof record?.retryable === "boolean") {
    return record.retryable;
  }
  const details = [
    message,
    firstString(record?.code, record?.status, record?.status_code, record?.statusCode),
  ].filter(Boolean).join(" ");
  if (/\b(?:401|403)\b|unauthorized|forbidden|invalid (?:api )?key|authentication|鉴权|认证失败|密钥无效/i.test(details)) {
    return false;
  }
  return /\b(?:408|425|429|5\d{2})\b|rate[ -]?limit|too many requests|temporary|temporarily|high demand|no available channel|unavailable|overload|timeout|timed out|try again|请求过多|临时|服务繁忙|服务不可用|无可用渠道/i.test(details);
}

function parseCodexError(value: unknown): TerminalTurnLifecycleError {
  const record = asRecord(value);
  const message = firstString(
    typeof value === "string" ? value : undefined,
    record?.message,
    record?.detail,
    record?.reason,
  ) || "Codex provider 报告当前回合失败。";
  return {
    code: "provider_error",
    message,
    retryable: isRetryableCodexError(value, message),
  };
}

function parseCodexLifecycle(record: JsonRecord): TerminalTurnLifecycleEvent | null {
  if (record.type !== "event_msg") {
    return null;
  }
  const payload = asRecord(record.payload);
  const identity = {
    timestampMs: parseTimestampMs(record),
    ...(typeof payload?.turn_id === "string" ? { turnId: payload.turn_id } : {}),
  };
  if (payload?.type === "task_started") {
    return { phase: "started", ...identity };
  }
  if (payload?.type === "task_complete") {
    if (payload.error !== undefined && payload.error !== null) {
      return {
        phase: "failed",
        ...identity,
        error: parseCodexError(payload.error),
      };
    }
    return { phase: "completed", ...identity };
  }
  if (payload?.type === "turn_aborted") {
    return { phase: "failed", ...identity, error: {
      code: "interrupted", message: "Codex 回合已中断。", retryable: false,
    } };
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
