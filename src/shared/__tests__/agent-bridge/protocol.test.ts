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
      orchestrator: true,
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
      orchestrator: true,
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

  it("accepts only one bounded provider id for token requests", () => {
    expect(parseAgentBridgeRequest({
      command: "auth_token",
      provider_id: " site_provider_0123456789abcdef ",
    })).toEqual({
      command: "auth_token",
      provider_id: "site_provider_0123456789abcdef",
    });
    expect(() => parseAgentBridgeRequest({ command: "auth_token" })).toThrow("provider_id");
  });

  it("parses bound child and scoped parent control requests", () => {
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
    expect(parseAgentScopedRequest({ command: "status_parent" })).toEqual({
      command: "status_parent",
    });
    expect(parseAgentScopedRequest({
      command: "continue_parent",
      prompt: " resume the debate ",
    })).toEqual({
      command: "continue_parent",
      prompt: "resume the debate",
    });
    expect(() => parseAgentScopedRequest({
      command: "continue_parent",
      prompt: " ",
    })).toThrow("prompt");
  });

  it("removes terminal escape and control sequences", () => {
    expect(cleanTerminalText("\u001b[31manswer\u001b[0m\r\n\u0007done")).toBe("answer\ndone");
  });

  it("renders carriage returns, cursor movement, and screen clears as visible terminal text", () => {
    expect(cleanTerminalText(
      "progress 1\rprogress 2\nold\u001b[1A\rnew\u001b[2J\u001b[Hfinal\nready",
    )).toBe("final\nready");
  });

  it("replays VT erase and delete operations without leaking replaced text", () => {
    expect(cleanTerminalText("abcdef\r\u001b[2C\u001b[2X")).toBe("ab  ef");
    expect(cleanTerminalText("abcdef\r\u001b[2C\u001b[2P")).toBe("abef");
    expect(cleanTerminalText("visible\u001b[3J")).toBe("visible");
  });

  it("removes terminal title updates instead of leaking OSC payloads", () => {
    expect(cleanTerminalText("before\n\u001b]0;Working - CodeDeck\u0007after")).toBe(
      "before\nafter",
    );
  });
});
