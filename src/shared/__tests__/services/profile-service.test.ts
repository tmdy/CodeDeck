// Profile Service 测试 — 翻译自 Go internal/app/usecase/profile_usecase_test.go

import { describe, it, expect, beforeEach } from "vitest";
import { ProfileService, type LocalStateAccessor } from "../../services/profile-service.js";
import { defaultLocalState, type LocalState } from "../../state/local-state.js";
import { cloneLocalState } from "../../state/store.js";
import { createOfficialNativeProfile, normalizeProfile, type Profile, type RuntimeSettings } from "../../profile/types.js";
import { itemKey } from "../../profile/keys-internal.js";
import type {
  EncryptedProfileConfig,
  SiteBalanceSession,
} from "../../balance/site-balance-sessions.js";

// 内存状态存储（测试用）
class MemoryStateAccessor implements LocalStateAccessor {
  private state: LocalState;

  constructor(initial?: Partial<LocalState>) {
    this.state = { ...defaultLocalState(), ...initial };
  }

  get(): LocalState {
    return cloneLocalState(this.state);
  }

  async save(state: LocalState): Promise<void> {
    this.state = cloneLocalState(state);
  }
}

function makeProfiles(): Profile[] {
  return [
    { provider: "claude", name: "Official", url: "https://api.anthropic.com", key: "sk-ant-1" },
    { provider: "codex", name: "OpenAI", url: "https://api.openai.com/v1", key: "sk-openai-1" },
    { provider: "claude", name: "Custom", url: "https://custom.api.com", key: "sk-custom" },
  ];
}

function makeSiteSession(id: string, label: string, baseUrl: string = "https://new-api.example.com"): SiteBalanceSession {
  return {
    id,
    label,
    base_url: baseUrl,
    access_token: `token-${id}`,
    user_id: `${id.length * 100}`,
    updated_at: "2026-05-05T09:00:00.000Z",
  };
}

function makeRuntime(): RuntimeSettings {
  return {
    cwd: "/home/user",
    command_base: "claude",
    model: "",
    settings_file: "",
    launch_mode: "new",
    extra_args: "",
    extra_env: {},
    exclude_user_settings: true,
  };
}

