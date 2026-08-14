import { describe, expect, it } from "vitest";
import {
  cleanTerminalText,
  parseAgentBridgeRequest,
  parseAgentScopedRequest,
} from "../../agent-bridge/protocol.js";

describe("agent bridge protocol", () => {
  it("accepts bounded run overrides and parent delivery metadata", () => {
    expect(parseAgentBridgeRequest({
      command: "run",
      profile_key: "codex::demo",
      prompt: "inspect this repository",
      cwd: " C:\\repo ",
      wait_ms: 999999999,
      model: "gpt-5.6",
      reasoning_effort: "high",
      parent_session_id: " terminal-parent ",
      parent_token: " parent-secret ",
      return_policy: "continuous",
      env: { SECRET: "forbidden" },
    })).toEqual({
      command: "run",
      profile_key: "codex::demo",
      prompt: "inspect this repository",
      cwd: "C:\\repo",
      wait_ms: 3_600_000,
      model: "gpt-5.6",
      reasoning_effort: "high",
      parent_session_id: "terminal-parent",
      parent_token: "parent-secret",
      return_policy: "continuous",
    });
  });

  it("rejects invalid policies and empty override values", () => {
    expect(() => parseAgentBridgeRequest({
      command: "run",
      profile_key: "codex::demo",
      prompt: "task",
      return_policy: "always",
    })).toThrow("return_policy");
    expect(() => parseAgentBridgeRequest({
      command: "run",
      profile_key: "codex::demo",
      prompt: "task",
      model: " ",
    })).toThrow("model");
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

  it("parses bound child and scoped parent interrupt requests", () => {
    expect(parseAgentBridgeRequest({
      command: "interrupt",
      session_id: " child-task ",
      parent_session_id: " parent-terminal ",
      parent_token: " parent-secret ",
    })).toEqual({
      command: "interrupt",
      session_id: "child-task",
      parent_session_id: "parent-terminal",
      parent_token: "parent-secret",
    });
    expect(parseAgentScopedRequest({ command: "interrupt_parent" })).toEqual({
      command: "interrupt_parent",
    });
  });

  it("removes terminal escape and control sequences", () => {
    expect(cleanTerminalText("\u001b[31manswer\u001b[0m\r\n\u0007done")).toBe("answer\ndone");
  });
});
