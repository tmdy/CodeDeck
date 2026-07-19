// Codex 命令构建器测试 — 翻译自 Go internal/provider/codex/command_builder_test.go

import { describe, it, expect } from "vitest";
import { buildCodexCommand } from "../../../provider/codex/command-builder.js";

describe("buildCodexCommand", () => {
  it("should build a continue_last command without changing the resume subcommand structure", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "continue_last",
      extraArgs: "--search",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4",
    });

    expect(cmd).toBe("codex resume --last --search");
  });

  it("should omit the model flag because config.toml carries the selected model", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "new",
      extraArgs: "",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4",
    });

    expect(cmd).toBe("codex");
  });

  it("should handle new launch mode", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "new",
      extraArgs: "",
      baseUrl: "https://example.com",
    });

    expect(cmd).not.toContain("resume");
    expect(cmd).not.toContain("--continue");
  });

  it("should handle resume_picker mode", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "resume_picker",
      extraArgs: "",
      baseUrl: "https://example.com/v1",
    });

    expect(cmd).toBe("codex resume");
  });

  it("should handle resume_picker_all mode", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "resume_picker_all",
      extraArgs: "",
      baseUrl: "https://example.com/v1",
    });

    expect(cmd).toBe("codex resume --all");
  });

  it("should handle resume_selected mode with a quoted session id", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "resume_selected",
      extraArgs: "",
      sessionId: "session-456",
      baseUrl: "https://example.com/v1",
    });

    expect(cmd).toBe('codex resume "session-456"');
  });

  it("should default to codex when empty command base", () => {
    const cmd = buildCodexCommand({
      commandBase: "",
      launchMode: "new",
      extraArgs: "",
      baseUrl: "https://example.com",
    });

    expect(cmd.startsWith("codex")).toBe(true);
  });

  it("should normalize base URL for command", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "new",
      extraArgs: "",
      baseUrl: "https://proxy.example.com/v1/responses",
    });

    // 验证 URL 已被规范化（/responses 被剥离）
    expect(cmd).not.toContain("/responses");
  });
});
