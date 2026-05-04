// Profile Service 测试 — 翻译自 Go internal/app/usecase/profile_usecase_test.go

import { describe, it, expect, beforeEach } from "vitest";
import { ProfileService, type LocalStateAccessor } from "../../services/profile-service.js";
import { defaultLocalState, type LocalState } from "../../state/local-state.js";
import { cloneLocalState } from "../../state/store.js";
import type { Profile, RuntimeSettings } from "../../profile/types.js";
import { itemKey } from "../../profile/keys-internal.js";

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

function makeRuntime(): RuntimeSettings {
  return {
    proxy: "",
    cwd: "/home/user",
    command_base: "claude",
    model: "",
    launch_mode: "direct",
    extra_args: "",
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
      });

      // 重命名
      const renamed: Profile = { ...profiles[0], name: "Renamed" };
      await localService.saveProfile(oldKey, renamed, makeRuntime());

      const state = localAccessor.get();
      const newKey = itemKey(renamed);
      expect(state.runtime_by_profile[oldKey]).toBeUndefined();
      expect(state.runtime_by_profile[newKey]).toBeDefined();
    });

    it("should validate required fields", async () => {
      const empty: Profile = { provider: "claude", name: "", url: "", key: "" };
      await expect(service.saveProfile("", empty, makeRuntime())).rejects.toThrow("名称不能为空");
    });

    it("should validate URL format", async () => {
      const bad: Profile = { provider: "claude", name: "Test", url: "ftp://bad.com", key: "key" };
      await expect(service.saveProfile("", bad, makeRuntime())).rejects.toThrow("http:// 或 https://");
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
        selected_profile_key: key,
        selected_profile_key_by_provider: { claude: key },
      });

      const localService = new ProfileService(makeProfiles(), localAccessor);
      await localService.deleteProfile(key);

      const state = localAccessor.get();
      expect(state.runtime_by_profile[key]).toBeUndefined();
      expect(state.selected_profile_key).toBe("");
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
  });
});

describe("model mapping integration", () => {
  it("should resolve model through mappings in state", async () => {
    const accessor = new MemoryStateAccessor();
    const state = accessor.get();
    state.model_mappings = [
      {
        id: "1",
        provider: "claude" as const,
        pattern: "sonnet",
        target_model: "claude-sonnet-4-20250514",
        display_name: "Sonnet 4",
        enabled: true,
        priority: 1,
      },
    ];
    await accessor.save(state);

    const { ModelMappingService } = await import("../../services/model-mapping-service.js");
    const mappingService = new ModelMappingService(accessor);

    const resolved = mappingService.resolve("claude", "sonnet");
    expect(resolved).toBe("claude-sonnet-4-20250514");
  });
});