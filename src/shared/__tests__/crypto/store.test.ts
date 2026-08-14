// 加密配置存取测试 — 翻译自 Go internal/storage/encryptedconfig/store_test.go

import { describe, it, expect } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { EncryptedConfigStore } from "../../crypto/store.js";
import {
  decryptProfileConfig,
  decryptProfiles,
  encryptProfileConfig,
  encryptProfiles,
} from "../../crypto/envelope.js";
import type { Profile } from "../../profile/types.js";
import type { SiteBalanceSession } from "../../balance/site-balance-sessions.js";

describe("EncryptedConfigStore", () => {
  async function createTempDir() {
    const dir = path.join(os.tmpdir(), `cm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  it("should round-trip profiles and site balance sessions through encrypted storage", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "profiles.encrypted.json");
    const store = new EncryptedConfigStore(storePath);

    const profiles: Profile[] = [
      {
        provider: "claude",
        name: "Official",
        url: "https://api.anthropic.com",
        key: "sk-ant-key",
        balance_session_id: "sess-a",
      },
      { provider: "codex", name: "OpenAI", url: "https://api.openai.com/v1", key: "sk-openai-key" },
    ];
    const siteSessions: Record<string, SiteBalanceSession[]> = {
      "https://new-api.example.com": [
        {
          id: "sess-a",
          label: "主账号",
          base_url: "https://new-api.example.com",
          access_token: "token-a",
          auth_kind: "access_token",
          auto_checkin_enabled: false,
          user_id: "42",
          updated_at: "2026-05-05T09:30:00.000Z",
        },
      ],
    };

    await store.save({
      profiles,
      site_balance_sessions_by_base_url: siteSessions,
    }, "test-password");

    // 验证文件存在
    await fs.access(storePath);

    const loaded = await store.load("test-password");
    expect(loaded.profiles.length).toBe(2);
    expect(loaded.profiles[0].name).toBe("Official");
    expect(loaded.profiles[0].provider).toBe("claude");
    expect(loaded.profiles[0].balance_session_id).toBe("sess-a");
    expect(loaded.profiles[1].name).toBe("OpenAI");
    expect(loaded.profiles[1].provider).toBe("codex");
    expect(loaded.site_balance_sessions_by_base_url).toEqual({
      "https://new-api.example.com": [
        {
          ...siteSessions["https://new-api.example.com"][0],
          label: "账号1",
        },
      ],
    });

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

    await store.save({
      profiles,
      site_balance_sessions_by_base_url: {},
    }, "correct-password");

    await expect(store.load("wrong-password")).rejects.toThrow("配置口令不正确");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("should re-encrypt the existing config with a new password", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "profiles.encrypted.json");
    const store = new EncryptedConfigStore(storePath);

    await store.save({
      profiles: [
        { provider: "claude", name: "Test", url: "https://example.com", key: "key123" },
      ],
      site_balance_sessions_by_base_url: {},
    }, "old-password");

    await store.changePassphrase("old-password", "new-password");

    await expect(store.load("old-password")).rejects.toThrow("配置口令不正确");
    const loaded = await store.load("new-password");
    expect(loaded.profiles[0].name).toBe("Test");

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("should return empty list when file does not exist", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "nonexistent.encrypted.json");
    const store = new EncryptedConfigStore(storePath);

    const loaded = await store.load("");
    expect(loaded).toEqual({
      profiles: [],
      site_balance_sessions_by_base_url: {},
      browser_identity_slots: [],
      runtime_env_by_profile: {},
      global_proxy: "",
      protected_settings_version: 1,
    });

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("should report encrypted file existence in ESM runtime", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "profiles.encrypted.json");
    const store = new EncryptedConfigStore(storePath);

    await store.save({
      profiles: [],
      site_balance_sessions_by_base_url: {},
    }, "test-password");

    expect(store.exists()).toBe(true);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("should load legacy encrypted profile arrays as an empty site session pool", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "profiles.encrypted.json");
    const profiles: Profile[] = [
      { provider: "claude", name: "Legacy", url: "https://legacy.example.com", key: "sk-legacy" },
    ];

    const legacyEnvelope = await encryptProfiles(profiles, "test-password");
    await fs.writeFile(storePath, JSON.stringify(legacyEnvelope, null, 2), "utf-8");

    const store = new EncryptedConfigStore(storePath);
    const loaded = await store.load("test-password");

    expect(loaded.profiles).toHaveLength(1);
    expect(loaded.profiles[0]).toMatchObject({
      provider: "claude",
      name: "Legacy",
      url: "https://legacy.example.com",
      key: "sk-legacy",
    });
    expect(loaded.site_balance_sessions_by_base_url).toEqual({});

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("should initialize an encrypted empty config immediately", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "profiles.encrypted.json");
    const store = new EncryptedConfigStore(storePath);

    const initialized = await store.initialize("new password", {
      runtime_env_by_profile: {
        "claude::Official": { PRIVATE_TOKEN: "secret" },
      },
      global_proxy: "http://user:pass@127.0.0.1:7890",
    });

    expect(store.exists()).toBe(true);
    expect(initialized.protected_settings_version).toBe(1);
    await expect(store.load("wrong password")).rejects.toThrow("配置口令不正确");
    await expect(store.load("new password")).resolves.toMatchObject({
      runtime_env_by_profile: {
        "claude::Official": { PRIVATE_TOKEN: "secret" },
      },
      global_proxy: "http://user:pass@127.0.0.1:7890",
      protected_settings_version: 1,
    });

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("should migrate validated legacy plaintext only after the encrypted file is committed", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "app-data", "profiles.encrypted.json");
    const legacyPath = path.join(dir, "profiles.json");
    await fs.writeFile(legacyPath, JSON.stringify([
      { provider: "claude", name: "Legacy", url: "https://example.com", key: "secret" },
    ]), "utf8");
    const store = new EncryptedConfigStore(storePath, {
      legacyPlaintextPaths: [legacyPath],
    });

    await expect(store.getStatus()).resolves.toEqual({
      mode: "migrate-plaintext",
      source: "legacy-plaintext",
    });
    const migrated = await store.initialize("migration password");

    expect(migrated.profiles[0].name).toBe("Legacy");
    await expect(fs.access(legacyPath)).rejects.toThrow();
    await expect(store.getStatus()).resolves.toEqual({ mode: "unlock", source: "canonical" });
    await expect(store.load("migration password")).resolves.toMatchObject({
      profiles: [expect.objectContaining({ name: "Legacy", key: "secret" })],
    });

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("should keep initialization successful when legacy cleanup fails after commit", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "app-data", "profiles.encrypted.json");
    const legacyPath = path.join(dir, "profiles.json");
    const blockedCleanupPath = path.join(dir, "blocked-cleanup");
    await fs.writeFile(legacyPath, JSON.stringify([
      { provider: "claude", name: "Legacy", url: "https://example.com", key: "secret" },
    ]), "utf8");
    await fs.mkdir(blockedCleanupPath);
    await fs.writeFile(path.join(blockedCleanupPath, "keep.txt"), "keep", "utf8");
    const cleanupErrors: Array<{ legacyPath: string; error: unknown }> = [];
    const store = new EncryptedConfigStore(storePath, {
      legacyPlaintextPaths: [legacyPath, blockedCleanupPath],
      onLegacyCleanupError: (failedPath, error) => {
        cleanupErrors.push({ legacyPath: failedPath, error });
      },
    });

    await expect(store.initialize("migration password")).resolves.toMatchObject({
      profiles: [expect.objectContaining({ name: "Legacy" })],
    });

    await expect(store.load("migration password")).resolves.toMatchObject({
      profiles: [expect.objectContaining({ name: "Legacy" })],
    });
    expect(cleanupErrors).toEqual([
      { legacyPath: blockedCleanupPath, error: expect.any(Error) },
    ]);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("should reject malformed legacy plaintext without deleting it", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "app-data", "profiles.encrypted.json");
    const legacyPath = path.join(dir, "profiles.json");
    await fs.writeFile(legacyPath, "{not-json", "utf8");
    const store = new EncryptedConfigStore(storePath, {
      legacyPlaintextPaths: [legacyPath],
    });

    await expect(store.initialize("password")).rejects.toThrow("旧明文 Profile 配置不是有效 JSON");
    await expect(fs.access(legacyPath)).resolves.toBeUndefined();
    expect(store.exists()).toBe(false);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("should unlock and migrate a legacy encrypted path without treating it as plaintext", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "app-data", "profiles.encrypted.json");
    const legacyEncryptedPath = path.join(dir, "claude_profiles.encrypted.json");
    const envelope = await encryptProfileConfig({
      profiles: [
        { provider: "codex", name: "Legacy encrypted", url: "https://example.com", key: "secret" },
      ],
      site_balance_sessions_by_base_url: {},
    }, "legacy password");
    await fs.writeFile(legacyEncryptedPath, JSON.stringify(envelope), "utf8");
    const store = new EncryptedConfigStore(storePath, {
      legacyEncryptedPaths: [legacyEncryptedPath],
    });

    await expect(store.getStatus()).resolves.toEqual({
      mode: "unlock",
      source: "legacy-encrypted",
    });
    await expect(store.load("legacy password")).resolves.toMatchObject({
      profiles: [expect.objectContaining({ name: "Legacy encrypted" })],
    });
    await expect(fs.access(legacyEncryptedPath)).rejects.toThrow();
    await expect(store.getStatus()).resolves.toEqual({ mode: "unlock", source: "canonical" });
    const reloadedAfterMigration = await new EncryptedConfigStore(storePath).load("legacy password");
    expect(reloadedAfterMigration.protected_settings_version).toBeUndefined();

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("should report malformed and unsupported canonical envelopes instead of returning empty data", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "profiles.encrypted.json");
    await fs.writeFile(storePath, JSON.stringify({ version: 99, salt: "salt", token: "token" }), "utf8");
    const store = new EncryptedConfigStore(storePath);

    await expect(store.load("password")).rejects.toThrow("版本不受支持");
    expect(store.exists()).toBe(true);

    await fs.rm(dir, { recursive: true, force: true });
  });

  it("should reject invalid envelope encodings before attempting decryption", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "profiles.encrypted.json");
    await fs.writeFile(storePath, JSON.stringify({
      version: 1,
      salt: "%%%",
      token: "not base64url",
    }), "utf8");
    const store = new EncryptedConfigStore(storePath);

    await expect(store.load("password")).rejects.toThrow("不是有效的加密配置");

    await fs.rm(dir, { recursive: true, force: true });
  });
});

describe("encryptProfiles / decryptProfiles", () => {
  it("should encrypt and decrypt profiles", async () => {
    const profiles: Profile[] = [
      { provider: "claude", name: "Test", url: "https://example.com", key: "secret" },
    ];

    const envelope = await encryptProfiles(profiles, "password");
    expect(envelope.version).toBe(1);
    expect(typeof envelope.salt).toBe("string");
    expect(typeof envelope.token).toBe("string");

    const decrypted = await decryptProfiles(envelope, "password");
    expect(decrypted.length).toBe(1);
    expect(decrypted[0].name).toBe("Test");
    expect(decrypted[0].url).toBe("https://example.com");
    expect(decrypted[0].key).toBe("secret");
  });

  it("should throw on empty password", async () => {
    await expect(encryptProfiles([], "")).rejects.toThrow("配置口令不能为空");
    await expect(decryptProfiles({ version: 1, salt: "test", token: "test" }, "")).rejects.toThrow(
      "配置口令不能为空",
    );
  });

  it("should encrypt and decrypt the new config payload format", async () => {
    const envelope = await encryptProfileConfig({
      profiles: [
        { provider: "codex", name: "Relay", url: "https://relay.example.com/v1", key: "sk-relay" },
      ],
      site_balance_sessions_by_base_url: {
        "https://relay.example.com": [
          {
            id: "sess-1",
            label: "后台 A",
            base_url: "https://relay.example.com",
            access_token: "access-1",
            user_id: "1001",
            updated_at: "2026-05-05T10:00:00.000Z",
          },
        ],
      },
    }, "password");

    const decrypted = await decryptProfileConfig(envelope, "password");

    expect(decrypted.profiles[0].name).toBe("Relay");
    expect(decrypted.site_balance_sessions_by_base_url["https://relay.example.com"][0].label).toBe("账号1");
  });
});
