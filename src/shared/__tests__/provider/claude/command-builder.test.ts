// Claude 命令构建器测试 — 翻译自 Go internal/provider/claude/command_builder_test.go

import { describe, it, expect } from "vitest";
import { buildClaudeCommand } from "../../../provider/claude/command-builder.js";

describe("buildClaudeCommand", () => {
  it("should use setting-sources when exclude user settings", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "new",
      extraArgs: "",
      excludeUserSettings: true,
    });
    expect(cmd).toBe('claude --setting-sources "project,local"');
  });

  it("should quote custom setting-sources values for PowerShell-safe launch commands", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "new",
      extraArgs: "",
      excludeUserSettings: true,
      settingSources: "user,project",
    });
    expect(cmd).toBe('claude --setting-sources "user,project"');
  });

  it("should use settings file when provided", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "new",
      extraArgs: "",
      excludeUserSettings: false,
      settingsFile: "/path/to/settings.json",
    });
    expect(cmd).toBe('claude --settings "/path/to/settings.json"');
  });

  it("should quote settings file path with spaces", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "new",
      extraArgs: "",
      excludeUserSettings: false,
      settingsFile: "C:\\My Documents\\settings.json",
    });
    expect(cmd).toBe('claude --settings "C:\\My Documents\\settings.json"');
  });

  it("should add --continue for continue_last", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "continue_last",
      extraArgs: "",
      excludeUserSettings: false,
    });
    expect(cmd).toBe("claude --continue");
  });

  it("should add --resume without a session id for resume_picker", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "resume_picker",
      extraArgs: "",
      excludeUserSettings: false,
    });

    expect(cmd).toBe("claude --resume");
  });

  it("should add --resume with a quoted session id for resume_selected", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "resume_selected",
      extraArgs: "",
      sessionId: "abc123",
      excludeUserSettings: false,
    });

    expect(cmd).toBe('claude --resume "abc123"');
  });

  it("should not add resume flags for new mode", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "new",
      extraArgs: "",
      excludeUserSettings: false,
    });

    expect(cmd).toBe("claude");
  });

  it("should append extra args", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "new",
      extraArgs: "--verbose --debug",
      excludeUserSettings: false,
    });
    expect(cmd).toContain("--verbose --debug");
  });

  it("should append the model flag when provided", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "new",
      extraArgs: "",
      excludeUserSettings: false,
      model: "claude-sonnet-4.6",
    });

    expect(cmd).toContain("--model claude-sonnet-4.6");
  });

  it("should append capability overlay arguments with mcp config last", () => {
    const cmd = buildClaudeCommand({
      commandBase: "claude",
      launchMode: "new",
      extraArgs: "--verbose",
      excludeUserSettings: true,
      settingsFile: "C:/overlay/settings.global-capabilities.json",
      addDirs: ["C:/overlay/skills-add-dir"],
      pluginDirs: ["C:/Users/test/.claude/plugins/cache/document-skills"],
      mcpConfigPaths: ["C:/overlay/mcp-config.json"],
      permissionMode: "default",
    });

    expect(cmd).toBe(
      'claude --setting-sources "project,local" --settings "C:/overlay/settings.global-capabilities.json" --add-dir C:/overlay/skills-add-dir --plugin-dir C:/Users/test/.claude/plugins/cache/document-skills --permission-mode default --verbose --mcp-config C:/overlay/mcp-config.json',
    );
  });

  it("should default to claude when empty command base", () => {
    const cmd = buildClaudeCommand({
      commandBase: "",
      launchMode: "new",
      extraArgs: "",
      excludeUserSettings: false,
    });
    expect(cmd.startsWith("claude")).toBe(true);
  });
});
