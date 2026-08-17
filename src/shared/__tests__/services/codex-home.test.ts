import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ensureProfileHealthCodexHome,
  resolveProfileHealthCodexHome,
} from "../../services/codex-home.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codedeck-health-home-"));
  tempDirs.push(directory);
  return directory;
}

describe("profile health Codex home", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("resolves and creates the dedicated home under a cwd containing spaces", async () => {
    const root = await makeTempDir();
    const cwd = path.join(root, "Profile Workspace With Spaces");
    const expected = path.join(cwd, ".codedeck", "profile-health", "codex-home");
    await mkdir(cwd);

    expect(resolveProfileHealthCodexHome(cwd)).toBe(expected);
    await expect(ensureProfileHealthCodexHome(cwd)).resolves.toBe(expected);
    expect((await stat(expected)).isDirectory()).toBe(true);
  });

  it("preserves native Windows path handling", () => {
    if (process.platform !== "win32") return;

    const cwd = "D:\\Profiles With Spaces\\Current Profile";
    expect(resolveProfileHealthCodexHome(cwd)).toBe(
      "D:\\Profiles With Spaces\\Current Profile\\.codedeck\\profile-health\\codex-home",
    );
  });

  it("reports a clear error when the dedicated directory cannot be created", async () => {
    const root = await makeTempDir();
    const blockedCwd = path.join(root, "not-a-directory");
    await writeFile(blockedCwd, "blocked", "utf8");

    await expect(ensureProfileHealthCodexHome(blockedCwd)).rejects.toThrow(
      /Codex 健康检测工作目录不是目录/,
    );
    await expect(readFile(blockedCwd, "utf8")).resolves.toBe("blocked");
  });

  it("rejects a nonexistent cwd without creating it", async () => {
    const root = await makeTempDir();
    const missingCwd = path.join(root, "missing-workspace");

    await expect(ensureProfileHealthCodexHome(missingCwd)).rejects.toThrow(
      /Codex 健康检测工作目录不存在/,
    );
    await expect(stat(missingCwd)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
