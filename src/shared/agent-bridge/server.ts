import { randomBytes, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import net, { type Server, type Socket } from "node:net";
import path from "node:path";
import {
  AGENT_BRIDGE_PROTOCOL_VERSION,
  type AgentBridgeConnectionRecord,
  type AgentBridgeRequest,
  type AgentBridgeResponse,
  type AgentScopedRequest,
  type AgentTaskResponse,
} from "./types.js";
import {
  parseAgentBridgeRequest,
  parseAgentScopedRequest,
  toAgentBridgeError,
} from "./protocol.js";

export interface AgentBridgeServerOptions {
  connectionFile: string;
  handleRequest: (request: AgentBridgeRequest) => Promise<AgentBridgeResponse>;
  handleScopedRequest?: (
    token: string,
    request: AgentScopedRequest,
  ) => Promise<AgentTaskResponse>;
  pipeName?: string;
  token?: string;
}

interface AuthenticatedRequestEnvelope {
  token?: unknown;
  request?: unknown;
}

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

function createPipeName(): string {
  return process.platform === "win32"
    ? "\\\\.\\pipe\\codedeck-agent-" + randomUUID()
    : path.join(process.cwd(), ".codedeck-agent-" + randomUUID() + ".sock");
}

function requestEnvelope(value: unknown): AuthenticatedRequestEnvelope {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as AuthenticatedRequestEnvelope
    : {};
}

export class AgentBridgeServer {
  private server: Server | null = null;
  private connection: AgentBridgeConnectionRecord | null = null;
  private readonly sockets = new Set<Socket>();

  constructor(private readonly options: AgentBridgeServerOptions) {}

  getConnection(): AgentBridgeConnectionRecord | null {
    return this.connection ? { ...this.connection } : null;
  }

  async start(): Promise<AgentBridgeConnectionRecord> {
    if (this.server && this.connection) {
      return this.connection;
    }
    const pipeName = this.options.pipeName ?? createPipeName();
    const token = this.options.token ?? randomBytes(32).toString("base64url");
    const server = net.createServer((socket) => this.handleSocket(socket, token));
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(pipeName, () => {
        server.off("error", reject);
        resolve();
      });
    });
    this.server = server;
    this.connection = {
      protocol_version: AGENT_BRIDGE_PROTOCOL_VERSION,
      pipe_name: pipeName,
      token,
      pid: process.pid,
      created_at: new Date().toISOString(),
    };
    await fs.mkdir(path.dirname(this.options.connectionFile), { recursive: true });
    await fs.writeFile(
      this.options.connectionFile,
      JSON.stringify(this.connection, null, 2) + "\n",
      { encoding: "utf8", mode: 0o600 },
    );
    return this.connection;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.connection = null;
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();
    if (server) {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    await fs.rm(this.options.connectionFile, { force: true }).catch(() => undefined);
  }

  private handleSocket(socket: Socket, token: string): void {
    this.sockets.add(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    let handled = false;
    let processing = false;
    const respond = (response: AgentBridgeResponse): void => {
      if (handled) {
        return;
      }
      processing = false;
      handled = true;
      socket.end(JSON.stringify(response) + "\n");
    };
    socket.on("data", (chunk: string) => {
      if (handled || processing) {
        return;
      }
      buffer += chunk;
      if (Buffer.byteLength(buffer, "utf8") > MAX_REQUEST_BYTES) {
        respond({
          ok: false,
          error: { code: "invalid_request", message: "请求超过大小限制。", retryable: false },
        });
        return;
      }
      const newline = buffer.indexOf("\n");
      if (newline === -1) {
        return;
      }
      processing = true;
      void this.processLine(buffer.slice(0, newline), token).then(respond);
    });
    socket.on("error", () => undefined);
    socket.on("close", () => this.sockets.delete(socket));
  }

  private async processLine(line: string, token: string): Promise<AgentBridgeResponse> {
    let requestId: string | undefined;
    try {
      const envelope = requestEnvelope(JSON.parse(line));
      if (typeof envelope.token !== "string") {
        return {
          ok: false,
          error: { code: "unauthorized", message: "代理连接令牌无效。", retryable: false },
        };
      }
      if (envelope.token !== token) {
        if (!this.options.handleScopedRequest) {
          return {
            ok: false,
            error: { code: "unauthorized", message: "代理连接令牌无效。", retryable: false },
          };
        }
        const scopedRequest = parseAgentScopedRequest(envelope.request);
        requestId = scopedRequest.request_id;
        return {
          ...await this.options.handleScopedRequest(envelope.token, scopedRequest),
          ...(requestId ? { request_id: requestId } : {}),
        };
      }
      const request = parseAgentBridgeRequest(envelope.request);
      requestId = request.request_id;
      return {
        ...await this.options.handleRequest(request),
        ...(requestId ? { request_id: requestId } : {}),
      };
    } catch (error) {
      return {
        ok: false,
        ...(requestId ? { request_id: requestId } : {}),
        error: toAgentBridgeError(error),
      };
    }
  }
}
