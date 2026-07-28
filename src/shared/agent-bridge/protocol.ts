import {
  AgentBridgeRequestError,
  MAX_AGENT_WAIT_MS,
  type AgentBridgeError,
  type AgentBridgeRequest,
} from "./types.js";

const MAX_PROMPT_CHARS = 1_000_000;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AgentBridgeRequestError("invalid_request", "请求必须是 JSON 对象。");
  }
  return value as Record<string, unknown>;
}

function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new AgentBridgeRequestError("invalid_request", "缺少有效字段：" + key + "。");
  }
  return value.trim();
}

function promptString(record: Record<string, unknown>): string {
  const prompt = requiredString(record, "prompt");
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new AgentBridgeRequestError("invalid_request", "prompt 超过 1,000,000 字符限制。");
  }
  return prompt;
}

function optionalWaitMs(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const waitMs = Math.floor(Number(value));
  if (!Number.isFinite(waitMs) || waitMs < 0) {
    throw new AgentBridgeRequestError("invalid_request", "wait_ms 必须是非负整数。");
  }
  return Math.min(waitMs, MAX_AGENT_WAIT_MS);
}

function optionalRequestId(record: Record<string, unknown>): string | undefined {
  return typeof record.request_id === "string" && record.request_id.trim()
    ? record.request_id.trim().slice(0, 128)
    : undefined;
}

export function parseAgentBridgeRequest(value: unknown): AgentBridgeRequest {
  const record = asRecord(value);
  const command = requiredString(record, "command");
  const request_id = optionalRequestId(record);
  const wait_ms = optionalWaitMs(record.wait_ms);

  if (command === "profiles") {
    return { command, ...(request_id ? { request_id } : {}) };
  }
  if (command === "run") {
    const cwd = typeof record.cwd === "string" && record.cwd.trim()
      ? record.cwd.trim()
      : undefined;
    return {
      command,
      profile_key: requiredString(record, "profile_key"),
      prompt: promptString(record),
      ...(cwd ? { cwd } : {}),
      ...(record.show_terminal === true ? { show_terminal: true } : {}),
      ...(wait_ms !== undefined ? { wait_ms } : {}),
      ...(request_id ? { request_id } : {}),
    };
  }
  if (command === "continue") {
    return {
      command,
      session_id: requiredString(record, "session_id"),
      prompt: promptString(record),
      ...(wait_ms !== undefined ? { wait_ms } : {}),
      ...(request_id ? { request_id } : {}),
    };
  }
  if (command === "status" || command === "cancel") {
    return {
      command,
      session_id: requiredString(record, "session_id"),
      ...(request_id ? { request_id } : {}),
    };
  }
  if (command === "wait") {
    return {
      command,
      session_id: requiredString(record, "session_id"),
      ...(wait_ms !== undefined ? { wait_ms } : {}),
      ...(request_id ? { request_id } : {}),
    };
  }
  throw new AgentBridgeRequestError("invalid_request", "不支持的 command：" + command + "。");
}

export function toAgentBridgeError(error: unknown): AgentBridgeError {
  if (error instanceof AgentBridgeRequestError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    code: "internal_error",
    message: error instanceof Error && error.message.trim() ? error.message : "未知内部错误。",
    retryable: false,
  };
}

const ANSI_SEQUENCE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;

export function cleanTerminalText(value: string): string {
  return value
    .replace(ANSI_SEQUENCE_PATTERN, "")
    .replace(CONTROL_CHAR_PATTERN, "")
    .replace(/\r/g, "")
    .trim();
}
