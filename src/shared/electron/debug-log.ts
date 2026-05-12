import { promises as fs } from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogRecord {
  time: string;
  level: LogLevel;
  scope: string;
  event: string;
  message: string;
  duration_ms?: number;
  context?: unknown;
  error?: {
    name?: string;
    message: string;
    stack?: string;
  };
}

export interface LogOptions {
  durationMs?: number;
  context?: unknown;
  error?: unknown;
}

export interface AppLogger {
  debug: (scope: string, event: string, message: string, options?: LogOptions) => void;
  info: (scope: string, event: string, message: string, options?: LogOptions) => void;
  warn: (scope: string, event: string, message: string, options?: LogOptions) => void;
  error: (scope: string, event: string, message: string, options?: LogOptions) => void;
  flush: () => Promise<void>;
}

export interface AppLoggerFileSystem {
  mkdir: (targetPath: string, options: { recursive: true }) => Promise<unknown>;
  stat: (targetPath: string) => Promise<{ size: number }>;
  rename: (oldPath: string, newPath: string) => Promise<unknown>;
  rm: (targetPath: string, options: { force: true }) => Promise<unknown>;
  appendFile: (targetPath: string, data: string, encoding: BufferEncoding) => Promise<unknown>;
}

export interface AppLoggerOptions {
  getDirectory: () => string;
  fileName?: string;
  maxFileBytes?: number;
  maxFiles?: number;
  fileSystem?: AppLoggerFileSystem;
  now?: () => Date;
}

export type IpcHandler = (event: any, ...args: any[]) => unknown;
export type IpcHandleRegistrar = (channel: string, handler: IpcHandler) => void;

export interface IpcHandlerLoggerOptions {
  level?: LogLevel;
  includeArgs?: boolean;
  nowMs?: () => number;
}

const DEFAULT_LOG_FILE = "skills-manager.log";
const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const REDACTED = "[REDACTED]";
const SENSITIVE_FIELD_PATTERN = /(?:api[-_]?key|authorization|cookie|passphrase|password|secret|token|key)$/i;
const BEARER_TOKEN_PATTERN = /\bBearer\s+[\w.+/=-]{8,}/gi;
const SK_TOKEN_PATTERN = /\bsk-[\w-]{8,}/gi;
const LONG_TOKEN_PATTERN = /\b[A-Za-z0-9_./+=-]{32,}\b/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function maskToken(value: string): string {
  if (value.length <= 10) {
    return REDACTED;
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function sanitizeString(value: string): string {
  return value
    .replace(BEARER_TOKEN_PATTERN, "Bearer [REDACTED]")
    .replace(SK_TOKEN_PATTERN, (match) => maskToken(match))
    .replace(LONG_TOKEN_PATTERN, (match) => maskToken(match));
}

export function sanitizeLogContext(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    return sanitizeString(value);
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (seen.has(value)) {
    return "[Circular]";
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeLogContext(item, seen));
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (!isRecord(value)) {
    return String(value);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_FIELD_PATTERN.test(key) ? REDACTED : sanitizeLogContext(item, seen),
    ]),
  );
}

function serializeError(error: unknown): LogRecord["error"] {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeString(error.message),
      stack: error.stack ? sanitizeString(error.stack) : undefined,
    };
  }
  return {
    message: sanitizeString(String(error)),
  };
}

function createRecord(
  level: LogLevel,
  scope: string,
  event: string,
  message: string,
  options: LogOptions | undefined,
  now: () => Date,
): LogRecord {
  const record: LogRecord = {
    time: now().toISOString(),
    level,
    scope,
    event,
    message: sanitizeString(message),
  };
  if (typeof options?.durationMs === "number") {
    record.duration_ms = options.durationMs;
  }
  if ("context" in (options ?? {})) {
    record.context = sanitizeLogContext(options?.context);
  }
  if ("error" in (options ?? {})) {
    record.error = serializeError(options?.error);
  }
  return record;
}

async function rotateIfNeeded(
  fileSystem: AppLoggerFileSystem,
  filePath: string,
  incomingBytes: number,
  maxFileBytes: number,
  maxFiles: number,
): Promise<void> {
  let currentSize = 0;
  try {
    currentSize = (await fileSystem.stat(filePath)).size;
  } catch {
    return;
  }

  if (currentSize + incomingBytes <= maxFileBytes) {
    return;
  }

  if (maxFiles <= 0) {
    await fileSystem.rm(filePath, { force: true });
    return;
  }

  await fileSystem.rm(`${filePath}.${maxFiles}`, { force: true });
  for (let index = maxFiles - 1; index >= 1; index -= 1) {
    try {
      await fileSystem.rename(`${filePath}.${index}`, `${filePath}.${index + 1}`);
    } catch {
      // Missing rotated files are expected.
    }
  }
  await fileSystem.rename(filePath, `${filePath}.1`);
}

export function createAppLogger({
  getDirectory,
  fileName = DEFAULT_LOG_FILE,
  maxFileBytes = DEFAULT_MAX_FILE_BYTES,
  maxFiles = DEFAULT_MAX_FILES,
  fileSystem = fs,
  now = () => new Date(),
}: AppLoggerOptions): AppLogger {
  let writeChain = Promise.resolve();

  function write(level: LogLevel, scope: string, event: string, message: string, options?: LogOptions): void {
    let dir: string;
    let filePath: string;
    let line: string;

    try {
      dir = getDirectory();
      filePath = path.join(dir, fileName);
      line = `${JSON.stringify(createRecord(level, scope, event, message, options, now))}\n`;
    } catch {
      return;
    }

    writeChain = writeChain
      .then(async () => {
        await fileSystem.mkdir(dir, { recursive: true });
        await rotateIfNeeded(
          fileSystem,
          filePath,
          Buffer.byteLength(line, "utf8"),
          maxFileBytes,
          maxFiles,
        );
        await fileSystem.appendFile(filePath, line, "utf-8");
      })
      .catch(() => {
        // Logging must never affect app behavior, and the chain must remain usable.
      });
  }

  return {
    debug: (scope, event, message, options) => write("debug", scope, event, message, options),
    info: (scope, event, message, options) => write("info", scope, event, message, options),
    warn: (scope, event, message, options) => write("warn", scope, event, message, options),
    error: (scope, event, message, options) => write("error", scope, event, message, options),
    async flush(): Promise<void> {
      await writeChain;
    },
  };
}

export function createIpcHandlerLogger(
  logger: AppLogger,
  register: IpcHandleRegistrar,
  defaults: IpcHandlerLoggerOptions = {},
): (channel: string, handler: IpcHandler, options?: IpcHandlerLoggerOptions) => void {
  return (channel, handler, options = {}) => {
    register(channel, async (event, ...args) => {
      const level = options.level ?? defaults.level ?? "info";
      const includeArgs = options.includeArgs ?? defaults.includeArgs ?? true;
      const nowMs = options.nowMs ?? defaults.nowMs ?? (() => Date.now());
      const startedAt = nowMs();
      logger[level]("ipc", "ipc_start", `${channel} started`, {
        context: includeArgs
          ? {
              channel,
              args: sanitizeLogContext(args),
            }
          : { channel },
      });

      try {
        const result = await handler(event, ...args);
        logger[level]("ipc", "ipc_success", `${channel} succeeded`, {
          durationMs: nowMs() - startedAt,
          context: { channel },
        });
        return result;
      } catch (error) {
        logger.error("ipc", "ipc_error", `${channel} failed`, {
          durationMs: nowMs() - startedAt,
          context: { channel },
          error,
        });
        throw error;
      }
    });
  };
}
