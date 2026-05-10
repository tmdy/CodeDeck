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
        aliasMode: "none",
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
          aliasMode: "none",
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

  it("should create new Claude third-party drafts with single-model compatibility enabled by default", () => {
    const draft = buildNewProfileDraft("claude", {
      url: "https://api.aicod.com",
      selectedModelId: "glm-5.1",
    });

    expect(draft.advancedModelMapping.enabled).toBe(true);
    expect(draft.advancedModelMapping.claude?.aliasMode).toBe("single_model_compat");
  });

  it("should not enable single-model compatibility by default for official Claude models", () => {
    const draft = buildNewProfileDraft("claude", {
      url: "https://api.anthropic.com",
      selectedModelId: "claude-sonnet-4-5",
    });

    expect(draft.advancedModelMapping.enabled).toBe(false);
    expect(draft.advancedModelMapping.claude?.aliasMode).toBe("none");
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

  it("should compare advanced model mappings by normalized field values", () => {
    const baseline = makeDraft({
      advancedModelMapping: {
        enabled: false,
        claude: {
          aliasMode: "none",
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
    });
    const defaultEquivalent = makeDraft({
      advancedModelMapping: {
        codex: {},
        claude: {
          subagentTarget: "",
          haikuTarget: "",
          sonnetTarget: "",
          opusTarget: "",
          defaultTarget: "",
        },
        enabled: false,
      },
    });

    expect(hasProfileDraftChanges(defaultEquivalent, baseline)).toBe(false);
    expect(hasProfileDraftChanges(
      makeDraft({
        advancedModelMapping: {
          ...baseline.advancedModelMapping,
          claude: {
            ...baseline.advancedModelMapping.claude,
            sonnetTarget: "claude-sonnet-4-5",
          },
        },
      }),
      baseline,
    )).toBe(true);
  });

  it("should compare permissions by field values while preserving root order semantics", () => {
    const baselinePermissions = {
      preset: "safe" as const,
      common: {
        denyEnvFiles: true,
        denyGitPush: true,
        denyDangerousDelete: true,
        allowNetwork: true,
        additionalWritableRoots: ["C:/shared", "D:/cache"],
      },
      claude: { permissionMode: "" },
      codex: { sandboxMode: "", approvalPolicy: "" },
      fullAccessConfirmed: false,
    };
    const baseline = makeDraft({ permissions: baselinePermissions });
    const defaultEquivalent = makeDraft({
      permissions: {
        common: {
          denyEnvFiles: true,
          denyGitPush: true,
          denyDangerousDelete: true,
          allowNetwork: true,
          additionalWritableRoots: ["C:/shared", "D:/cache"],
        },
        preset: "safe",
        codex: {},
        claude: {},
      },
    });

    expect(hasProfileDraftChanges(defaultEquivalent, baseline)).toBe(false);
    expect(hasProfileDraftChanges(
      makeDraft({
        permissions: {
          ...baselinePermissions,
          common: {
            ...baselinePermissions.common,
            additionalWritableRoots: ["D:/cache", "C:/shared"],
          },
        },
      }),
      baseline,
    )).toBe(true);
    expect(hasProfileDraftChanges(
      makeDraft({
        permissions: {
          ...baselinePermissions,
          claude: { permissionMode: "bypassPermissions" },
        },
      }),
      baseline,
    )).toBe(true);
    expect(hasProfileDraftChanges(
      makeDraft({
        permissions: {
          ...baselinePermissions,
          codex: { sandboxMode: "workspace-write", approvalPolicy: "on-request" },
        },
      }),
      baseline,
    )).toBe(true);
  });

  it("should compare balance session drafts by field values", () => {
    const baseline = makeDraft();
    const defaultEquivalent = makeDraft({
      balanceSessionDraft: {
        user_id: "42",
        access_token: "token-a",
        label: "后台 A",
      },
    });

    expect(hasProfileDraftChanges(defaultEquivalent, baseline)).toBe(false);
    expect(hasOnlyProfileDraftBalanceSessionChange(defaultEquivalent, baseline)).toBe(false);
    expect(hasProfileDraftChanges(
      makeDraft({
        balanceSessionDraft: {
          label: "后台 B",
          access_token: "token-a",
          user_id: "42",
        },
      }),
      baseline,
    )).toBe(true);
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
