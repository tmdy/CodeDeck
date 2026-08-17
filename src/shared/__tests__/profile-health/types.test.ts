import { describe, expect, it } from "vitest";
import {
  buildProfileHealthTarget,
  normalizeProfileHealthByTarget,
  profileHealthRequestMatchesSavedProfile,
  profileHealthTargetKey,
} from "../../profile-health/types.js";
import type { Profile } from "../../profile/types.js";

describe("profile health types", () => {
  it("builds a credential-free target for the active channel and model", () => {
    const profile: Profile = {
      provider: "codex",
      name: "Relay",
      url: "https://relay.example/v1/",
      key: "secret",
      activeChannelId: "paid",
      channels: [
        { id: "free", name: "Free", key: "free-secret", selectedModelId: "small" },
        { id: "paid", name: "Paid", key: "paid-secret", selectedModelId: "large" },
      ],
    };
    const target = buildProfileHealthTarget(profile, "codex::Relay");

    expect(target).toEqual({
      provider: "codex",
      profile_key: "codex::Relay",
      channel_id: "paid",
      base_url: "https://relay.example/v1",
      model_id: "large",
    });
    expect(profileHealthTargetKey(target)).not.toContain("secret");
  });

  it("does not persist credentials embedded in the Profile Base URL", () => {
    const profile: Profile = {
      provider: "claude",
      name: "Relay",
      url: "https://probe-user:probe-password@relay.example/v1/",
      key: "secret",
      selectedModelId: "claude-test",
    };

    const target = buildProfileHealthTarget(profile, "claude::Relay");

    expect(target.base_url).toBe("https://relay.example/v1");
    expect(JSON.stringify(target)).not.toContain("probe-user");
    expect(JSON.stringify(target)).not.toContain("probe-password");
  });

  it("normalizes missing or malformed persisted state to an empty record", () => {
    expect(normalizeProfileHealthByTarget(undefined)).toEqual({});
    expect(normalizeProfileHealthByTarget({ broken: { status: "available" } })).toEqual({});
  });

  it("persists draft results only when the saved target and credential still match", () => {
    const saved: Profile = {
      provider: "codex",
      name: "Relay",
      url: "https://relay.example/v1",
      key: "secret-a",
      selectedModelId: "gpt-test",
    };
    expect(profileHealthRequestMatchesSavedProfile(saved, {
      profile_key: "codex::Relay",
      profile: { ...saved },
    })).toBe(true);
    expect(profileHealthRequestMatchesSavedProfile(saved, {
      profile_key: "codex::Relay",
      profile: { ...saved, key: "secret-b" },
    })).toBe(false);
    expect(profileHealthRequestMatchesSavedProfile(saved, {
      profile_key: "codex::Relay",
      profile: { ...saved, selectedModelId: "gpt-other" },
    })).toBe(false);
    expect(profileHealthRequestMatchesSavedProfile({
      ...saved,
      url: "https://first:credential@relay.example/v1",
    }, {
      profile_key: "codex::Relay",
      profile: { ...saved, url: "https://second:credential@relay.example/v1" },
    })).toBe(false);
  });
});
