import { describe, expect, it } from "vitest";
import { ProfileService, type LocalStateAccessor, type SyncProfileStore } from "../../services/profile-service.js";
import { defaultLocalState, type LocalState } from "../../state/local-state.js";
import { cloneLocalState } from "../../state/store.js";
import type { EncryptedProfileConfig } from "../../balance/site-balance-sessions.js";
import type { Profile } from "../../profile/types.js";
import { itemKey } from "../../profile/keys-internal.js";

class MemoryStateAccessor implements LocalStateAccessor {
  private state = defaultLocalState();

  get(): LocalState {
    return cloneLocalState(this.state);
  }

  async save(state: LocalState): Promise<void> {
    this.state = cloneLocalState(state);
  }
}

class MemoryProfileStore implements SyncProfileStore {
  config: EncryptedProfileConfig | null = null;

  async saveConfig(config: EncryptedProfileConfig): Promise<void> {
    this.config = config;
  }
}

const profile: Profile = {
  provider: "claude",
  name: "Relay",
  url: "https://relay.example.com",
  key: "sk-a",
  channels: [
    { id: "a", name: "渠道 A", key: "sk-a", selectedModelId: "model-a" },
    { id: "b", name: "渠道 B", key: "sk-b", selectedModelId: "model-b" },
  ],
  activeChannelId: "a",
};

describe("ProfileService channels", () => {
  it("switches the active channel and persists compatibility mirrors", async () => {
    const store = new MemoryProfileStore();
    const service = new ProfileService([profile], new MemoryStateAccessor(), store);

    const updated = await service.selectProfileChannel(itemKey(profile), "b");

    expect(updated.activeChannelId).toBe("b");
    expect(updated.key).toBe("sk-b");
    expect(updated.selectedModelId).toBe("model-b");
    expect(store.config?.profiles[0]).toMatchObject({
      activeChannelId: "b",
      key: "sk-b",
      selectedModelId: "model-b",
    });
  });

  it("updates only the requested channel model cache", async () => {
    const store = new MemoryProfileStore();
    const service = new ProfileService([profile], new MemoryStateAccessor(), store);

    const updated = await service.updateProfileChannelModels(
      itemKey(profile),
      "b",
      ["model-b", "model-b-fast"],
      "2026-07-30T12:00:00.000Z",
      "https://relay.example.com",
    );

    expect(updated.channels?.find((channel) => channel.id === "a")?.models).toBeUndefined();
    expect(updated.channels?.find((channel) => channel.id === "b")).toMatchObject({
      models: ["model-b", "model-b-fast"],
      modelsFetchedAt: "2026-07-30T12:00:00.000Z",
      modelsBaseUrl: "https://relay.example.com",
    });
  });
});
