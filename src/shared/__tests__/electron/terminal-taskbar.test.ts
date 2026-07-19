import { describe, expect, it } from "vitest";
import { resolveTerminalTaskbarAction } from "../../electron/terminal-taskbar.js";

describe("resolveTerminalTaskbarAction", () => {
  it("shows indeterminate progress while busy on Windows", () => {
    expect(resolveTerminalTaskbarAction({
      platform: "win32",
      previousActivity: "idle",
      activity: "busy",
      reason: "submitted_input",
      focused: false,
    })).toEqual({ progress: 2, flash: false });
  });

  it("removes progress and flashes after background work completes", () => {
    expect(resolveTerminalTaskbarAction({
      platform: "win32",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
      focused: false,
    })).toEqual({ progress: -1, flash: true });
  });

  it("does not flash a focused terminal or control non-Windows taskbars", () => {
    expect(resolveTerminalTaskbarAction({
      platform: "win32",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
      focused: true,
    })).toEqual({ progress: -1, flash: false });
    expect(resolveTerminalTaskbarAction({
      platform: "linux",
      previousActivity: "idle",
      activity: "busy",
      reason: "submitted_input",
      focused: false,
    })).toEqual({ progress: null, flash: false });
  });

  it("does not flash for provisional prompts, exits, or closed sessions", () => {
    for (const reason of ["idle_prompt", "process_exit", "session_closed"] as const) {
      expect(resolveTerminalTaskbarAction({
        platform: "win32",
        previousActivity: "busy",
        activity: "idle",
        reason,
        focused: false,
      })).toEqual({ progress: -1, flash: false });
    }
  });
});
