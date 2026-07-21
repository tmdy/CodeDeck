import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atomicWriteText, recoverAtomicWrite } from "./atomic-file.js";

describe("atomic file writes", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  async function makeTarget(): Promise<string> {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codedeck-atomic-"));
    tempRoots.push(root);
    return path.join(root, "state.json");
  }

  it("replaces an existing file and removes transaction artifacts", async () => {
    const target = await makeTarget();
    await fs.writeFile(target, "old", "utf8");

    await atomicWriteText(target, "new");

    expect(await fs.readFile(target, "utf8")).toBe("new");
    await expect(fs.access(`${target}.bak`)).rejects.toThrow();
    expect((await fs.readdir(path.dirname(target))).filter((name) => name.includes(".tmp-"))).toEqual([]);
  });

  it("restores a backup left after an interrupted replacement", async () => {
    const target = await makeTarget();
    await fs.writeFile(`${target}.bak`, "recoverable", "utf8");

    await recoverAtomicWrite(target);

    expect(await fs.readFile(target, "utf8")).toBe("recoverable");
    await expect(fs.access(`${target}.bak`)).rejects.toThrow();
  });

  it("keeps the committed target when only backup cleanup was interrupted", async () => {
    const target = await makeTarget();
    await fs.writeFile(target, "committed", "utf8");
    await fs.writeFile(`${target}.bak`, "previous", "utf8");

    await recoverAtomicWrite(target);

    expect(await fs.readFile(target, "utf8")).toBe("committed");
    await expect(fs.access(`${target}.bak`)).rejects.toThrow();
  });
});
