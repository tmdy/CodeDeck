import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AgentBridgeServer } from "../../agent-bridge/server.js";
import type {
  AgentBridgeRequest,
  AgentScopedRequest,
} from "../../agent-bridge/types.js";

interface CliResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, { recursive: true, force: true })
  ));
});

function runAgentCli(
  args: string[],
  env: Record<string, string> = {},
  prompt = "",
): Promise<CliResult> {
  const entryPoint = path.join(process.cwd(), "electron", "agent-cli.ts");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", entryPoint, ...args],
      {
        cwd: process.cwd(),
        env: { ...process.env, ...env },
        stdio: ["pipe", "pipe", "pipe"],
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
    child.stdin.end(prompt);
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

describe("codedeck-agent CLI", () => {
  it("writes only the requested token to stdout", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codedeck-agent-token-"));
    cleanupPaths.push(directory);
    const connectionFile = path.join(directory, "connection.json");
    const token = "secret-token-value";
    const server = new AgentBridgeServer({
      connectionFile,
      handleRequest: async (request) => request.command === "auth_token"
        ? { ok: true, token }
        : { ok: false, error: { code: "invalid_request", message: "wrong command", retryable: false } },
    });
    await server.start();
    try {
      const result = await runAgentCli([
        "auth-token",
        "--provider",
        "site_provider_0123456789abcdef",
      ], {
        CODEDECK_AGENT_CONNECTION_FILE: connectionFile,
        CODEDECK_DELEGATED: "1",
      });

      expect(result).toEqual({ exitCode: 0, stdout: `${token}\n`, stderr: "" });
    } finally {
      await server.stop();
    }
  });

  it("keeps stdout empty when the app is unavailable", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codedeck-agent-token-error-"));
    cleanupPaths.push(directory);
    const result = await runAgentCli([
      "auth-token",
      "--provider",
      "site_provider_0123456789abcdef",
    ], {
      CODEDECK_AGENT_CONNECTION_FILE: path.join(directory, "missing.json"),
      CODEDECK_DELEGATED: "0",
    });

    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("app_unavailable");
    expect(result.stderr).not.toContain("secret-token-value");
  });

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
    expect(result.stderr).toContain("--orchestrator");
    expect(result.stderr).toContain("status-parent");
    expect(result.stderr).toContain("continue-parent");
    expect(result.stderr).toContain("interrupt-parent");
  });

  it("forwards the orchestrator flag and one-run overrides in a run request", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codedeck-agent-cli-"));
    cleanupPaths.push(directory);
    const connectionFile = path.join(directory, "connection.json");
    let received: AgentBridgeRequest | undefined;
    const server = new AgentBridgeServer({
      connectionFile,
      handleRequest: async (request) => {
        received = request;
        return {
          ok: true,
          status: "running",
          session_id: "orchestrator-task",
          provider: "codex",
          profile_key: "codex::demo",
          assistant_text: "",
          question: null,
          terminal_tail: "",
          error: null,
          parent_session_id: null,
          return_policy: "manual",
          delivery_status: "not_requested",
          delivery_error: null,
        };
      },
    });
    await server.start();
    try {
      const result = await runAgentCli([
        "run",
        "--profile",
        "codex::demo",
        "--orchestrator",
        "--model",
        "gpt-5.6-terra",
        "--reasoning-effort",
        "low",
        "--wait-ms",
        "0",
      ], {
        CODEDECK_AGENT_CONNECTION_FILE: connectionFile,
        CODEDECK_DELEGATED: "0",
      }, "coordinate the debate");

      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        ok: true,
        session_id: "orchestrator-task",
      });
      expect(received).toMatchObject({
        command: "run",
        profile_key: "codex::demo",
        prompt: "coordinate the debate",
        orchestrator: true,
        model: "gpt-5.6-terra",
        reasoning_effort: "low",
        wait_ms: 0,
      });
    } finally {
      await server.stop();
    }
  });

  it("routes parent status and continuation through the scoped binding without a session option", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codedeck-agent-parent-cli-"));
    cleanupPaths.push(directory);
    const connectionFile = path.join(directory, "connection.json");
    const received: AgentScopedRequest[] = [];
    const server = new AgentBridgeServer({
      connectionFile,
      handleRequest: async () => ({
        ok: true,
        profiles: [],
        capacity: { running: 0, limit: 4 },
      }),
      handleScopedRequest: async (_token, request) => {
        received.push(request);
        return {
          ok: true,
          status: request.command === "continue_parent" ? "running" : "completed",
          session_id: "bound-parent-task",
          provider: "codex",
          profile_key: "codex::demo",
          assistant_text: "",
          question: null,
          terminal_tail: "parent tail",
          error: null,
          parent_session_id: null,
          return_policy: "manual",
          delivery_status: "not_requested",
          delivery_error: null,
        };
      },
    });
    const connection = await server.start();
    const env = {
      CODEDECK_DELEGATED: "1",
      CODEDECK_AGENT_SCOPED_PIPE: connection.pipe_name,
      CODEDECK_AGENT_SCOPED_TOKEN: "child-scoped-token",
    };
    try {
      const statusResult = await runAgentCli(["status-parent"], env);
      const continueResult = await runAgentCli(
        ["continue-parent"],
        env,
        "B actively starts A's next turn",
      );

      expect(statusResult.exitCode).toBe(0);
      expect(JSON.parse(statusResult.stdout)).toMatchObject({
        session_id: "bound-parent-task",
        status: "completed",
        terminal_tail: "parent tail",
      });
      expect(continueResult.exitCode).toBe(0);
      expect(JSON.parse(continueResult.stdout)).toMatchObject({
        session_id: "bound-parent-task",
        status: "running",
      });
      expect(received).toEqual([
        expect.objectContaining({ command: "status_parent" }),
        expect.objectContaining({
          command: "continue_parent",
          prompt: "B actively starts A's next turn",
        }),
      ]);

      const rejected = await runAgentCli(
        ["continue-parent", "--session", "arbitrary-parent"],
        env,
        "must not route",
      );
      expect(rejected.exitCode).toBe(1);
      expect(rejected.stderr).toContain("不接受参数");
      expect(received).toHaveLength(2);
    } finally {
      await server.stop();
    }
  });
});
