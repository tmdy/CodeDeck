export const AGENT_BRIDGE_CONNECTION_FILE = "agent-bridge.json";
export const AGENT_BRIDGE_PROTOCOL_VERSION = 1;
export const DEFAULT_AGENT_WAIT_MS = 10 * 60 * 1000;
export const MAX_AGENT_WAIT_MS = 60 * 60 * 1000;

export type AgentTaskStatus =
  | "starting"
  | "running"
  | "awaiting_input"
  | "completed"
  | "failed"
  | "cancelled";

export type AgentReturnPolicy = "once" | "continuous" | "manual";
export type AgentDeliveryStatus = "not_requested" | "pending" | "delivered" | "failed";

export interface AgentProfileSummary {
  profile_key: string;
  provider: "claude" | "codex";
  name: string;
  model: string;
  available: boolean;
}

export type AgentBridgeRequest =
  | { request_id?: string; command: "profiles" }
  | {
      request_id?: string;
      command: "run";
      profile_key: string;
      prompt: string;
      cwd?: string;
      wait_ms?: number;
      show_terminal?: boolean;
      model?: string;
      reasoning_effort?: string;
      parent_session_id?: string;
      parent_token?: string;
      return_policy?: AgentReturnPolicy;
    }
  | {
      request_id?: string;
      command: "continue";
      session_id: string;
      prompt: string;
      wait_ms?: number;
      return_policy?: AgentReturnPolicy;
      parent_session_id?: string;
      parent_token?: string;
    }
  | { request_id?: string; command: "status"; session_id: string }
  | { request_id?: string; command: "wait"; session_id: string; wait_ms?: number }
  | {
      request_id?: string;
      command: "interrupt";
      session_id: string;
      parent_session_id?: string;
      parent_token?: string;
    }
  | { request_id?: string; command: "cancel"; session_id: string };

export interface AgentBridgeError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface AgentTaskResponse {
  ok: boolean;
  status: AgentTaskStatus;
  session_id: string;
  provider: "claude" | "codex";
  profile_key: string;
  assistant_text: string;
  question: string | null;
  terminal_tail: string;
  error: AgentBridgeError | null;
  parent_session_id: string | null;
  return_policy: AgentReturnPolicy;
  delivery_status: AgentDeliveryStatus;
  delivery_error: string | null;
}

export type AgentScopedRequest =
  | {
      request_id?: string;
      command: "policy";
      return_policy?: AgentReturnPolicy;
    }
  | { request_id?: string; command: "interrupt_parent" };

export type AgentBridgeResponse =
  | {
      ok: true;
      request_id?: string;
      profiles: AgentProfileSummary[];
      capacity: { running: number; limit: number };
    }
  | (AgentTaskResponse & { request_id?: string })
  | { ok: false; request_id?: string; error: AgentBridgeError };

export interface AgentBridgeConnectionRecord {
  protocol_version: number;
  pipe_name: string;
  token: string;
  pid: number;
  created_at: string;
}

export class AgentBridgeRequestError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "AgentBridgeRequestError";
  }
}
