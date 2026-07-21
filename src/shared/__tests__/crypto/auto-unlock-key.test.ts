import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AutoUnlockKeyStore,
  type SecretProtector,
} from "../../crypto/auto-unlock-key.js";

function createProtector(available = true): SecretProtector {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (value) => Buffer.from(`os:${[...value].reverse().join("")}`, "utf8"),
    decryptString: (value) => {
      const protectedValue = value.toString("utf8");
      if (!protectedValue.startsWith("os:")) {
        throw new Error("invalid protected value");
      }
      return [...protectedValue.slice(3)].reverse().join("");
    },
  };
}

describe("AutoUnlockKeyStore", () => {
  const tempRoots: string[] = [];

  afterEach(async () => {
    await Promise.all(tempRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
  });

  async function createStore(protector = createProtector()) {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "codedeck-auto-unlock-"));
    tempRoots.push(root);
    const filePath = path.join(root, "auto-unlock-key.json");
    return {
      filePath,
      store: new AutoUnlockKeyStore(filePath, protector),
    };
  }

  it("creates and reloads an opaque random passphrase", async () => {
    const { filePath, store } = await createStore();

    const created = await store.createOrLoad();
    const reloaded = await store.loadRequired();

    expect(created).toHaveLength(43);
    expect(reloaded).toBe(created);
    expect(await store.exists()).toBe(true);
    expect(await fs.readFile(filePath, "utf8")).not.toContain(created);
  });

  it("rejects malformed key files", async () => {
    const { filePath, store } = await createStore();
    await fs.writeFile(filePath, JSON.stringify({ version: 99, protected_key: "value" }), "utf8");

    await expect(store.loadRequired()).rejects.toThrow("免口令密钥文件格式无效");
  });

  it("rejects creation when system encryption is unavailable", async () => {
    const { store } = await createStore(createProtector(false));

    await expect(store.createOrLoad()).rejects.toThrow("当前系统无法安全保存免口令密钥");
  });

  it("removes the stored key", async () => {
    const { store } = await createStore();
    await store.createOrLoad();

    await store.remove();

    await expect(store.load()).resolves.toBeNull();
  });
});
