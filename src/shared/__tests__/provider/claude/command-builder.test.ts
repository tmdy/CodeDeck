// Claude 命令构建器测试 — 翻译自 Go internal/provider/claude/command_builder_test.go

import { describe, it, expect } from "vitest";
import { buildClaudeCommand } from "../../../provider/claude/command-builder.js";

describe("buildClaudeCommand", () => {
  it("should use setting-sources when exclude user settings", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "direct",
      extraArgs: "",
      excludeUserSettings: true,
    });
    expect(cmd).toBe("claude --setting-sources 'project,local'");
  });

  it("should use settings file when provided", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "direct",
      extraArgs: "",
      excludeUserSettings: false,
      settingsFile: "/path/to/settings.json",
    });
    expect(cmd).toBe("claude --settings /path/to/settings.json");
  });

  it("should quote settings file path with spaces", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "direct",
      extraArgs: "",
      excludeUserSettings: false,
      settingsFile: "C:\\My Documents\\settings.json",
    });
    expect(cmd).toBe('claude --settings "C:\\My Documents\\settings.json"');
  });

  it("should add --continue flag", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "continue",
      extraArgs: "",
      excludeUserSettings: false,
    });
    expect(cmd).toContain("--continue");
  });

  it("should add --resume with session id", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "resume_selected",
      extraArgs: "",
      sessionId: "abc123",
      excludeUserSettings: false,
    });
    expect(cmd).toContain("--resume abc123");
  });

  it("should add --resume without session id", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "resume_selected",
      extraArgs: "",
      excludeUserSettings: false,
    });
    expect(cmd).toContain("--resume");
    expect(cmd).not.toContain("abc");
  });

  it("should append extra args", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "direct",
      extraArgs: "--verbose --debug",
      excludeUserSettings: false,
    });
    expect(cmd).toContain("--verbose --debug");
  });

  it("should default to claude when empty command base", () => {
    const cmd = buildClaudeCommand({
      commandBase: "",
      launchMode: "direct",
      extraArgs: "",
      excludeUserSettings: false,
    });
    expect(cmd.startsWith("claude")).toBe(true);
  });
});