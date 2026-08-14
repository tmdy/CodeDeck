import {
  AgentBridgeRequestError,
  MAX_AGENT_WAIT_MS,
  type AgentBridgeError,
  type AgentBridgeRequest,
  type AgentReturnPolicy,
  type AgentScopedRequest,
} from "./types.js";

const MAX_PROMPT_CHARS = 1_000_000;
const MAX_MODEL_CHARS = 256;

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

function optionalBoundedString(
  record: Record<string, unknown>,
  key: string,
  maxChars: number,
): string | undefined {
  if (record[key] === undefined) return undefined;
  const value = requiredString(record, key);
  if (value.length > maxChars) {
    throw new AgentBridgeRequestError("invalid_request", `${key} 超过 ${maxChars} 字符限制。`);
  }
  return value;
}

function optionalReturnPolicy(value: unknown): AgentReturnPolicy | undefined {
  if (value === undefined) return undefined;
  if (value === "once" || value === "continuous" || value === "manual") return value;
  throw new AgentBridgeRequestError(
    "invalid_request",
    "return_policy 必须是 once、continuous 或 manual。",
  );
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
    const model = optionalBoundedString(record, "model", MAX_MODEL_CHARS);
    const reasoning_effort = optionalBoundedString(record, "reasoning_effort", 32);
    const parent_session_id = optionalBoundedString(record, "parent_session_id", 128);
    const parent_token = optionalBoundedString(record, "parent_token", 256);
    const return_policy = optionalReturnPolicy(record.return_policy);
    return {
      command,
      profile_key: requiredString(record, "profile_key"),
      prompt: promptString(record),
      ...(cwd ? { cwd } : {}),
      ...(record.show_terminal === true ? { show_terminal: true } : {}),
      ...(model ? { model } : {}),
      ...(reasoning_effort ? { reasoning_effort } : {}),
      ...(parent_session_id ? { parent_session_id } : {}),
      ...(parent_token ? { parent_token } : {}),
      ...(return_policy ? { return_policy } : {}),
      ...(wait_ms !== undefined ? { wait_ms } : {}),
      ...(request_id ? { request_id } : {}),
    };
  }
  if (command === "continue") {
    const return_policy = optionalReturnPolicy(record.return_policy);
    const parent_session_id = optionalBoundedString(record, "parent_session_id", 128);
    const parent_token = optionalBoundedString(record, "parent_token", 256);
    return {
      command,
      session_id: requiredString(record, "session_id"),
      prompt: promptString(record),
      ...(wait_ms !== undefined ? { wait_ms } : {}),
      ...(return_policy ? { return_policy } : {}),
      ...(parent_session_id ? { parent_session_id } : {}),
      ...(parent_token ? { parent_token } : {}),
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
  if (command === "interrupt") {
    const parent_session_id = optionalBoundedString(record, "parent_session_id", 128);
    const parent_token = optionalBoundedString(record, "parent_token", 256);
    return {
      command,
      session_id: requiredString(record, "session_id"),
      ...(parent_session_id ? { parent_session_id } : {}),
      ...(parent_token ? { parent_token } : {}),
      ...(request_id ? { request_id } : {}),
    };
  }
  throw new AgentBridgeRequestError("invalid_request", "不支持的 command：" + command + "。");
}

export function parseAgentScopedRequest(value: unknown): AgentScopedRequest {
  const record = asRecord(value);
  const command = requiredString(record, "command");
  const request_id = optionalRequestId(record);
  if (command === "interrupt_parent") {
    return { command, ...(request_id ? { request_id } : {}) };
  }
  if (command !== "policy") {
    throw new AgentBridgeRequestError(
      "unauthorized",
      "作用域凭据仅允许管理当前回传策略或中断绑定父会话。",
    );
  }
  const return_policy = optionalReturnPolicy(record.return_policy);
  return {
    command,
    ...(return_policy ? { return_policy } : {}),
    ...(request_id ? { request_id } : {}),
  };
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
