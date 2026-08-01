import { describe, expect, it } from "vitest";
import {
  getActiveProfileChannel,
  normalizeProfile,
  type Profile,
} from "../../profile/types.js";

describe("profile channels", () => {
  it("migrates a legacy key and selected model into the default channel", () => {
    const profile = normalizeProfile({
      provider: "claude",
      name: "Relay",
      url: "https://relay.example.com",
      key: "sk-legacy",
      selectedModelId: "claude-sonnet-4-6",
    });

    expect(profile.activeChannelId).toBe("default");
    expect(profile.channels).toEqual([{
      id: "default",
      name: "默认渠道",
      key: "sk-legacy",
      selectedModelId: "claude-sonnet-4-6",
    }]);
  });

  it("mirrors the active channel credential and model for existing consumers", () => {
    const profile: Profile = {
      provider: "codex",
      name: "Relay",
      url: "https://relay.example.com/v1",
      key: "stale",
      selectedModelId: "stale-model",
      channels: [
        { id: "a", name: "渠道 A", key: "sk-a", selectedModelId: "model-a" },
        { id: "b", name: "渠道 B", key: "sk-b", selectedModelId: "model-b" },
      ],
      activeChannelId: "b",
    };

    const normalized = normalizeProfile(profile);
    expect(normalized.key).toBe("sk-b");
    expect(normalized.selectedModelId).toBe("model-b");
    expect(getActiveProfileChannel(normalized).name).toBe("渠道 B");
  });

  it("falls back to the first channel when the saved active id is invalid", () => {
    const profile = normalizeProfile({
      provider: "claude",
      name: "Relay",
      url: "https://relay.example.com",
      key: "",
      channels: [
        { id: "a", name: "渠道 A", key: "sk-a" },
        { id: "b", name: "渠道 B", key: "sk-b" },
      ],
      activeChannelId: "missing",
    });

    expect(profile.activeChannelId).toBe("a");
    expect(profile.key).toBe("sk-a");
  });
});
