import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppLogger,
  createIpcHandlerLogger,
  sanitizeLogContext,
  type AppLoggerFileSystem,
  type LogRecord,
} from "../../electron/debug-log.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skills-manager-app-log-"));
  tempDirs.push(dir);
  return dir;
}

async function readJsonLines(filePath: string): Promise<LogRecord[]> {
  const content = await readFile(filePath, "utf-8");
  return content.trim().split("\n").map((line) => JSON.parse(line) as LogRecord);
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createAppLogger", () => {
  it("writes structured json lines in call order", async () => {
    const dir = await createTempDir();
    const logger = createAppLogger({
      getDirectory: () => dir,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    });

    logger.info("app", "startup", "starting");
    logger.warn("app", "startup_slow", "slow startup", {
      durationMs: 25,
      context: { phase: "ready" },
    });
    await logger.flush();

    const records = await readJsonLines(path.join(dir, "skills-manager.log"));

    expect(records).toEqual([
      {
        time: "2026-05-10T12:00:00.000Z",
        level: "info",
        scope: "app",
        event: "startup",
        message: "starting",
      },
      {
        time: "2026-05-10T12:00:00.000Z",
        level: "warn",
        scope: "app",
        event: "startup_slow",
        message: "slow startup",
        duration_ms: 25,
        context: { phase: "ready" },
      },
    ]);
  });

  it("sanitizes sensitive field names and token-like values", async () => {
    const sanitized = sanitizeLogContext({
      apiKey: "sk-1234567890abcdef",
      authorization: "Bearer very-long-secret-token-value",
      nested: {
        cookie: "session=abcdef",
        ordinary: "sk-1234567890abcdef",
      },
    });

    expect(JSON.stringify(sanitized)).not.toContain("1234567890abcdef");
    expect(JSON.stringify(sanitized)).not.toContain("very-long-secret-token-value");
    expect(sanitized).toEqual({
      apiKey: "[REDACTED]",
      authorization: "[REDACTED]",
      nested: {
        cookie: "[REDACTED]",
        ordinary: "sk-1...cdef",
      },
    });
  });

  it("rotates log files when the active log exceeds the size limit", async () => {
    const dir = await createTempDir();
    await writeFile(path.join(dir, "skills-manager.log"), "active-old-content", "utf-8");
    await writeFile(path.join(dir, "skills-manager.log.1"), "rotated-one", "utf-8");
    const logger = createAppLogger({
      getDirectory: () => dir,
      maxFileBytes: 8,
      maxFiles: 2,
      now: () => new Date("2026-05-10T12:00:00.000Z"),
    });

    logger.info("app", "after_rotation", "new active");
    await logger.flush();

    await expect(readFile(path.join(dir, "skills-manager.log.2"), "utf-8")).resolves.toBe("rotated-one");
    await expect(readFile(path.join(dir, "skills-manager.log.1"), "utf-8")).resolves.toBe("active-old-content");
    const activeRecords = await readJsonLines(path.join(dir, "skills-manager.log"));
    expect(activeRecords[0]).toMatchObject({
      level: "info",
      scope: "app",
      event: "after_rotation",
      message: "new active",
    });
  });

  it("continues accepting writes after file-system failures", async () => {
    const dir = await createTempDir();
    const appendFile = vi.fn()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockResolvedValueOnce(undefined);
    const fileSystem: AppLoggerFileSystem = {
      mkdir: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockRejectedValue(new Error("missing")),
      rename: vi.fn().mockResolvedValue(undefined),
      rm: vi.fn().mockResolvedValue(undefined),
      appendFile,
    };
    const logger = createAppLogger({ fileSystem, getDirectory: () => dir });

    logger.error("app", "lost", "lost write");
    logger.info("app", "recovered", "recovered write");
    await expect(logger.flush()).resolves.toBeUndefined();

    expect(appendFile).toHaveBeenCalledTimes(2);
    expect(appendFile.mock.calls[1]).toEqual([
      path.join(dir, "skills-manager.log"),
      expect.stringContaining("\"event\":\"recovered\""),
      "utf-8",
    ]);
  });

  it("ignores synchronous preparation failures", async () => {
    const logger = createAppLogger({
      getDirectory: () => {
        throw new Error("path unavailable");
      },
    });

    expect(() => logger.info("app", "ignored", "ignored")).not.toThrow();
    await expect(logger.flush()).resolves.toBeUndefined();
  });
});

