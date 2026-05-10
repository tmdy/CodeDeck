import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDebugLogWriter, type DebugLogFileSystem } from "../../electron/debug-log.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skills-manager-debug-log-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("createDebugLogWriter", () => {
  it("serializes queued writes in call order", async () => {
    const dir = await createTempDir();
    const writer = createDebugLogWriter({ getDirectory: () => dir });

    writer.write("first");
    writer.write("second");
    await writer.flush();

    const content = await readFile(path.join(dir, "unlock-debug.log"), "utf-8");

    expect(content).toMatch(/first\n\[.*\] second\n$/);
  });

  it("continues accepting writes after a failed append", async () => {
    const dir = await createTempDir();
    const appendFile = vi.fn()
      .mockRejectedValueOnce(new Error("disk unavailable"))
      .mockResolvedValueOnce(undefined);
    const fileSystem: DebugLogFileSystem = {
      mkdir: vi.fn().mockResolvedValue(undefined),
      appendFile,
    };
    const writer = createDebugLogWriter({ fileSystem, getDirectory: () => dir });

    writer.write("lost");
    writer.write("recovered");
    await writer.flush();

    expect(appendFile).toHaveBeenCalledTimes(2);
    expect(appendFile.mock.calls[1]).toEqual([
      path.join(dir, "unlock-debug.log"),
      expect.stringContaining("recovered\n"),
      "utf-8",
    ]);
  });

  it("ignores synchronous preparation failures", async () => {
    const writer = createDebugLogWriter({
      getDirectory: () => {
        throw new Error("path unavailable");
      },
    });

    expect(() => writer.write("ignored")).not.toThrow();
    await expect(writer.flush()).resolves.toBeUndefined();
  });
});
