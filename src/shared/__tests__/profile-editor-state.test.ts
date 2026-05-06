import { describe, expect, it } from "vitest";
import {
  buildNewProfileDraft,
  buildRuntimeSettingsFromDraft,
  buildSelectedProfileDraft,
  hasProfileDraftChanges,
  hasOnlyProfileDraftBalanceSessionChange,
  hasOnlyProfileDraftCwdChange,
  hasOnlyProfileDraftSelectedModelIdChange,
  type ProfileEditorDraft,
} from "../profile-editor-state.js";
import type { Profile } from "../profile/types.js";

const claudeProfile: Profile = {
  provider: "claude",
  name: "Claude Official",
  url: "https://api.anthropic.com",
  key: "sk-ant",
  selectedModelId: "deepseek-v4-pro",
  balance_session_id: "sess-a",
};

function makeDraft(overrides: Partial<ProfileEditorDraft> = {}): ProfileEditorDraft {
  return {
    name: "Claude Official",
    url: "https://api.anthropic.com",
    key: "sk-ant",
    selectedModelId: "deepseek-v4-pro",
    advancedModelMapping: {
      enabled: false,
      claude: {
        defaultTarget: "",
        opusTarget: "",
        sonnetTarget: "",
        haikuTarget: "",
        subagentTarget: "",
      },
      codex: {
        commandLineModelOverride: "",
      },
    },
    balanceSessionSelection: "sess-a",
    balanceSessionDraft: {
      label: "后台 A",
      access_token: "token-a",
      user_id: "42",
    },
    cwd: "C:/workspace",
    command_base: "claude",
    settings_file: "",
    launch_mode: "new",
    extra_args: "--verbose",
    exclude_user_settings: true,
    ...overrides,
    permissions: overrides.permissions ?? null,
  };
}

describe("profile-editor-state", () => {
  it("should build selected profile draft from profile and runtime", () => {
    const draft = buildSelectedProfileDraft(
      claudeProfile,
      {
        cwd: "C:/repo",
        command_base: "claude-dev",
        model: "legacy-model",
        settings_file: "C:/Users/test/.claude/settings.local.json",
        launch_mode: "continue_last",
        extra_args: "--debug",
        exclude_user_settings: false,
      },
      "claude",
      {
        label: "后台 A",
        access_token: "token-a",
        user_id: "42",
      },
    );

    expect(draft).toEqual({
      name: "Claude Official",
      url: "https://api.anthropic.com",
      key: "sk-ant",
      selectedModelId: "deepseek-v4-pro",
      advancedModelMapping: {
        enabled: false,
        claude: {
          defaultTarget: "",
          opusTarget: "",
          sonnetTarget: "",
          haikuTarget: "",
          subagentTarget: "",
        },
        codex: {
          commandLineModelOverride: "",
        },
      },
      permissions: null,
      balanceSessionSelection: "sess-a",
      balanceSessionDraft: {
        label: "后台 A",
        access_token: "token-a",
        user_id: "42",
      },
      cwd: "C:/repo",
      command_base: "claude-dev",
      settings_file: "C:/Users/test/.claude/settings.local.json",
      launch_mode: "continue_last",
      extra_args: "--debug",
      exclude_user_settings: false,
    });
  });

  it("should build new profile draft with provider defaults", () => {
    const draft = buildNewProfileDraft("codex");

    expect(draft.name).toBe("");
    expect(draft.url).toBe("");
    expect(draft.key).toBe("");
    expect(draft.command_base).toBe("codex");
    expect(draft.selectedModelId).toBe("");
    expect(draft.permissions).toBeNull();
    expect(draft.balanceSessionSelection).toBe("auto");
    expect(draft.exclude_user_settings).toBe(true);
  });

  it("should detect unsaved changes including selectedModelId, command_base, and session binding", () => {
    const baseline = makeDraft();
    const changed = makeDraft({
      command_base: "claude-alt",
      selectedModelId: "glm-4.6",
      balanceSessionSelection: "sess-b",
    });

    expect(hasProfileDraftChanges(changed, baseline)).toBe(true);
    expect(hasProfileDraftChanges(baseline, baseline)).toBe(false);
  });

  it("should identify cwd-only changes for silent autosave", () => {
    const baseline = makeDraft();

    expect(hasOnlyProfileDraftCwdChange(makeDraft({ cwd: "C:/new-workspace" }), baseline)).toBe(true);
    expect(hasOnlyProfileDraftCwdChange(makeDraft({ cwd: "C:/new-workspace", extra_args: "--debug" }), baseline)).toBe(false);
    expect(hasOnlyProfileDraftCwdChange(baseline, baseline)).toBe(false);
  });

  it("should identify selectedModelId-only changes for silent autosave", () => {
    const baseline = makeDraft();

    expect(hasOnlyProfileDraftSelectedModelIdChange(makeDraft({ selectedModelId: "glm-4.6" }), baseline)).toBe(true);
    expect(
      hasOnlyProfileDraftSelectedModelIdChange(
        makeDraft({ selectedModelId: "glm-4.6", url: "https://changed.example.com" }),
        baseline,
      ),
    ).toBe(false);
    expect(hasOnlyProfileDraftSelectedModelIdChange(baseline, baseline)).toBe(false);
  });

  it("should identify balance-session-only changes for silent autosave", () => {
    const baseline = makeDraft();

    expect(
      hasOnlyProfileDraftBalanceSessionChange(
        makeDraft({
          balanceSessionSelection: "new",
          balanceSessionDraft: {
            label: "后台 B",
            access_token: "token-b",
            user_id: "84",
          },
        }),
        baseline,
      ),
    ).toBe(true);
    expect(
      hasOnlyProfileDraftBalanceSessionChange(
        makeDraft({
          balanceSessionSelection: "new",
          balanceSessionDraft: {
            label: "后台 B",
            access_token: "token-b",
            user_id: "84",
          },
          name: "Changed Name",
        }),
        baseline,
      ),
    ).toBe(false);
    expect(hasOnlyProfileDraftBalanceSessionChange(baseline, baseline)).toBe(false);
  });

  it("should convert draft back to runtime settings without proxy", () => {
    const runtime = buildRuntimeSettingsFromDraft(makeDraft({ command_base: "claude-dev" }));

    expect(runtime).toEqual({
      cwd: "C:/workspace",
      command_base: "claude-dev",
      model: "",
      settings_file: "",
      launch_mode: "new",
      extra_args: "--verbose",
      exclude_user_settings: true,
    });
  });
});
