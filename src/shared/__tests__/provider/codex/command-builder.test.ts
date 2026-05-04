// Codex 命令构建器测试 — 翻译自 Go internal/provider/codex/command_builder_test.go

import { describe, it, expect } from "vitest";
import { buildCodexCommand } from "../../../provider/codex/command-builder.js";

describe("buildCodexCommand", () => {
  it("should use temporary provider for continue mode", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "continue",
      extraArgs: "--search",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.4",
    });

    expect(cmd).toContain("codex");
    expect(cmd).toContain("resume --last");
    expect(cmd).toContain("model_provider");
    expect(cmd).toContain("CODEX_PROFILE_LAUNCHER_API_KEY");
    expect(cmd).toContain(".env_key");
    expect(cmd).toContain("-m gpt-5.4");
    expect(cmd).toContain("--search");
  });

  it("should use default model when not provided", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "direct",
      extraArgs: "",
      baseUrl: "https://api.openai.com/v1",
    });

    expect(cmd).toContain("-m gpt-5.4");
  });

  it("should handle direct launch mode", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "direct",
      extraArgs: "",
      baseUrl: "https://example.com",
    });

    expect(cmd).not.toContain("resume");
    expect(cmd).not.toContain("--continue");
  });

  it("should handle resume_selected mode with session id", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "resume_selected",
      extraArgs: "",
      sessionId: "session-456",
      baseUrl: "https://example.com/v1",
    });

    expect(cmd).toContain("resume session-456");
  });

  it("should default to codex when empty command base", () => {
    const cmd = buildCodexCommand({
      commandBase: "",
      launchMode: "direct",
      extraArgs: "",
      baseUrl: "https://example.com",
    });

    expect(cmd.startsWith("codex")).toBe(true);
  });

  it("should normalize base URL for command", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "direct",
      extraArgs: "",
      baseUrl: "https://proxy.example.com/v1/responses",
    });

    // 验证 URL 已被规范化（/responses 被剥离）
    expect(cmd).not.toContain("/responses");
  });
});