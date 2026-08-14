import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sendAgentBridgeRequest,
  sendAgentScopedRequest,
} from "../../agent-bridge/client.js";
import { AgentBridgeServer } from "../../agent-bridge/server.js";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(cleanupPaths.splice(0).map((target) =>
    rm(target, { recursive: true, force: true })
  ));
});

describe("AgentBridgeServer", () => {
  it("authenticates a local client and forwards one JSON request", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codedeck-agent-bridge-"));
    cleanupPaths.push(directory);
    const connectionFile = path.join(directory, "connection.json");
    const server = new AgentBridgeServer({
      connectionFile,
      handleRequest: async (request) => ({
        ok: true,
        profiles: request.command === "profiles"
          ? [{
              profile_key: "codex::demo",
              provider: "codex",
              name: "Demo",
              model: "gpt-test",
              available: true,
            }]
          : [],
        capacity: { running: 0, limit: 4 },
      }),
    });
    await server.start();
    try {
      const response = await sendAgentBridgeRequest(connectionFile, {
        command: "profiles",
        request_id: "request-1",
      });
      expect(response).toMatchObject({
        ok: true,
        request_id: "request-1",
        profiles: [{ profile_key: "codex::demo" }],
      });
    } finally {
      await server.stop();
    }
  });

  it("rejects clients with the wrong connection token", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codedeck-agent-auth-"));
    cleanupPaths.push(directory);
    const connectionFile = path.join(directory, "connection.json");
    const server = new AgentBridgeServer({
      connectionFile,
      handleRequest: async () => ({
        ok: true,
        profiles: [],
        capacity: { running: 0, limit: 4 },
      }),
    });
    const connection = await server.start();
    try {
      await writeFile(connectionFile, JSON.stringify({
        ...connection,
        token: "wrong-token",
      }), "utf8");
      await expect(sendAgentBridgeRequest(connectionFile, {
        command: "profiles",
      })).resolves.toMatchObject({
        ok: false,
        error: { code: "unauthorized" },
      });
    } finally {
      await server.stop();
    }
  });

  it("routes a scoped token only through the scoped request parser", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "codedeck-agent-scoped-"));
    cleanupPaths.push(directory);
    const connectionFile = path.join(directory, "connection.json");
    const handleRequest = vi.fn(async () => ({
      ok: true as const,
      profiles: [],
      capacity: { running: 0, limit: 4 },
    }));
    const handleScopedRequest = vi.fn(async () => ({
      ok: true,
      status: "running" as const,
      session_id: "child-task",
      provider: "codex" as const,
      profile_key: "codex::demo",
      assistant_text: "",
      question: null,
      terminal_tail: "",
      error: null,
      parent_session_id: "parent-terminal",
      return_policy: "continuous" as const,
      delivery_status: "not_requested" as const,
      delivery_error: null,
    }));
    const server = new AgentBridgeServer({
      connectionFile,
      handleRequest,
      handleScopedRequest,
    });
    const connection = await server.start();
    try {
      await expect(sendAgentScopedRequest(
        connection.pipe_name,
        "scoped-secret",
        { command: "policy", return_policy: "continuous", request_id: "scoped-1" },
      )).resolves.toMatchObject({
        ok: true,
        request_id: "scoped-1",
        session_id: "child-task",
        return_policy: "continuous",
      });
      expect(handleRequest).not.toHaveBeenCalled();
      expect(handleScopedRequest).toHaveBeenCalledWith(
        "scoped-secret",
        expect.objectContaining({ command: "policy", return_policy: "continuous" }),
      );
    } finally {
      await server.stop();
    }
  });
});
