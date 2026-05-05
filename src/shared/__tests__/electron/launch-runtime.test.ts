import { describe, expect, it, vi } from "vitest";
import {
  buildWindowsExternalTerminalLaunchSpec,
  executeLaunchPlan,
} from "../../electron/launch-runtime.js";
import type { LaunchExecutionPlan } from "../../services/launch-service.js";

function decodeInnerScript(spec: { args: string[] }): string {
  const outerCommand = spec.args[4] ?? "";
  const match = outerCommand.match(/-EncodedCommand', '([^']+)'/);
  if (!match) {
    throw new Error("未找到 EncodedCommand");
  }
  return Buffer.from(match[1], "base64").toString("utf16le");
}

function createPlan(overrides: Partial<LaunchExecutionPlan> = {}): LaunchExecutionPlan {
  return {
    valid: true,
    provider: "claude",
    launchMode: "continue_last",
    cwd: "C:/workspace/current-project",
    commandBase: "claude",
    commandExecutable: "claude",
    commandArgs: ["--continue", "--model", "deepseek-v4-pro"],
    command: "claude --continue",
    shell: "powershell",
    env: {
      ANTHROPIC_BASE_URL: "https://api.anthropic.com",
      ANTHROPIC_AUTH_TOKEN: "sk-ant",
    },
    previewEnv: [
      { name: "ANTHROPIC_BASE_URL", present: true, displayValue: "https://api.anthropic.com", sensitive: false },
      { name: "ANTHROPIC_AUTH_TOKEN", present: true, displayValue: "[已设置]", sensitive: true },
    ],
    requiredEnvKeys: ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"],
    ...overrides,
  };
}

describe("launch-runtime", () => {
  it("builds a Windows external terminal launch spec that uses runtime.cwd", () => {
    const spec = buildWindowsExternalTerminalLaunchSpec(createPlan());
    const innerScript = decodeInnerScript(spec);

    expect(spec.filePath).toBe("powershell.exe");
    expect(spec.cwd).toBe("C:/workspace/current-project");
    expect(spec.args.join(" ")).toContain("WorkingDirectory");
    expect(spec.args.join(" ")).toContain("C:/workspace/current-project");
    expect(innerScript).toContain("ConvertFrom-Json");
    expect(innerScript).toContain("Set-Location -LiteralPath");
  });

  it("throws a visible error when cwd is missing", async () => {
    await expect(executeLaunchPlan(createPlan({ cwd: "" }), {
      directoryExists: vi.fn().mockResolvedValue(false),
      commandExists: vi.fn().mockResolvedValue(true),
      spawnExternalTerminal: vi.fn(),
    })).rejects.toThrow("工作目录不存在，请先设置有效的工作目录。");
  });

  it("throws a visible error when the command is not available in PATH", async () => {
    await expect(executeLaunchPlan(createPlan(), {
      directoryExists: vi.fn().mockResolvedValue(true),
      commandExists: vi.fn().mockResolvedValue(false),
      spawnExternalTerminal: vi.fn(),
    })).rejects.toThrow("命令不可执行或不在 PATH 中：claude");
  });

  it("throws a visible error when resume_selected is requested without a session id", async () => {
    await expect(executeLaunchPlan(createPlan({
      launchMode: "resume_selected",
      sessionId: "",
      command: 'claude --resume ""',
    }), {
      directoryExists: vi.fn().mockResolvedValue(true),
      commandExists: vi.fn().mockResolvedValue(true),
      spawnExternalTerminal: vi.fn(),
    })).rejects.toThrow("恢复指定会话时必须提供 sessionId。");
  });

  it("passes runtime.cwd through to the terminal launcher", async () => {
    const spawnExternalTerminal = vi.fn().mockResolvedValue(undefined);

    await executeLaunchPlan(createPlan(), {
      directoryExists: vi.fn().mockResolvedValue(true),
      commandExists: vi.fn().mockResolvedValue(true),
      spawnExternalTerminal,
    });

    expect(spawnExternalTerminal).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "C:/workspace/current-project",
      }),
    );
  });

  it("serializes the inner command as an argv array instead of concatenating a full shell command", () => {
    const spec = buildWindowsExternalTerminalLaunchSpec(createPlan({
      commandBase: "C:/Program Files/Claude/claude.exe",
      commandExecutable: "C:/Program Files/Claude/claude.exe",
      command: 'C:/Program Files/Claude/claude.exe --resume "session-123" --model "deepseek-v4-pro"',
      commandArgs: ["--resume", "session-123", "--model", "deepseek-v4-pro"],
    }));
    const innerScript = decodeInnerScript(spec);

    const joined = spec.args.join(" ");
    expect(joined).toContain("EncodedCommand");
    expect(joined).not.toContain("Invoke-Expression");
    expect(innerScript).toContain("ConvertFrom-Json");
    expect(innerScript).toContain("@commandArgs");
    expect(innerScript).not.toContain('claude.exe --resume "session-123" --model "deepseek-v4-pro"');
  });

  it("writes environment values as PowerShell literals without variable expansion", () => {
    const spec = buildWindowsExternalTerminalLaunchSpec(createPlan({
      env: {
        ANTHROPIC_AUTH_TOKEN: "sk-$literal-'quoted'",
      },
    }));
    const innerScript = decodeInnerScript(spec);

    expect(innerScript).toContain("$env:ANTHROPIC_AUTH_TOKEN = 'sk-$literal-''quoted'''");
    expect(innerScript).not.toContain('$env:ANTHROPIC_AUTH_TOKEN = "sk-$literal-');
  });
});
