import { describe, expect, it } from "vitest";
import { cleanTerminalText, parseAgentBridgeRequest } from "../../agent-bridge/protocol.js";

describe("agent bridge protocol", () => {
  it("accepts only the supported run overrides", () => {
    expect(parseAgentBridgeRequest({
      command: "run",
      profile_key: "codex::demo",
      prompt: "inspect this repository",
      cwd: " C:\\repo ",
      wait_ms: 999999999,
      model: "forbidden",
      env: { SECRET: "forbidden" },
    })).toEqual({
      command: "run",
      profile_key: "codex::demo",
      prompt: "inspect this repository",
      cwd: "C:\\repo",
      wait_ms: 3_600_000,
    });
  });

  it("rejects missing prompts and invalid wait values", () => {
    expect(() => parseAgentBridgeRequest({
      command: "run",
      profile_key: "codex::demo",
      prompt: " ",
    })).toThrow("prompt");
    expect(() => parseAgentBridgeRequest({
      command: "wait",
      session_id: "session",
      wait_ms: -1,
    })).toThrow("wait_ms");
  });

  it("removes terminal escape and control sequences", () => {
    expect(cleanTerminalText("\u001b[31manswer\u001b[0m\r\n\u0007done")).toBe("answer\ndone");
  });
});
