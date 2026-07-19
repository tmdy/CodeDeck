import { describe, expect, it } from "vitest";
import { parseTerminalTurnLifecycleLine } from "../../electron/terminal-turn-lifecycle.js";

describe("parseTerminalTurnLifecycleLine", () => {
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
