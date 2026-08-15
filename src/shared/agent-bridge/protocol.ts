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
      ...(record.orchestrator === true ? { orchestrator: true } : {}),
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
  if (command === "status_parent" || command === "interrupt_parent") {
    return { command, ...(request_id ? { request_id } : {}) };
  }
  if (command === "continue_parent") {
    return {
      command,
      prompt: promptString(record),
      ...(request_id ? { request_id } : {}),
    };
  }
  if (command !== "policy") {
    throw new AgentBridgeRequestError(
      "unauthorized",
      "作用域凭据仅允许管理当前回传策略或控制绑定父会话。",
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

const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/;

function terminalParameter(value: string | undefined, fallback = 1): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function renderTerminalText(value: string): string {
  const lines: string[][] = [[]];
  let row = 0;
  let column = 0;
  let savedRow = 0;
  let savedColumn = 0;

  const ensureLine = (targetRow: number): string[] => {
    while (lines.length <= targetRow) lines.push([]);
    return lines[targetRow];
  };
  const write = (char: string): void => {
    const line = ensureLine(row);
    while (line.length < column) line.push(" ");
    line[column] = char;
    column += 1;
  };
  const eraseLine = (mode: number): void => {
    const line = ensureLine(row);
    if (mode === 2) {
      lines[row] = [];
    } else if (mode === 1) {
      for (let index = 0; index <= column; index += 1) line[index] = " ";
    } else {
      line.length = Math.min(line.length, column);
    }
  };

  for (let index = 0; index < value.length;) {
    const char = value[index];
    if (char === "\x1b") {
      const kind = value[index + 1];
      if (kind === "]") {
        let end = index + 2;
        while (end < value.length && value[end] !== "\x07") {
          if (value[end] === "\x1b" && value[end + 1] === "\\") {
            end += 2;
            break;
          }
          end += 1;
        }
        index = end < value.length && value[end] === "\x07" ? end + 1 : end;
        continue;
      }
      if (kind === "[") {
        let end = index + 2;
        while (end < value.length && !/[@-~]/.test(value[end])) end += 1;
        if (end >= value.length) break;
        const command = value[end];
        const rawParameters = value.slice(index + 2, end).replace(/^\?/, "");
        const parameters = rawParameters.split(";");
        const amount = terminalParameter(parameters[0]);
        if (command === "A") row = Math.max(0, row - amount);
        else if (command === "B") row += amount;
        else if (command === "C") column += amount;
        else if (command === "D") column = Math.max(0, column - amount);
        else if (command === "E") { row += amount; column = 0; }
        else if (command === "F") { row = Math.max(0, row - amount); column = 0; }
        else if (command === "G") column = amount - 1;
        else if (command === "H" || command === "f") {
          row = terminalParameter(parameters[0]) - 1;
          column = terminalParameter(parameters[1]) - 1;
        } else if (command === "d") row = amount - 1;
        else if (command === "J") {
          const mode = Number.parseInt(parameters[0] || "0", 10);
          if (mode === 2) {
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
              lines[lineIndex] = [];
            }
          } else if (mode === 1) {
            for (let lineIndex = 0; lineIndex < row; lineIndex += 1) {
              lines[lineIndex] = [];
            }
            eraseLine(1);
          } else if (mode === 0) {
            eraseLine(0);
            lines.length = row + 1;
          }
        } else if (command === "K") {
          eraseLine(Number.parseInt(parameters[0] || "0", 10));
        } else if (command === "X") {
          const line = ensureLine(row);
          for (let offset = 0; offset < amount; offset += 1) {
            if (column + offset < line.length) line[column + offset] = " ";
          }
        } else if (command === "P") {
          ensureLine(row).splice(column, amount);
        } else if (command === "@") {
          ensureLine(row).splice(column, 0, ...Array<string>(amount).fill(" "));
        } else if (command === "s") {
          savedRow = row;
          savedColumn = column;
        } else if (command === "u") {
          row = savedRow;
          column = savedColumn;
        }
        ensureLine(row);
        index = end + 1;
        continue;
      }
      if (kind === "7") {
        savedRow = row;
        savedColumn = column;
      } else if (kind === "8") {
        row = savedRow;
        column = savedColumn;
      } else if (kind === "c") {
        lines.splice(0, lines.length, []);
        row = 0;
        column = 0;
      }
      index += Math.min(2, value.length - index);
      continue;
    }
    if (char === "\r") {
      column = 0;
    } else if (char === "\n") {
      row += 1;
      column = 0;
      ensureLine(row);
    } else if (char === "\b") {
      column = Math.max(0, column - 1);
    } else if (char === "\t") {
      column += 8 - (column % 8);
    } else if (!CONTROL_CHAR_PATTERN.test(char)) {
      write(char);
    }
    index += 1;
  }

  return lines
    .map((line) => line.join("").replace(/\s+$/, ""))
    .join("\n");
}

export function cleanTerminalText(value: string): string {
  return renderTerminalText(value)
    .trim();
}