describe("ProfileService", () => {
  let accessor: MemoryStateAccessor;
  let service: ProfileService;

  beforeEach(() => {
    accessor = new MemoryStateAccessor();
    service = new ProfileService(makeProfiles(), accessor);
  });

  describe("saveProfile", () => {
    it("should create a new profile", async () => {
      const draft: Profile = {
        provider: "claude",
        name: "NewProfile",
        url: "https://new.example.com",
        key: "sk-new",
      };
      const result = await service.saveProfile("", draft, makeRuntime());
      expect(result.name).toBe("NewProfile");
      expect(service.getProfiles().length).toBe(4);
    });

    it("should allow the official CLI profile without provider credentials", async () => {
      const draft = createOfficialNativeProfile("codex");
      const result = await service.saveProfile("", draft, {
        ...makeRuntime(),
        command_base: "codex",
        startup_mode: "native",
      });
      expect(result).toEqual(draft);
      expect(accessor.get().runtime_by_profile[itemKey(result)].startup_mode).toBe("native");
    });

    it("should update an existing profile", async () => {
      const key = itemKey(makeProfiles()[0]); // "claude::Official"
      const draft: Profile = {
        provider: "claude",
        name: "Official",
        url: "https://updated.example.com",
        key: "sk-updated",
      };
      const result = await service.saveProfile(key, draft, makeRuntime());
      expect(result.url).toBe("https://updated.example.com");
    });

    it("should save runtime settings only under runtime_by_profile", async () => {
      const key = itemKey(makeProfiles()[0]);
      const runtime = {
        ...makeRuntime(),
        cwd: "C:/project",
        command_base: "claude-dev",
      };

      await service.saveProfile(key, makeProfiles()[0], runtime);

      const state = accessor.get();
      expect(state.runtime_by_profile[key]).toEqual(runtime);
      expect(service.getProfiles()[0]).toEqual(normalizeProfile(makeProfiles()[0]));
    });

    it("should update terminal mode for one profile runtime without changing other profiles", async () => {
      const alphaKey = itemKey(makeProfiles()[0]);
      const betaKey = itemKey(makeProfiles()[2]);
      await service.saveProfile(alphaKey, makeProfiles()[0], {
        ...makeRuntime(),
        cwd: "C:/alpha",
        terminal_mode: "monitored",
      });
      await service.saveProfile(betaKey, makeProfiles()[2], {
        ...makeRuntime(),
        cwd: "C:/beta",
        terminal_mode: "monitored",
      });

      const updated = await service.updateProfileRuntimeSettings(alphaKey, {
        terminal_mode: "direct",
      });

      const state = accessor.get();
      expect(updated.terminal_mode).toBe("direct");
      expect(state.runtime_by_profile[alphaKey]).toEqual(
        expect.objectContaining({
          cwd: "C:/alpha",
          terminal_mode: "direct",
        }),
      );
      expect(state.runtime_by_profile[betaKey]).toEqual(
        expect.objectContaining({
          cwd: "C:/beta",
          terminal_mode: "monitored",
        }),
      );
    });

    it("should persist runtime environment values only through the encrypted config store", async () => {
      const savedConfigs: Array<{ runtime_env_by_profile?: Record<string, Record<string, string>> }> = [];
      const profile = makeProfiles()[0];
      const profileKey = itemKey(profile);
      const localService = new ProfileService([profile], new MemoryStateAccessor(), {
        async saveConfig(config) {
          savedConfigs.push(config);
        },
      });

      await localService.saveProfile(profileKey, profile, {
        ...makeRuntime(),
        extra_env: { PRIVATE_TOKEN: "secret" },
      });
      await localService.updateProfileRuntimeSettings(profileKey, {
        terminal_mode: "direct",
      });

      expect(savedConfigs.at(-1)?.runtime_env_by_profile).toEqual({
        [profileKey]: { PRIVATE_TOKEN: "secret" },
      });
    });

    it("should persist profile permissions with the encrypted synced profile data", async () => {
      const savedConfigs: unknown[] = [];
      const localService = new ProfileService([], new MemoryStateAccessor(), {
        async saveConfig(config) {
          savedConfigs.push(config);
        },
      });
      const draft: Profile = {
        provider: "claude",
        name: "Locked",
        url: "https://api.anthropic.com",
        key: "sk-ant",
        permissions: {
          mode: "dontAsk",
          common: {
            allowNetwork: false,
            denyEnvFiles: true,
            denyGitPush: true,
            denyDangerousDelete: true,
            additionalWritableRoots: ["C:/shared"],
          },
        },
      };

      const saved = await localService.saveProfile("", draft, makeRuntime());

      expect(saved.permissions).toMatchObject({ provider: "claude", mode: "dontAsk" });
      expect(JSON.stringify(savedConfigs[0])).toContain("dontAsk");
      expect(JSON.stringify(savedConfigs[0])).toContain("C:/shared");
    });

    it("should reject duplicate name", async () => {
      const draft: Profile = {
        provider: "claude",
        name: "Official", // 已存在
        url: "https://new.example.com",
        key: "sk-new",
      };
      await expect(service.saveProfile("", draft, makeRuntime())).rejects.toThrow("名称重复");
    });

    it("should handle rename and migrate state", async () => {
      // 先创建一个 profile，然后重命名
      const profiles = [makeProfiles()[0]];
      const localAccessor = new MemoryStateAccessor();
      const localService = new ProfileService(profiles, localAccessor);

      const oldKey = itemKey(profiles[0]);
      // 设置初始 runtime
      await localAccessor.save({
        ...defaultLocalState(),
        runtime_by_profile: { [oldKey]: makeRuntime() },
        balance_checks_by_profile: {
          [oldKey]: {
            provider: "claude",
            profile_name: "Official",
            base_url: "https://api.anthropic.com",
            running: false,
            supported: true,
            success: true,
            message: "",
            items: [{ label: "USD", remaining: 5, total: 10, used: 5, unit: "$" }],
            endpoint: "https://api.anthropic.com/api/user/self",
            finished_at_display: "2026/05/05 12:00:00",
          },
        },
        sessions_tab_restore_profile_key_by_provider: { claude: oldKey },
      });

      // 重命名
      const renamed: Profile = { ...profiles[0], name: "Renamed" };
      await localService.saveProfile(oldKey, renamed, makeRuntime());

      const state = localAccessor.get();
      const newKey = itemKey(renamed);
      expect(state.runtime_by_profile[oldKey]).toBeUndefined();
      expect(state.runtime_by_profile[newKey]).toBeDefined();
      expect(state.balance_checks_by_profile[oldKey]).toBeUndefined();
      expect(state.balance_checks_by_profile[newKey]).toMatchObject({
        provider: "claude",
        profile_name: "Renamed",
      });
      expect(state.sessions_tab_restore_profile_key_by_provider.claude).toBe(newKey);
    });

    it("should validate required fields", async () => {
      const empty: Profile = { provider: "claude", name: "", url: "", key: "" };
      await expect(service.saveProfile("", empty, makeRuntime())).rejects.toThrow("名称不能为空");
    });

    it("should validate URL format", async () => {
      const bad: Profile = { provider: "claude", name: "Test", url: "ftp://bad.com", key: "key" };
      await expect(service.saveProfile("", bad, makeRuntime())).rejects.toThrow("http:// 或 https://");
    });

    it("should keep balance_session_id on rename but clear it when the profile moves to another site", async () => {
      const profile: Profile = {
        provider: "codex",
        name: "Relay",
        url: "https://new-api.example.com/v1",
        key: "sk-relay",
        balance_session_id: "sess-a",
      };
      const localService = new ProfileService([profile], new MemoryStateAccessor(), null, {
        "https://new-api.example.com": [makeSiteSession("sess-a", "后台 A")],
      });

      const renamed = await localService.saveProfile(itemKey(profile), {
        ...profile,
        name: "Relay Renamed",
      }, makeRuntime());
      expect(renamed.balance_session_id).toBe("sess-a");

      const moved = await localService.saveProfile(itemKey(renamed), {
        ...renamed,
        url: "https://other-new-api.example.com/v1",
      }, makeRuntime());
      expect(moved.balance_session_id).toBeUndefined();
    });

    it("should clear a stale API-key balance result when binding a backend account", async () => {
      const profile: Profile = {
        provider: "codex",
        name: "Relay",
        url: "https://new-api.example.com/v1",
        key: "sk-relay",
      };
      const key = itemKey(profile);
      const accessor = new MemoryStateAccessor({
        balance_checks_by_profile: {
          [key]: {
            provider: "codex",
            profile_name: "Relay",
            base_url: "https://new-api.example.com",
            running: false,
            supported: true,
            success: false,
            message: "余额接口鉴权失败，请检查 API Key",
            items: [],
            endpoint: "https://new-api.example.com/api/user/self",
            finished_at_display: "2026/08/04 19:28:51",
          },
        },
        site_capability_cache: {
          checkin_by_account: {},
          balance_by_target: {
            [`profile:${key}`]: {
              family: "new_api_family",
              auth_mode: "bearer",
              learned_at: "2026-08-04T11:28:51.000Z",
              credential_updated_at: "2026-08-04T11:28:51.000Z",
              base_url: "https://new-api.example.com",
            },
          },
        },
      });
      const localService = new ProfileService([profile], accessor, null, {
        "https://new-api.example.com": [makeSiteSession("sess-a", "账号1")],
      });

      await localService.saveProfile(key, {
        ...profile,
        balance_session_id: "sess-a",
      }, makeRuntime());

      expect(accessor.get().balance_checks_by_profile[key]).toBeUndefined();
      expect(accessor.get().site_capability_cache.balance_by_target[`profile:${key}`]).toBeUndefined();
    });
  });

  describe("bindProfileSiteBalanceSession", () => {
    it("binds only the matching saved backend account to an existing profile", async () => {
      const profile: Profile = {
        provider: "codex",
        name: "Relay",
        url: "https://new-api.example.com/v1",
        key: "sk-relay",
      };
      const profileKey = itemKey(profile);
      const accessor = new MemoryStateAccessor({
        balance_checks_by_profile: {
          [profileKey]: {
            provider: "codex",
            profile_name: "Relay",
            base_url: "https://new-api.example.com",
            running: false,
            supported: true,
            success: false,
            message: "旧余额结果",
            items: [],
            endpoint: "https://new-api.example.com/api/user/self",
            finished_at_display: "2026/08/15 12:00:00",
          },
        },
      });
      const localService = new ProfileService([profile], accessor, null, {
        "https://new-api.example.com": [makeSiteSession("sess-a", "账号1")],
      });

      const bound = await localService.bindProfileSiteBalanceSession(
        profileKey,
        "https://new-api.example.com/v1/chat/completions",
        "sess-a",
      );

      expect(bound).toEqual(expect.objectContaining({
        provider: profile.provider,
        name: profile.name,
        url: profile.url,
        key: profile.key,
        balance_session_id: "sess-a",
      }));
      expect(localService.getProfiles()).toEqual([bound]);
      expect(accessor.get().balance_checks_by_profile[profileKey]).toBeUndefined();
    });

    it("rejects missing profiles, URL mismatches, and missing backend accounts", async () => {
      const profile: Profile = {
        provider: "codex",
        name: "Relay",
        url: "https://new-api.example.com/v1",
        key: "sk-relay",
      };
      const localService = new ProfileService([profile], new MemoryStateAccessor(), null, {
        "https://new-api.example.com": [makeSiteSession("sess-a", "账号1")],
      });

      await expect(localService.bindProfileSiteBalanceSession(
        "codex::Missing",
        profile.url,
        "sess-a",
      )).rejects.toThrow("profile not found");
      await expect(localService.bindProfileSiteBalanceSession(
        itemKey(profile),
        "https://other.example.com/v1",
        "sess-a",
      )).rejects.toThrow("Base URL 不一致");
      await expect(localService.bindProfileSiteBalanceSession(
        itemKey(profile),
        profile.url,
        "missing-session",
      )).rejects.toThrow("后台账号不存在");
    });

    it("rejects a session whose stored base URL disagrees with its map key", async () => {
      const profile: Profile = {
        provider: "codex",
        name: "Relay",
        url: "https://new-api.example.com/v1",
        key: "sk-relay",
      };
      const mismatchedSession = {
        ...makeSiteSession("sess-a", "账号1"),
        base_url: "https://other.example.com",
      };
      const localService = new ProfileService([profile], new MemoryStateAccessor(), null, {
        "https://new-api.example.com": [mismatchedSession],
      });

      await expect(localService.bindProfileSiteBalanceSession(
        itemKey(profile),
        profile.url,
        "sess-a",
      )).rejects.toThrow("Base URL 不一致");
    });
  });

  describe("deleteProfile", () => {
    it("should delete existing profile", async () => {
      const key = itemKey(makeProfiles()[0]);
      await service.deleteProfile(key);
      expect(service.getProfiles().length).toBe(2);
    });

    it("should throw on non-existent profile", async () => {
      await expect(service.deleteProfile("claude::nonexistent")).rejects.toThrow("profile not found");
    });

    it("should keep official CLI profiles undeletable", async () => {
      const official = createOfficialNativeProfile("claude");
      const localService = new ProfileService([official], new MemoryStateAccessor());
      await expect(localService.deleteProfile(itemKey(official))).rejects.toThrow("不可删除");
    });

    it("should clean up associated state", async () => {
      const key = itemKey(makeProfiles()[0]);
      const localAccessor = new MemoryStateAccessor({
        runtime_by_profile: { [key]: makeRuntime() },
        balance_checks_by_profile: {
          [key]: {
            provider: "claude",
            profile_name: "Official",
            base_url: "https://api.anthropic.com",
            running: false,
            supported: true,
            success: true,
            message: "",
            items: [{ label: "USD", remaining: 5, total: 10, used: 5, unit: "$" }],
            endpoint: "https://api.anthropic.com/api/user/self",
            finished_at_display: "2026/05/05 12:00:00",
          },
        },
        selected_profile_key: key,
        selected_profile_key_by_provider: { claude: key },
        sessions_tab_restore_profile_key_by_provider: { claude: key },
      });

      const localService = new ProfileService(makeProfiles(), localAccessor);
      await localService.deleteProfile(key);

      const state = localAccessor.get();
      expect(state.runtime_by_profile[key]).toBeUndefined();
      expect(state.balance_checks_by_profile[key]).toBeUndefined();
      expect(state.selected_profile_key).toBe("");
      expect(state.sessions_tab_restore_profile_key_by_provider.claude).toBeUndefined();
    });
  });

  describe("cloneProfileToProvider", () => {
    it("should clone claude profile to codex", async () => {
      // 添加 Claude profile
      const claudeProfile: Profile = {
        provider: "claude",
        name: "MyAPI",
        url: "https://api.example.com",
        key: "sk-key",
      };
      const localService = new ProfileService([claudeProfile], new MemoryStateAccessor());

      const cloned = await localService.cloneProfileToProvider(
        itemKey(claudeProfile),
        "codex",
      );

      expect(cloned.provider).toBe("codex");
      // 名称冲突时自动加后缀
      // URL 被规范化（添加 /v1）
      expect(cloned.url).toBe("https://api.example.com/v1");
    });

    it("should throw on non-existent source", async () => {
      await expect(
        service.cloneProfileToProvider("claude::nonexistent", "codex"),
      ).rejects.toThrow("source profile not found");
    });

    it("should preserve explicit balance session binding when cloning", async () => {
      const profile: Profile = {
        provider: "claude",
        name: "Relay",
        url: "https://new-api.example.com/v1",
        key: "sk-relay",
        balance_session_id: "sess-a",
      };
      const localService = new ProfileService([profile], new MemoryStateAccessor(), null, {
        "https://new-api.example.com": [makeSiteSession("sess-a", "后台 A")],
      });

      const cloned = await localService.cloneProfileToProvider(itemKey(profile), "codex");

      expect(cloned.balance_session_id).toBe("sess-a");
    });

    it("should copy profile permissions when cloning", async () => {
      const profile: Profile = {
        provider: "claude",
        name: "Secure",
        url: "https://api.example.com",
        key: "sk-key",
        permissions: {
          mode: "plan",
          common: {
            allowNetwork: false,
            denyEnvFiles: true,
            denyGitPush: true,
            denyDangerousDelete: true,
            additionalWritableRoots: ["C:/shared"],
          },
        },
      };
      const localService = new ProfileService([profile], new MemoryStateAccessor());

      const cloned = await localService.cloneProfileToProvider(itemKey(profile), "codex");

      expect(cloned.permissions).toMatchObject({
        provider: "codex",
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
      });
      expect(cloned.permissions?.common?.allowNetwork).toBe(true);
      expect(cloned.permissions?.common?.additionalWritableRoots).toEqual([]);
    });
  });

  describe("site balance sessions", () => {
    it("should save sessions under the normalized base url and update explicit bindings on delete", async () => {
      const boundProfile: Profile = {
        provider: "codex",
        name: "Relay",
        url: "https://new-api.example.com/v1",
        key: "sk-relay",
        balance_session_id: "sess-a",
      };
      const localService = new ProfileService([boundProfile], new MemoryStateAccessor(), null, {
        "https://new-api.example.com": [makeSiteSession("sess-a", "后台 A")],
      });

      await localService.saveSiteBalanceSession("https://new-api.example.com/v1/chat/completions", {
        id: "sess-b",
        label: "后台 B",
        access_token: "token-b",
        user_id: "2002",
      });

      expect(localService.getSiteBalanceSessionsByBaseUrl()["https://new-api.example.com"]).toHaveLength(2);

      await localService.deleteSiteBalanceSession("https://new-api.example.com/v1", "sess-a");

      expect(localService.getProfiles()[0].balance_session_id).toBeUndefined();
    });

    it("should auto-name new site balance sessions as sequential accounts", async () => {
      const profile: Profile = {
        provider: "codex",
        name: "Relay",
        url: "https://new-api.example.com/v1",
        key: "sk-relay",
      };
      const localService = new ProfileService([profile], new MemoryStateAccessor());

      const first = await localService.saveSiteBalanceSession("https://new-api.example.com/v1", {
        label: "",
        access_token: "token-a",
        user_id: "1001",
      });
      const second = await localService.saveSiteBalanceSession("https://new-api.example.com/v1", {
        label: "",
        access_token: "token-b",
        user_id: "1002",
      });

      expect(first.label).toBe("账号1");
      expect(second.label).toBe("账号2");
    });

    it("should keep an existing session label when updating without a label", async () => {
      const profile: Profile = {
        provider: "codex",
        name: "Relay",
        url: "https://new-api.example.com/v1",
        key: "sk-relay",
      };
      const localService = new ProfileService([profile], new MemoryStateAccessor(), null, {
        "https://new-api.example.com": [makeSiteSession("sess-a", "账号1")],
      });

      const updated = await localService.saveSiteBalanceSession("https://new-api.example.com/v1", {
        id: "sess-a",
        label: "",
        access_token: "token-updated",
        user_id: "1001",
      });

      expect(updated.label).toBe("账号1");
      expect(updated.access_token).toBe("token-updated");
    });

    it("should upgrade a deprecated cookie account in place without persisting browser secrets", async () => {
      const profile: Profile = {
        provider: "codex",
        name: "Relay",
        url: "https://new-api.example.com/v1",
        key: "sk-relay",
      };
      const legacy = {
        ...makeSiteSession("sess-a", "账号1"),
        auth_kind: "session_cookie" as const,
        access_token: "legacy-cookie-secret",
      };
      const localService = new ProfileService([profile], new MemoryStateAccessor(), null, {
        "https://new-api.example.com": [legacy],
      });

      const updated = await localService.saveSiteBalanceSession(profile.url, {
        id: "sess-a",
        label: "",
        access_token: "must-not-persist",
        auth_kind: "browser_session",
        browser_session_id: "opaque-local-reference",
        browser_slot: 1,
        browser_origin: "https://new-api.example.com/console/personal",
        refresh_token: "must-not-persist",
        user_id: "42",
      });

      expect(updated).toEqual(expect.objectContaining({
        id: "sess-a",
        auth_kind: "browser_session",
        access_token: "",
        browser_session_id: "opaque-local-reference",
        browser_slot: 1,
        browser_origin: "https://new-api.example.com",
        user_id: "42",
      }));
      expect(updated.refresh_token).toBeUndefined();
      expect(localService.getSiteBalanceSessionsByBaseUrl()["https://new-api.example.com"])
        .toHaveLength(1);
    });

    it("persists the browser identity slot registry with a browser account", async () => {
      const savedConfigs: EncryptedProfileConfig[] = [];
      const profile: Profile = {
        provider: "codex",
        name: "Relay",
        url: "https://new-api.example.com/v1",
        key: "sk-relay",
      };
      const localService = new ProfileService([profile], new MemoryStateAccessor(), {
        async saveConfig(config) {
          savedConfigs.push(config);
        },
      });

      await localService.saveSiteBalanceSession(profile.url, {
        label: "",
        access_token: "",
        auth_kind: "browser_session",
        browser_session_id: "shared-identity",
        browser_slot: 1,
        browser_origin: "https://new-api.example.com",
        user_id: "42",
      });

      expect(localService.getBrowserIdentitySlots()).toEqual([
        { slot: 1, browser_session_id: "shared-identity" },
      ]);
      expect(savedConfigs.at(-1)?.browser_identity_slots).toEqual([
        { slot: 1, browser_session_id: "shared-identity" },
      ]);
    });

    it("rejects deleting a browser identity slot that still has a binding", async () => {
      const account: SiteBalanceSession = {
        ...makeSiteSession("browser-a", "账号1"),
        access_token: "",
        auth_kind: "browser_session",
        browser_session_id: "shared-identity",
        browser_slot: 1,
        browser_origin: "https://new-api.example.com",
        user_id: "42",
      };
      const localService = new ProfileService([], new MemoryStateAccessor(), null, {
        "https://new-api.example.com": [account],
      }, [{ slot: 1, browser_session_id: "shared-identity" }]);

      await expect(localService.deleteBrowserIdentitySlot(1))
        .rejects.toThrow("浏览器账号槽位仍被后台账号使用");
    });

    it("rejects binding another partition identity to an occupied browser slot", async () => {
      const localService = new ProfileService([], new MemoryStateAccessor(), null, {}, [
        { slot: 1, browser_session_id: "identity-a" },
      ]);

      await expect(localService.saveSiteBalanceSession("https://new-api.example.com", {
        label: "",
        access_token: "",
        auth_kind: "browser_session",
        browser_session_id: "identity-b",
        browser_slot: 1,
        browser_origin: "https://new-api.example.com",
        user_id: "42",
      })).rejects.toThrow("浏览器账号1已绑定其他登录身份");
    });

    it("should clear cached results and learned paths when account credentials change", async () => {
      const profile: Profile = {
        provider: "codex",
        name: "Relay",
        url: "https://new-api.example.com/v1",
        key: "sk-relay",
        balance_session_id: "sess-a",
      };
      const profileKey = itemKey(profile);
      const accountKey = "https://new-api.example.com::sess-a";
      const accessor = new MemoryStateAccessor({
        balance_checks_by_profile: {
          [profileKey]: {
            provider: "codex",
            profile_name: "Relay",
            base_url: "https://new-api.example.com",
            running: false,
            supported: true,
            success: false,
            message: "旧余额结果",
            items: [],
            endpoint: "https://new-api.example.com/api/user/self",
            finished_at_display: "2026/08/04 19:28:51",
          },
        },
        checkin_states_by_account: {
          [accountKey]: {
            status: "failed",
            trigger: "manual",
            message: "旧签到结果",
            endpoint: "https://new-api.example.com/api/user/checkin",
            last_attempt_at: "2026-08-04T11:28:51.000Z",
          },
        },
        site_capability_cache: {
          checkin_by_account: {
            [accountKey]: {
              platform: "management",
              endpoint_path: "/api/user/checkin",
              method: "POST",
              authorization_mode: "raw",
              cookie_mode: "none",
              requires_user_id: true,
              learned_at: new Date().toISOString(),
              credential_updated_at: "2026-05-05T09:00:00.000Z",
            },
          },
          balance_by_target: {
            [`session:${accountKey}`]: {
              family: "new_api_family",
              auth_mode: "bearer",
              learned_at: new Date().toISOString(),
              credential_updated_at: "2026-05-05T09:00:00.000Z",
              base_url: "https://new-api.example.com",
            },
          },
        },
      });
      const localService = new ProfileService([profile], accessor, null, {
        "https://new-api.example.com": [makeSiteSession("sess-a", "账号1")],
      });

      await localService.saveSiteBalanceSession(profile.url, {
        id: "sess-a",
        label: "",
        access_token: "token-updated",
        user_id: "3142",
      });

      const state = accessor.get();
      expect(state.balance_checks_by_profile[profileKey]).toBeUndefined();
      expect(state.checkin_states_by_account[accountKey]).toBeUndefined();
      expect(state.site_capability_cache.checkin_by_account[accountKey]).toBeUndefined();
      expect(state.site_capability_cache.balance_by_target[`session:${accountKey}`]).toBeUndefined();
    });

    it("should toggle automatic check-in without replacing account credentials", async () => {
      const profile: Profile = {
        provider: "codex",
        name: "Relay",
        url: "https://new-api.example.com/v1",
        key: "sk-relay",
      };
      const localService = new ProfileService([profile], new MemoryStateAccessor(), null, {
        "https://new-api.example.com": [makeSiteSession("sess-a", "账号1")],
      });

      const updated = await localService.updateSiteBalanceSessionAutoCheckin(
        "https://new-api.example.com/v1",
        "sess-a",
        true,
      );

      expect(updated.auto_checkin_enabled).toBe(true);
      expect(updated.access_token).toBe("token-sess-a");
      expect(updated.updated_at).toBe("2026-05-05T09:00:00.000Z");
      expect(localService.getSiteBalanceSessionsByBaseUrl()["https://new-api.example.com"][0]
        .auto_checkin_enabled).toBe(true);
    });
  });

  describe("reorderProfiles", () => {
    it("should update order for provider", async () => {
      const profiles = makeProfiles();
      const keys = profiles.map((p) => itemKey(p));
      const reversed = [...keys].reverse();

      await service.reorderProfiles("claude", reversed);

      const state = accessor.get();
      // 只有 claude 的排序被更新
      expect(state.profile_order_by_provider["claude"]).toEqual(reversed);
    });
  });

  describe("profile organization", () => {
    it("persists provider-local groups and synchronizes the compatibility order", async () => {
      await service.updateProfileOrganization("claude", {
        groups: [{
          id: "standby",
          name: "备用",
          profile_keys: ["claude::Custom"],
          collapsed: true,
        }],
        ungrouped_profile_keys: ["claude::Official"],
        ungrouped_collapsed: false,
      });

      const state = accessor.get();
      expect(state.profile_organization_by_provider.claude.groups[0]).toMatchObject({
        id: "standby",
        collapsed: true,
        profile_keys: ["claude::Custom"],
      });
      expect(state.profile_order_by_provider.claude).toEqual([
        "claude::Official",
        "claude::Custom",
      ]);
    });

    it("rejects layouts with missing or duplicate profile memberships", async () => {
      await expect(service.updateProfileOrganization("claude", {
        groups: [{
          id: "duplicate",
          name: "重复",
          profile_keys: ["claude::Official", "claude::Official"],
          collapsed: false,
        }],
        ungrouped_profile_keys: [],
        ungrouped_collapsed: false,
      })).rejects.toThrow("每个 Profile 必须且只能出现在一个分组位置");

      await expect(service.updateProfileOrganization("claude", {
        groups: [],
        ungrouped_profile_keys: [
          "claude::Official",
          "claude::Custom",
          "codex::OpenAI",
        ],
        ungrouped_collapsed: false,
      })).rejects.toThrow("每个 Profile 必须且只能出现在一个分组位置");
    });

    it("keeps group membership when a profile is renamed", async () => {
      await service.updateProfileOrganization("claude", {
        groups: [{
          id: "stable",
          name: "稳定",
          profile_keys: ["claude::Official"],
          collapsed: false,
        }],
        ungrouped_profile_keys: ["claude::Custom"],
        ungrouped_collapsed: false,
      });

      await service.saveProfile("claude::Official", {
        ...makeProfiles()[0],
        name: "Renamed",
      }, makeRuntime());

      expect(accessor.get().profile_organization_by_provider.claude.groups[0]
        .profile_keys).toEqual(["claude::Renamed"]);
    });

    it("removes deleted profiles and appends new profiles to ungrouped", async () => {
      await service.updateProfileOrganization("claude", {
        groups: [{
          id: "standby",
          name: "备用",
          profile_keys: ["claude::Custom"],
          collapsed: false,
        }],
        ungrouped_profile_keys: ["claude::Official"],
        ungrouped_collapsed: false,
      });
      await service.deleteProfile("claude::Custom");
      await service.saveProfile("", {
        provider: "claude",
        name: "New",
        url: "https://new.example.com",
        key: "sk-new",
      }, makeRuntime());

      const organization = accessor.get().profile_organization_by_provider.claude;
      expect(organization.groups[0].profile_keys).toEqual([]);
      expect(organization.ungrouped_profile_keys).toEqual([
        "claude::Official",
        "claude::New",
      ]);
      expect(accessor.get().profile_order_by_provider.claude).toEqual([
        "claude::Official",
        "claude::New",
      ]);
    });
  });

  describe("activateProvider", () => {
    it("should switch to codex and restore remembered selection", async () => {
      const codexProfiles = makeProfiles().filter((p) => p.provider === "codex");
      const codexKey = itemKey(codexProfiles[0]);

      await accessor.save({
        ...defaultLocalState(),
        selected_profile_key_by_provider: { codex: codexKey },
        profile_order_by_provider: { codex: [codexKey] },
      });

      await service.activateProvider("codex");

      const state = accessor.get();
      expect(state.selected_provider).toBe("codex");
      expect(state.selected_profile_key).toBe(codexKey);
    });

    it("should ignore remembered selections from another provider", async () => {
      const claudeKey = itemKey(makeProfiles()[0]);

      await accessor.save({
        ...defaultLocalState(),
        selected_profile_key: claudeKey,
        selected_profile_key_by_provider: { codex: claudeKey, claude: claudeKey },
        profile_order_by_provider: { codex: [], claude: [claudeKey] },
      });

      await service.activateProvider("codex");

      const state = accessor.get();
      expect(state.selected_provider).toBe("codex");
      expect(state.selected_profile_key).toBe(itemKey(makeProfiles().find((p) => p.provider === "codex")!));
      expect(state.selected_profile_key_by_provider.codex).toBe(itemKey(makeProfiles().find((p) => p.provider === "codex")!));
    });

    it("should drop invalid remembered session restore profile keys during state sanitization", () => {
      const codexKey = itemKey(makeProfiles().find((p) => p.provider === "codex")!);
      const localAccessor = new MemoryStateAccessor({
        selected_provider: "codex",
        selected_profile_key: codexKey,
        selected_profile_key_by_provider: { codex: codexKey },
        sessions_tab_restore_profile_key_by_provider: {
          codex: "claude::Official",
          claude: "claude::Missing",
        },
      });
      const localService = new ProfileService(makeProfiles(), localAccessor);

      const state = localService.getState();

      expect(state.sessions_tab_restore_profile_key_by_provider.codex).toBeUndefined();
      expect(state.sessions_tab_restore_profile_key_by_provider.claude).toBeUndefined();
    });
  });
});
