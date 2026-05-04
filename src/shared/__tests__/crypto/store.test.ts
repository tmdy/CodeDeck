// 加密配置存取测试 — 翻译自 Go internal/storage/encryptedconfig/store_test.go

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { EncryptedConfigStore } from "../../crypto/store.js";
import { encryptProfiles, decryptProfiles } from "../../crypto/envelope.js";
import type { Profile } from "../../profile/types.js";

describe("EncryptedConfigStore", () => {
  async function createTempDir() {
    const dir = path.join(os.tmpdir(), `cm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  it("should round-trip profiles through encrypted storage", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "profiles.encrypted.json");
    const store = new EncryptedConfigStore(storePath);

    const profiles: Profile[] = [
      { provider: "claude", name: "Official", url: "https://api.anthropic.com", key: "sk-ant-key" },
      { provider: "codex", name: "OpenAI", url: "https://api.openai.com/v1", key: "sk-openai-key" },
    ];

    await store.save(profiles, "test-password");

    // 验证文件存在
    await fs.access(storePath);

    const loaded = await store.load("test-password");
    expect(loaded.length).toBe(2);
    expect(loaded[0].name).toBe("Official");
    expect(loaded[0].provider).toBe("claude");
    expect(loaded[1].name).toBe("OpenAI");
    expect(loaded[1].provider).toBe("codex");

    // 清理
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("should reject wrong password on load", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "profiles.encrypted.json");
    const store = new EncryptedConfigStore(storePath);

    const profiles: Profile[] = [
      { provider: "claude", name: "Test", url: "https://example.com", key: "key123" },
    ];

    await store.save(profiles, "correct-password");

    await expect(store.load("wrong-password")).rejects.toThrow("配置口令不正确");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("should return empty list when file does not exist", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "nonexistent.encrypted.json");
    const store = new EncryptedConfigStore(storePath);

    const loaded = await store.load("");
    expect(loaded).toEqual([]);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("should report encrypted file existence in ESM runtime", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "profiles.encrypted.json");
    const store = new EncryptedConfigStore(storePath);

    await store.save([], "test-password");

    expect(store.exists()).toBe(true);

    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("encryptProfiles / decryptProfiles", () => {
  it("should encrypt and decrypt profiles", () => {
    const profiles: Profile[] = [
      { provider: "claude", name: "Test", url: "https://example.com", key: "secret" },
    ];

    const envelope = encryptProfiles(profiles, "password");
    expect(envelope.version).toBe(1);
    expect(typeof envelope.salt).toBe("string");
    expect(typeof envelope.token).toBe("string");

    const decrypted = decryptProfiles(envelope, "password");
    expect(decrypted.length).toBe(1);
    expect(decrypted[0].name).toBe("Test");
    expect(decrypted[0].url).toBe("https://example.com");
    expect(decrypted[0].key).toBe("secret");
  });

  it("should throw on empty password", () => {
    expect(() => encryptProfiles([], "")).toThrow("配置口令不能为空");
    expect(() => decryptProfiles({ version: 1, salt: "test", token: "test" }, "")).toThrow(
      "配置口令不能为空",
    );
  });
});
