import { promises as fs } from "node:fs";
import net from "node:net";
import {
  AGENT_BRIDGE_PROTOCOL_VERSION,
  DEFAULT_AGENT_WAIT_MS,
  type AgentBridgeConnectionRecord,
  type AgentBridgeRequest,
  type AgentBridgeResponse,
  type AgentScopedRequest,
} from "./types.js";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export async function sendAgentBridgeRequest(
  connectionFile: string,
  request: AgentBridgeRequest,
): Promise<AgentBridgeResponse> {
  let connection: AgentBridgeConnectionRecord;
  try {
    connection = JSON.parse(await fs.readFile(connectionFile, "utf8")) as AgentBridgeConnectionRecord;
  } catch {
    return {
      ok: false,
      error: {
        code: "app_unavailable",
        message: "CodeDeck 未运行或代理连接信息不可用。",
        retryable: true,
      },
    };
  }
  if (
    connection.protocol_version !== AGENT_BRIDGE_PROTOCOL_VERSION
    || !connection.pipe_name
    || !connection.token
  ) {
    return {
      ok: false,
      error: {
        code: "protocol_mismatch",
        message: "CodeDeck 代理协议版本不兼容。",
        retryable: false,
      },
    };
  }

  return new Promise<AgentBridgeResponse>((resolve) => {
    const socket = net.createConnection(connection.pipe_name);
    let buffer = "";
    let settled = false;
    const finish = (response: AgentBridgeResponse): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(response);
    };
    socket.setEncoding("utf8");
    const requestedWaitMs = "wait_ms" in request
      ? request.wait_ms ?? DEFAULT_AGENT_WAIT_MS
      : 0;
    socket.setTimeout(Math.max(15_000, requestedWaitMs + 5_000));
    socket.on("connect", () => {
      socket.write(JSON.stringify({ token: connection.token, request }) + "\n");
    });
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_RESPONSE_BYTES) {
        finish({
          ok: false,
          error: { code: "response_too_large", message: "代理响应超过大小限制。", retryable: false },
        });
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      try {
        finish(JSON.parse(buffer.slice(0, newline)) as AgentBridgeResponse);
      } catch {
        finish({
          ok: false,
          error: { code: "invalid_response", message: "CodeDeck 返回了无效响应。", retryable: true },
        });
      }
    });
    socket.on("timeout", () => {
      finish({
        ok: false,
        error: { code: "app_unavailable", message: "连接 CodeDeck 超时。", retryable: true },
      });
    });
    socket.on("error", () => {
      finish({
        ok: false,
        error: { code: "app_unavailable", message: "无法连接正在运行的 CodeDeck。", retryable: true },
      });
    });
    socket.on("end", () => {
      if (!settled) {
        finish({
          ok: false,
          error: { code: "invalid_response", message: "CodeDeck 未返回完整响应。", retryable: true },
        });
      }
    });
  });
}

export async function sendAgentScopedRequest(
  pipeName: string,
  token: string,
  request: AgentScopedRequest,
): Promise<AgentBridgeResponse> {
  return sendRequest(pipeName, token, request, 0);
}

function sendRequest(
  pipeName: string,
  token: string,
  request: AgentBridgeRequest | AgentScopedRequest,
  requestedWaitMs: number,
): Promise<AgentBridgeResponse> {
  return new Promise<AgentBridgeResponse>((resolve) => {
    const socket = net.createConnection(pipeName);
    let buffer = "";
    let settled = false;
    const finish = (response: AgentBridgeResponse): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(response);
    };
    socket.setEncoding("utf8");
    socket.setTimeout(Math.max(15_000, requestedWaitMs + 5_000));
    socket.on("connect", () => socket.write(JSON.stringify({ token, request }) + "\n"));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_RESPONSE_BYTES) {
        finish({ ok: false, error: { code: "response_too_large", message: "代理响应超过大小限制。", retryable: false } });
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try {
        finish(JSON.parse(buffer.slice(0, newline)) as AgentBridgeResponse);
      } catch {
        finish({ ok: false, error: { code: "invalid_response", message: "CodeDeck 返回了无效响应。", retryable: true } });
      }
    });
    socket.on("timeout", () => finish({ ok: false, error: { code: "app_unavailable", message: "连接 CodeDeck 超时。", retryable: true } }));
    socket.on("error", () => finish({ ok: false, error: { code: "app_unavailable", message: "无法连接正在运行的 CodeDeck。", retryable: true } }));
    socket.on("end", () => {
      if (!settled) finish({ ok: false, error: { code: "invalid_response", message: "CodeDeck 未返回完整响应。", retryable: true } });
    });
  });
}
