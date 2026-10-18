// Codex 命令构建器测试 — 翻译自 Go internal/provider/codex/command_builder_test.go

import { describe, it, expect } from "vitest";
import { buildCodexArgs, buildCodexCommand } from "../../../provider/codex/command-builder.js";
import { buildWindowsPtyLaunchSpec } from "../../../electron/launch-runtime.js";
import type { LaunchExecutionPlan } from "../../../services/launch-service.js";

describe("buildCodexCommand", () => {
  it("emits a TOML literal identity override that survives the Windows cmd/npm-shim launch command", () => {
    const options = { commandBase: "codex.cmd", launchMode: "new", extraArgs: "", baseUrl: "", monitored: true };
    const commandArgs = buildCodexArgs(options);
    expect(commandArgs).toEqual(["-c", "tui.terminal_title=['thread-id']"]);
    expect(buildCodexCommand(options)).toBe("codex.cmd -c tui.terminal_title=['thread-id']");
    const plan = { commandExecutable: "codex.cmd", commandArgs, cwd: "C:/test" } as LaunchExecutionPlan;
    const spec = buildWindowsPtyLaunchSpec(plan);
    expect(spec.filePath.toLowerCase()).toContain("cmd");
    expect(spec.args.at(-1)).toContain("tui.terminal_title=['thread-id']");
    expect(spec.args.at(-1)).not.toContain('\\"thread-id\\"');
    const initialPromptSpec = buildWindowsPtyLaunchSpec({ ...plan, agentInitialPromptEnvKey: "TEST_PROMPT" });
    const index = initialPromptSpec.args.indexOf("-EncodedCommand") + 1;
    const script = Buffer.from(initialPromptSpec.args[index], "base64").toString("utf16le");
    expect(script).toContain("tui.terminal_title=[''thread-id'']");
    expect(buildCodexArgs({ ...options, monitored: false })).toEqual([]);
  });
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

  it("should include an explicit one-run model override", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "new",
      extraArgs: "",
      baseUrl: "https://api.openai.com/v1",
      modelOverride: "gpt-5.4",
    });

    expect(cmd).toBe("codex --model gpt-5.4");
  });

  it("should handle new launch mode", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "new",
      extraArgs: "",
      baseUrl: "https://example.com",
    });

    expect(cmd).toBe("codex");
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

  it("should add a structured provider override for resume without changing new launches", () => {
    expect(buildCodexArgs({
      commandBase: "codex",
      launchMode: "resume_selected",
      extraArgs: '-c model_provider="historical"',
      sessionId: "session-456",
      baseUrl: "",
      modelProviderOverride: "openai_http",
    })).toEqual([
      "resume",
      "session-456",
      "-c",
      "model_provider=historical",
      "-c",
      'model_provider="openai_http"',
    ]);
    expect(buildCodexArgs({
      commandBase: "codex",
      launchMode: "new",
      extraArgs: "",
      baseUrl: "",
    })).toEqual([]);
  });

  it("should force hooks disabled after user feature arguments", () => {
    const cmd = buildCodexCommand({
      commandBase: "codex",
      launchMode: "new",
      extraArgs: "--enable hooks --search",
      baseUrl: "https://example.com/v1",
      disableHooks: true,
    });

    expect(cmd).toBe("codex --enable hooks --search --disable hooks");
  });

  it.each([
    ["new", []],
    ["continue_last", ["resume", "--last"]],
    ["resume_picker", ["resume"]],
    ["resume_picker_all", ["resume", "--all"]],
    ["resume_selected", ["resume", "session-456"]],
  ])("should add the trusted project override for %s mode", (launchMode, resumeArgs) => {
    const trustedProjectPath = "D:\\项目\\My Project";
    const trustedProjectOverride = "projects.D:\\项目\\My Project.trust_level=trusted";
    const args = buildCodexArgs({
      commandBase: "codex",
      launchMode,
      extraArgs: "-c projects.other.trust_level=untrusted --enable hooks",
      sessionId: "session-456",
      baseUrl: "https://example.com/v1",
      trustedProjectPath,
      disableHooks: true,
    });

    expect(args).toEqual([
      ...resumeArgs,
      "-c",
      "projects.other.trust_level=untrusted",
      "--enable",
      "hooks",
      "-c",
      trustedProjectOverride,
      "--disable",
      "hooks",
    ]);
    expect(args.at(-4)).toBe("-c");
    expect(args.at(-3)).toBe(trustedProjectOverride);
    expect(args.at(-3)).not.toContain('"');
  });

  it("should render the same trusted Windows path in the command preview", () => {
    const trustedProjectOverride = "projects.D:\\项目\\My Project.trust_level=trusted";
    const command = buildCodexCommand({
      commandBase: "codex",
      launchMode: "new",
      extraArgs: "",
      baseUrl: "https://example.com/v1",
      trustedProjectPath: "D:\\项目\\My Project",
    });

    expect(command).toContain(trustedProjectOverride);
    expect(command).toBe(`codex -c "${trustedProjectOverride}"`);
  });

  it("should use native separators for a Windows trusted project key", () => {
    const args = buildCodexArgs({
      commandBase: "codex",
      launchMode: "new",
      extraArgs: "",
      baseUrl: "https://example.com/v1",
      trustedProjectPath: "D:/CodeDeck",
    });

    expect(args).toEqual([
      "-c",
      "projects.D:\\CodeDeck.trust_level=trusted",
    ]);
  });

  it("should default to codex when empty command base", () => {
    const cmd = buildCodexCommand({
      commandBase: "",
      launchMode: "new",
      extraArgs: "",
      baseUrl: "https://example.com",
    });

    expect(cmd).toBe("codex");
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
