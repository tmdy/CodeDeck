import { execFileSync } from "node:child_process";
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
    terminalMode: "direct",
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

  it("writes Claude alias override environment variables before invoking Claude", () => {
    const spec = buildWindowsExternalTerminalLaunchSpec(createPlan({
      env: {
        ANTHROPIC_BASE_URL: "https://api.aicod.com",
        ANTHROPIC_AUTH_TOKEN: "sk-glm",
        ANTHROPIC_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_OPUS_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_SONNET_MODEL: "glm-5.1",
        ANTHROPIC_DEFAULT_HAIKU_MODEL: "glm-5.1",
        CLAUDE_CODE_SUBAGENT_MODEL: "glm-5.1",
      },
      commandArgs: ["--model", "glm-5.1"],
    }));
    const innerScript = decodeInnerScript(spec);

    expect(innerScript).toContain("$env:ANTHROPIC_DEFAULT_OPUS_MODEL = 'glm-5.1'");
    expect(innerScript).toContain("$env:ANTHROPIC_DEFAULT_SONNET_MODEL = 'glm-5.1'");
    expect(innerScript).toContain("$env:ANTHROPIC_DEFAULT_HAIKU_MODEL = 'glm-5.1'");
    expect(innerScript).toContain("$env:CLAUDE_CODE_SUBAGENT_MODEL = 'glm-5.1'");
    expect(innerScript.indexOf("$env:ANTHROPIC_DEFAULT_HAIKU_MODEL")).toBeLessThan(innerScript.indexOf("& 'claude' @commandArgs"));
    expect(innerScript).not.toContain("Invoke-Expression");
  });

  it("keeps Codex attached to the terminal even when auto-continue is enabled", () => {
    const spec = buildWindowsExternalTerminalLaunchSpec(createPlan({
      provider: "codex",
      commandBase: "codex",
      commandExecutable: "codex",
      command: "codex --profile site-test",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
        CODEX_SITE_API_KEY_TEST: "sk-test",
      },
      requiredEnvKeys: ["CODEX_HOME", "CODEX_SITE_API_KEY_TEST"],
      codexAutoContinue: {
        enabled: true,
        limit: 1,
        prompt: "继续",
        keywords: ["high demand", "temporary errors"],
      },
    }));
    const innerScript = decodeInnerScript(spec);

    expect(innerScript).toContain("$autoContinueLimit = 1");
    expect(innerScript).toContain("$autoContinuePrompt = '继续'");
    expect(innerScript).toContain("high demand");
    expect(innerScript).toContain("temporary errors");
    expect(innerScript).toContain("& 'codex' @commandArgs");
    expect(innerScript).not.toContain("[System.Diagnostics.ProcessStartInfo]::new()");
    expect(innerScript).not.toContain("$process.StandardInput.WriteLine($autoContinuePrompt)");
  });

  it("executes the Codex direct launch path in Windows PowerShell without redirected-stdin failures", () => {
    if (process.platform !== "win32") {
      return;
    }

    const spec = buildWindowsExternalTerminalLaunchSpec(createPlan({
      provider: "codex",
      commandBase: "cmd.exe",
      commandExecutable: "cmd.exe",
      command: "cmd.exe /c exit 0",
      commandArgs: ["/c", "exit", "0"],
      cwd: process.cwd().replace(/\\/g, "/"),
      env: {
        CODEX_HOME: "C:/codex-home",
        CODEX_SITE_API_KEY_TEST: "sk-test",
      },
      requiredEnvKeys: ["CODEX_HOME", "CODEX_SITE_API_KEY_TEST"],
      codexAutoContinue: {
        enabled: true,
        limit: 1,
        prompt: "继续",
        keywords: ["high demand"],
      },
    }));
    const innerScript = decodeInnerScript(spec);
    const encodedInnerScript = Buffer.from(innerScript, "utf16le").toString("base64");

    expect(() => execFileSync("powershell.exe", [
      "-NoProfile",
      "-EncodedCommand",
      encodedInnerScript,
    ], {
      encoding: "utf8",
      stdio: "pipe",
    })).not.toThrow();
  });

  it("resolves a PATH-only .cmd wrapper through the interactive PowerShell invocation path", () => {
    if (process.platform !== "win32") {
      return;
    }

    const tempDir = process.env.TEMP ? `${process.env.TEMP}\\codedeck-codex-wrapper-${Date.now()}` : "C:\\Windows\\Temp\\codedeck-codex-wrapper";
    try {
      execFileSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `New-Item -ItemType Directory -Force -Path '${tempDir.replace(/'/g, "''")}' | Out-Null; Set-Content -LiteralPath '${`${tempDir}\\codex-wrapper.cmd`.replace(/'/g, "''")}' -Value \"@echo off\r\necho wrapper-ok\r\nexit /b 0\r\n\" -Encoding UTF8`,
      ], { stdio: "pipe" });

      const spec = buildWindowsExternalTerminalLaunchSpec(createPlan({
        provider: "codex",
        commandBase: "codex-wrapper",
        commandExecutable: "codex-wrapper",
        command: "codex-wrapper --profile site-test",
        commandArgs: ["--profile", "site-test"],
        cwd: "C:/Windows",
        env: {
          CODEX_HOME: "C:/codex-home",
          CODEX_SITE_API_KEY_TEST: "sk-test",
          PATH: `${tempDir};${process.env.PATH ?? ""}`,
        },
        requiredEnvKeys: ["CODEX_HOME", "CODEX_SITE_API_KEY_TEST"],
        codexAutoContinue: {
          enabled: true,
          limit: 1,
          prompt: "继续",
          keywords: ["wrapper-ok"],
        },
      }));
      const innerScript = decodeInnerScript(spec);
      const encodedInnerScript = Buffer.from(innerScript, "utf16le").toString("base64");

      const output = execFileSync("powershell.exe", [
        "-NoProfile",
        "-EncodedCommand",
        encodedInnerScript,
      ], {
        encoding: "utf8",
        stdio: "pipe",
      });

      expect(output).toContain("wrapper-ok");
    } finally {
      execFileSync("powershell.exe", [
        "-NoProfile",
        "-Command",
        `Remove-Item -LiteralPath '${tempDir.replace(/'/g, "''")}' -Recurse -Force -ErrorAction SilentlyContinue`,
      ], { stdio: "pipe" });
    }
  });

  it("serializes custom Codex auto-continue keywords and unlimited limit", () => {
    const spec = buildWindowsExternalTerminalLaunchSpec(createPlan({
      provider: "codex",
      commandBase: "codex",
      commandExecutable: "codex",
      command: "codex --profile site-test",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
        CODEX_SITE_API_KEY_TEST: "sk-test",
      },
      requiredEnvKeys: ["CODEX_HOME", "CODEX_SITE_API_KEY_TEST"],
      codexAutoContinue: {
        enabled: true,
        limit: -1,
        prompt: "继续",
        keywords: ["排队中", "high demand", "服务繁忙"],
      },
    }));
    const innerScript = decodeInnerScript(spec);

    expect(innerScript).toContain("$autoContinueLimit = -1");
    expect(innerScript).toContain("'排队中'");
    expect(innerScript).toContain("'服务繁忙'");
    expect(innerScript).toContain("& 'codex' @commandArgs");
  });

  it("does not wrap non-Codex launches with auto-continue detection", () => {
    const spec = buildWindowsExternalTerminalLaunchSpec(createPlan({
      provider: "claude",
      codexAutoContinue: {
        enabled: true,
        limit: 1,
        prompt: "继续",
        keywords: ["high demand"],
      },
    }));
    const innerScript = decodeInnerScript(spec);

    expect(innerScript).toContain("& 'claude' @commandArgs");
    expect(innerScript).not.toContain("$autoContinueLimit");
    expect(innerScript).not.toContain("StandardInput.WriteLine($autoContinuePrompt)");
  });
});
