import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runAgentCli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  const entryPoint = path.join(process.cwd(), "electron", "agent-cli.ts");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", entryPoint, ...args],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

describe("codedeck-agent CLI", () => {
  it("rejects recursive delegation before opening the global bridge", async () => {
    const result = await runAgentCli(
      ["run", "--profile", "codex::demo", "--wait-ms", "0"],
      { CODEDECK_DELEGATED: "1" },
    );

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      ok: false,
      error: { code: "recursive_delegation" },
    });
    expect(result.stderr).toBe("");
  });

  it("keeps run overrides, policies, and peer interrupts discoverable in usage output", async () => {
    const result = await runAgentCli(
      ["unsupported-command"],
      { CODEDECK_DELEGATED: "0" },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--model <id>");
    expect(result.stderr).toContain("--reasoning-effort <level>");
    expect(result.stderr).toContain("--return-policy once|continuous|manual");
    expect(result.stderr).toContain("interrupt-parent");
  });
});
