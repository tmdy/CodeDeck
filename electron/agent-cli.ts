import { promises as fs } from "node:fs";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { sendAgentBridgeRequest } from "../src/shared/agent-bridge/client.js";
import type { AgentBridgeRequest, AgentBridgeResponse } from "../src/shared/agent-bridge/types.js";

interface ParsedArguments {
  command: string;
  options: Map<string, string | true>;
}

function parseArguments(args: string[]): ParsedArguments {
  const command = args[0] ?? "";
  const options = new Map<string, string | true>();
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) {
      throw new Error("无法识别参数：" + argument);
    }
    const key = argument.slice(2);
    if (key === "show-terminal") {
      options.set(key, true);
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error("参数缺少值：--" + key);
    }
    options.set(key, value);
    index += 1;
  }
  return { command, options };
}

function requiredOption(options: Map<string, string | true>, key: string): string {
  const value = options.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("缺少参数：--" + key);
  }
  return value.trim();
}

function waitMs(options: Map<string, string | true>): number | undefined {
  const value = options.get("wait-ms");
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error("--wait-ms 必须是非负数字。");
  }
  return Math.floor(parsed);
}

async function readPrompt(): Promise<string> {
  let content = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    content += chunk;
  }
  if (!content.trim()) {
    throw new Error("run/continue 必须通过 stdin 提供 prompt。");
  }
  return content.trim();
}

async function buildRequest(parsed: ParsedArguments): Promise<AgentBridgeRequest> {
  const request_id = randomUUID();
  if (parsed.command === "profiles") {
    return { command: "profiles", request_id };
  }
  if (parsed.command === "run") {
    const cwd = parsed.options.get("cwd");
    const requestedWaitMs = waitMs(parsed.options);
    return {
      command: "run",
      request_id,
      profile_key: requiredOption(parsed.options, "profile"),
      prompt: await readPrompt(),
      ...(typeof cwd === "string" && cwd.trim() ? { cwd: cwd.trim() } : {}),
      ...(requestedWaitMs !== undefined ? { wait_ms: requestedWaitMs } : {}),
      ...(parsed.options.get("show-terminal") === true ? { show_terminal: true } : {}),
    };
  }
  if (parsed.command === "continue") {
    const requestedWaitMs = waitMs(parsed.options);
    return {
      command: "continue",
      request_id,
      session_id: requiredOption(parsed.options, "session"),
      prompt: await readPrompt(),
      ...(requestedWaitMs !== undefined ? { wait_ms: requestedWaitMs } : {}),
    };
  }
  if (parsed.command === "status" || parsed.command === "cancel") {
    return {
      command: parsed.command,
      request_id,
      session_id: requiredOption(parsed.options, "session"),
    };
  }
  if (parsed.command === "wait") {
    const requestedWaitMs = waitMs(parsed.options);
    return {
      command: "wait",
      request_id,
      session_id: requiredOption(parsed.options, "session"),
      ...(requestedWaitMs !== undefined ? { wait_ms: requestedWaitMs } : {}),
    };
  }
  throw new Error(
    "用法：codedeck-agent profiles | run --profile <key> [--cwd <path>] [--wait-ms <ms>] "
    + "[--show-terminal] | continue/status/wait/cancel --session <id>",
  );
}

async function resolveConnectionFile(): Promise<string> {
  const explicit = process.env.CODEDECK_AGENT_CONNECTION_FILE?.trim();
  if (explicit) {
    return explicit;
  }
  const appData = process.env.APPDATA?.trim();
  const candidates = [
    ...(appData
      ? [
          path.join(appData, "CodeDeck", "agent-bridge.json"),
          path.join(appData, "codedeck", "agent-bridge.json"),
        ]
      : []),
    path.join(os.homedir(), ".codedeck", "agent-bridge.json"),
  ];
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next standard user-data directory.
    }
  }
  return candidates[0];
}

function writeResponse(response: AgentBridgeResponse): void {
  process.stdout.write(JSON.stringify(response, null, 2) + "\n");
  process.exitCode = response.ok ? 0 : 2;
}

async function main(): Promise<void> {
  try {
    if (process.env.CODEDECK_DELEGATED === "1") {
      writeResponse({
        ok: false,
        error: {
          code: "recursive_delegation",
          message: "受委托的 Codex/Claude Code 进程不能再次调用 CodeDeck 代理。",
          retryable: false,
        },
      });
      return;
    }
    const request = await buildRequest(parseArguments(process.argv.slice(2)));
    writeResponse(await sendAgentBridgeRequest(await resolveConnectionFile(), request));
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  }
}

await main();