describe("createIpcHandlerLogger", () => {
  it("logs ipc start and success with duration", async () => {
    const info = vi.fn();
    const logger = {
      debug: vi.fn(),
      info,
      warn: vi.fn(),
      error: vi.fn(),
      flush: vi.fn(),
    };
    const register = vi.fn();
    const handleIpc = createIpcHandlerLogger(logger, register, {
      nowMs: vi.fn().mockReturnValueOnce(100).mockReturnValueOnce(135),
    });

    handleIpc("profile:list", async () => ({ ok: true }));
    const wrapped = register.mock.calls[0][1] as (event: unknown, ...args: unknown[]) => Promise<unknown>;

    await expect(wrapped({}, { passphrase: "secret" })).resolves.toEqual({ ok: true });

    expect(info).toHaveBeenNthCalledWith(
      1,
      "ipc",
      "ipc_start",
      "profile:list started",
      expect.objectContaining({
        context: {
          channel: "profile:list",
          args: [{ passphrase: "[REDACTED]" }],
        },
      }),
    );
    expect(info).toHaveBeenNthCalledWith(
      2,
      "ipc",
      "ipc_success",
      "profile:list succeeded",
      expect.objectContaining({
        durationMs: 35,
        context: { channel: "profile:list" },
      }),
    );
  });

  it("logs ipc errors and rethrows the original error", async () => {
    const errorLog = vi.fn();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: errorLog,
      flush: vi.fn(),
    };
    const register = vi.fn();
    const handleIpc = createIpcHandlerLogger(logger, register, {
      nowMs: vi.fn().mockReturnValueOnce(10).mockReturnValueOnce(25),
    });
    const failure = new Error("boom");

    handleIpc("launcher:launch", async () => {
      throw failure;
    });
    const wrapped = register.mock.calls[0][1] as (event: unknown, ...args: unknown[]) => Promise<unknown>;

    await expect(wrapped({}, { key: "sk-secret-value" })).rejects.toBe(failure);
    expect(errorLog).toHaveBeenCalledWith(
      "ipc",
      "ipc_error",
      "launcher:launch failed",
      expect.objectContaining({
        durationMs: 15,
        context: { channel: "launcher:launch" },
        error: failure,
      }),
    );
  });

  it("uses debug level for configured low-value channels", async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      flush: vi.fn(),
    };
    const register = vi.fn();
    const handleIpc = createIpcHandlerLogger(logger, register);

    handleIpc("balance:get-state", () => ({ running: false }), { level: "debug" });
    const wrapped = register.mock.calls[0][1] as (event: unknown, ...args: unknown[]) => Promise<unknown>;
    await wrapped({});

    expect(logger.debug).toHaveBeenCalledWith(
      "ipc",
      "ipc_start",
      "balance:get-state started",
      expect.any(Object),
    );
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("can omit ipc arguments for channels carrying raw secrets", async () => {
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      flush: vi.fn(),
    };
    const register = vi.fn();
    const handleIpc = createIpcHandlerLogger(logger, register);

    handleIpc("profile:unlock", () => ({ success: true }), { includeArgs: false });
    const wrapped = register.mock.calls[0][1] as (event: unknown, ...args: unknown[]) => Promise<unknown>;
    await wrapped({}, "raw-passphrase");

    expect(logger.info).toHaveBeenNthCalledWith(
      1,
      "ipc",
      "ipc_start",
      "profile:unlock started",
      expect.objectContaining({
        context: { channel: "profile:unlock" },
      }),
    );
    expect(JSON.stringify(logger.info.mock.calls)).not.toContain("raw-passphrase");
  });
});
