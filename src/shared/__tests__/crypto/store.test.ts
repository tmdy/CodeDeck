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
    expect(loaded.site_balance_sessions_by_base_url).toEqual(siteSessions);

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

  it("should return empty list when file does not exist", async () => {
    const dir = await createTempDir();
    const storePath = path.join(dir, "nonexistent.encrypted.json");
    const store = new EncryptedConfigStore(storePath);

    const loaded = await store.load("");
    expect(loaded).toEqual({
      profiles: [],
      site_balance_sessions_by_base_url: {},
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

    const legacyEnvelope = encryptProfiles(profiles, "test-password");
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

  it("should encrypt and decrypt the new config payload format", () => {
    const envelope = encryptProfileConfig({
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

    const decrypted = decryptProfileConfig(envelope, "password");

    expect(decrypted.profiles[0].name).toBe("Relay");
    expect(decrypted.site_balance_sessions_by_base_url["https://relay.example.com"][0].label).toBe("后台 A");
  });
});
