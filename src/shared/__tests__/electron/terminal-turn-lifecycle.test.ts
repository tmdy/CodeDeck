import { describe, expect, it } from "vitest";
import { parseTerminalTurnLifecycleLine } from "../../electron/terminal-turn-lifecycle.js";

describe("parseTerminalTurnLifecycleLine", () => {
  it.each([503, 429, 401, 403, 400])("classifies verified final HTTP status %i and retains turn identity", (status) => {
    const line = JSON.stringify({ timestamp: "2026-10-10T00:00:01Z", type: "event_msg", payload: {
      type: "task_complete", turn_id: "current", error: { message: "high demand", codex_error_info: {
        http_connection_failed: { http_status_code: status },
      } },
    } });
    expect(parseTerminalTurnLifecycleLine("codex", line)).toMatchObject({
      phase: "failed", turnId: "current", error: { retryable: status === 503 || status === 429 },
    });
  });

  it("does not authorize intermediate errors, warnings, unknown failure or aborted turns", () => {
    for (const type of ["stream_error", "error", "warning"]) {
      expect(parseTerminalTurnLifecycleLine("codex", JSON.stringify({ type: "event_msg", payload: {
        type, message: "high demand 503",
      } }))).toBeNull();
    }
    expect(parseTerminalTurnLifecycleLine("codex", JSON.stringify({ type: "event_msg", payload: {
      type: "task_complete", error: { message: "unknown failure" },
    } }))?.error?.retryable).toBe(false);
    expect(parseTerminalTurnLifecycleLine("codex", JSON.stringify({ type: "event_msg", payload: {
      type: "turn_aborted", turn_id: "aborted", reason: "interrupted", error: { message: "high demand 503" },
    } }))).toMatchObject({ phase: "failed", turnId: "aborted", error: { code: "interrupted", retryable: false } });
  });
  it("reads Codex task lifecycle events", () => {
    expect(parseTerminalTurnLifecycleLine("codex", JSON.stringify({
      timestamp: "2026-07-13T04:00:00.000Z",
      type: "event_msg",
      payload: { type: "task_started" },
    }))).toEqual({ phase: "started", timestampMs: 1783915200000 });
    expect(parseTerminalTurnLifecycleLine("codex", JSON.stringify({
      timestamp: "2026-07-13T04:01:00.000Z",
      type: "event_msg",
      payload: { type: "task_complete" },
    }))).toEqual({ phase: "completed", timestampMs: 1783915260000 });
  });

  it("exposes Codex provider failures instead of treating them as completed", () => {
    expect(parseTerminalTurnLifecycleLine("codex", JSON.stringify({
      timestamp: "2026-07-13T04:01:00.000Z",
      type: "event_msg",
      payload: {
        type: "task_complete",
        error: {
          message: "unexpected status 503 Service Unavailable: No available channel",
        },
      },
    }))).toEqual({
      phase: "failed",
      timestampMs: 1783915260000,
      error: {
        code: "provider_error",
        message: "unexpected status 503 Service Unavailable: No available channel",
        retryable: true,
      },
    });

    expect(parseTerminalTurnLifecycleLine("codex", JSON.stringify({
      type: "event_msg",
      payload: {
        type: "task_complete",
        error: { message: "unexpected status 521 Web Server Is Down" },
      },
    }))).toMatchObject({
      phase: "failed",
      error: { code: "provider_error", retryable: true },
    });

    expect(parseTerminalTurnLifecycleLine("codex", JSON.stringify({
      type: "event_msg",
      payload: {
        type: "task_complete",
        error: { message: "401 Unauthorized: invalid API key" },
      },
    }))?.error).toMatchObject({
      code: "provider_error",
      retryable: false,
    });
  });

  it("treats a null Codex task error as a normal completion", () => {
    expect(parseTerminalTurnLifecycleLine("codex", JSON.stringify({
      type: "event_msg",
      payload: { type: "task_complete", error: null },
    }))).toEqual({ phase: "completed", timestampMs: undefined });
  });

  it("only treats final Claude assistant records as completed", () => {
    expect(parseTerminalTurnLifecycleLine("claude", JSON.stringify({
      type: "assistant",
      message: { stop_reason: "tool_use" },
    }))).toBeNull();
    expect(parseTerminalTurnLifecycleLine("claude", JSON.stringify({
      type: "assistant",
      message: { stop_reason: "end_turn" },
    }))).toEqual({ phase: "completed", timestampMs: undefined });
    expect(parseTerminalTurnLifecycleLine("claude", JSON.stringify({
      type: "assistant",
      message: { stop_reason: "stop_sequence" },
    }))).toEqual({ phase: "completed", timestampMs: undefined });
    expect(parseTerminalTurnLifecycleLine("claude", JSON.stringify({
      type: "assistant",
      isSidechain: true,
      message: { stop_reason: "end_turn" },
    }))).toBeNull();
  });

  it("ignores Claude tool-result user records and malformed lines", () => {
    expect(parseTerminalTurnLifecycleLine("claude", JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result" }] },
    }))).toBeNull();
    expect(parseTerminalTurnLifecycleLine("claude", "not json")).toBeNull();
  });
});
