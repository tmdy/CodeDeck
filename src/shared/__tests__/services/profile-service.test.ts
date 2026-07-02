// Profile Service 测试 — 翻译自 Go internal/app/usecase/profile_usecase_test.go

import { describe, it, expect, beforeEach } from "vitest";
import { ProfileService, type LocalStateAccessor } from "../../services/profile-service.js";
import { defaultLocalState, type LocalState } from "../../state/local-state.js";
import { cloneLocalState } from "../../state/store.js";
import { normalizeProfile, type Profile, type RuntimeSettings } from "../../profile/types.js";
import { itemKey } from "../../profile/keys-internal.js";
import type { SiteBalanceSession } from "../../balance/site-balance-sessions.js";

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
          preset: "strict_whitelist",
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

      expect(saved.permissions?.preset).toBe("strict_whitelist");
      expect(JSON.stringify(savedConfigs[0])).toContain("strict_whitelist");
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
          preset: "readonly",
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

      expect(cloned.permissions?.preset).toBe("readonly");
      expect(cloned.permissions?.common?.allowNetwork).toBe(false);
      expect(cloned.permissions?.common?.additionalWritableRoots).toEqual(["C:/shared"]);
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
