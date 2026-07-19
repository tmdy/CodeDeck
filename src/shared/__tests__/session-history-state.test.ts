import { describe, expect, it } from "vitest";
import { resolveHistoryRestoreProfileKey, resolveHistoryScope } from "../session-history-state.js";
import { defaultLocalState, type LocalState } from "../state/local-state.js";
import type { Profile } from "../profile/types.js";

function makeProfiles(): Profile[] {
  return [
    { provider: "claude", name: "Official", url: "https://claude.example.com", key: "sk-claude" },
    { provider: "codex", name: "OpenAI", url: "https://api.openai.com/v1", key: "sk-codex" },
    { provider: "claude", name: "Backup", url: "https://backup.example.com", key: "sk-backup" },
  ];
}

function makeState(overrides: Partial<LocalState> = {}): LocalState {
  return {
    ...defaultLocalState(),
    ...overrides,
  };
}

describe("session-history-state", () => {
  it("defaults to global_recent when there is no remembered scope and cwd is empty", () => {
    const scope = resolveHistoryScope(makeState(), "claude", "");

    expect(scope).toBe("global_recent");
  });

  it("defaults to global_recent even when cwd exists", () => {
    const scope = resolveHistoryScope(makeState(), "claude", "C:/repo");

    expect(scope).toBe("global_recent");
  });

  it("normalizes a remembered project scope to global_recent", () => {
    const scope = resolveHistoryScope(makeState({
      sessions_tab_scope_by_provider: {
        claude: "project",
      },
    }), "claude", "");

    expect(scope).toBe("global_recent");
  });

  it("keeps remembered global_recent scope when it is already stored", () => {
    const scope = resolveHistoryScope(makeState({
      sessions_tab_scope_by_provider: {
        claude: "global_recent",
      },
    }), "claude", "C:/repo");

    expect(scope).toBe("global_recent");
  });

  it("prefers remembered restore profile when it still exists under the same provider", () => {
    const profiles = makeProfiles();
    const state = makeState({
      selected_provider: "claude",
      selected_profile_key: "claude::Official",
      selected_profile_key_by_provider: { claude: "claude::Official" },
      sessions_tab_restore_profile_key_by_provider: {
        claude: "claude::Backup",
      },
    });

    const key = resolveHistoryRestoreProfileKey(state, profiles, "claude");

    expect(key).toBe("claude::Backup");
  });

  it("falls back to the active provider profile when remembered restore profile is missing", () => {
    const profiles = makeProfiles();
    const state = makeState({
      selected_provider: "claude",
      selected_profile_key: "claude::Official",
      selected_profile_key_by_provider: { claude: "claude::Official" },
      sessions_tab_restore_profile_key_by_provider: {
        claude: "claude::Missing",
      },
    });

    const key = resolveHistoryRestoreProfileKey(state, profiles, "claude");

    expect(key).toBe("claude::Official");
  });

  it("returns empty when the provider has no available profiles", () => {
    const key = resolveHistoryRestoreProfileKey(makeState({
      selected_provider: "codex",
    }), makeProfiles().filter((profile) => profile.provider === "claude"), "codex");

    expect(key).toBe("");
  });
});
