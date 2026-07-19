import { describe, expect, it } from "vitest";
import {
  buildNewProfileDraft,
  buildRuntimeSettingsFromDraft,
  buildSelectedProfileDraft,
  hasProfileDraftChanges,
  hasOnlyProfileDraftBalanceSessionChange,
  hasOnlyProfileDraftCwdChange,
  hasOnlyProfileDraftReasoningEffortChange,
  hasOnlyProfileDraftSelectedModelIdChange,
  type ProfileEditorDraft,
} from "../profile-editor-state.js";
import {
  shouldRecommendClaudeSingleModelCompatibility,
  type Profile,
} from "../profile/types.js";

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
    extra_env: overrides.extra_env ?? {},
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
        extra_env: { PROFILE_ONLY: "profile" },
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
          reasoningEffort: "",
          defaultTarget: "",
          opusTarget: "",
          sonnetTarget: "",
          haikuTarget: "",
          subagentTarget: "",
        },
        codex: {
          commandLineModelOverride: "",
          reasoningEffort: "",
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
      launch_mode: "new",
      extra_args: "--debug",
      extra_env: { PROFILE_ONLY: "profile" },
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

  it("should build new profile drafts with empty reasoning effort defaults", () => {
    const claudeDraft = buildNewProfileDraft("claude");
    const codexDraft = buildNewProfileDraft("codex");

    expect(claudeDraft.advancedModelMapping.claude?.reasoningEffort).toBe("");
    expect(codexDraft.advancedModelMapping.codex?.reasoningEffort).toBe("");
  });

  it("should drop legacy DeepSeek reasoning effort from selected profile drafts", () => {
    const legacyProfile = {
      ...claudeProfile,
      advancedModelMapping: {
        enabled: false,
        claude: {
          deepseekReasoningEffort: "max",
        },
      },
    } as unknown as Profile;

    const draft = buildSelectedProfileDraft(
      legacyProfile,
      undefined,
      "claude",
    );

    expect(draft.advancedModelMapping.claude).not.toHaveProperty("deepseekReasoningEffort");
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

  it("should not recommend single-model compatibility for official Claude model ids on third-party gateways", () => {
    expect(shouldRecommendClaudeSingleModelCompatibility("https://api.aicod.com", "claude-opus-4-7")).toBe(false);
    expect(shouldRecommendClaudeSingleModelCompatibility("https://api.aicod.com", "claude-sonnet-4-5")).toBe(false);
    expect(shouldRecommendClaudeSingleModelCompatibility("https://api.aicod.com", "claude-haiku-4-5")).toBe(false);
    expect(shouldRecommendClaudeSingleModelCompatibility("https://api.aicod.com", "glm-5.1")).toBe(true);
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
    expect(hasProfileDraftChanges(
      makeDraft({
        advancedModelMapping: {
          ...baseline.advancedModelMapping,
          claude: {
            ...baseline.advancedModelMapping.claude,
            reasoningEffort: "xhigh",
          },
        },
      }),
      baseline,
    )).toBe(true);
    expect(hasProfileDraftChanges(
      makeDraft({
        advancedModelMapping: {
          ...baseline.advancedModelMapping,
          codex: {
            ...baseline.advancedModelMapping.codex,
            reasoningEffort: "high",
          },
        },
      }),
      baseline,
    )).toBe(true);
  });

  it("should compare permissions by field values while preserving root order semantics", () => {
    const baselinePermissions = {
      provider: "claude" as const,
      mode: "manual" as const,
      common: {
        denyEnvFiles: true,
        denyGitPush: true,
        denyDangerousDelete: true,
        allowNetwork: true,
        additionalWritableRoots: ["C:/shared", "D:/cache"],
      },
      fullAccessConfirmed: false,
    };
    const baseline = makeDraft({ permissions: baselinePermissions });
    const defaultEquivalent = makeDraft({
      permissions: {
        provider: "claude",
        mode: "manual",
        common: {
          denyEnvFiles: true,
          denyGitPush: true,
          denyDangerousDelete: true,
          allowNetwork: true,
          additionalWritableRoots: ["C:/shared", "D:/cache"],
        },
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
          mode: "bypassPermissions",
        },
      }),
      baseline,
    )).toBe(true);

    const codexBaseline = makeDraft({
      permissions: {
        provider: "codex",
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        common: baselinePermissions.common,
        fullAccessConfirmed: false,
      },
    });
    expect(hasProfileDraftChanges(
      makeDraft({
        permissions: {
          provider: "codex",
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          common: baselinePermissions.common,
          fullAccessConfirmed: false,
        },
      }),
      codexBaseline,
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

  it("should identify reasoning-effort-only changes for silent autosave", () => {
    const baseline = makeDraft();

    expect(
      hasOnlyProfileDraftReasoningEffortChange(
        makeDraft({
          advancedModelMapping: {
            ...baseline.advancedModelMapping,
            claude: {
              ...baseline.advancedModelMapping.claude,
              reasoningEffort: "max",
            },
          },
        }),
        baseline,
      ),
    ).toBe(true);
    expect(
      hasOnlyProfileDraftReasoningEffortChange(
        makeDraft({
          advancedModelMapping: {
            ...baseline.advancedModelMapping,
            codex: {
              ...baseline.advancedModelMapping.codex,
              reasoningEffort: "xhigh",
            },
          },
        }),
        baseline,
      ),
    ).toBe(true);
    expect(
      hasOnlyProfileDraftReasoningEffortChange(
        makeDraft({
          advancedModelMapping: {
            ...baseline.advancedModelMapping,
            claude: {
              ...baseline.advancedModelMapping.claude,
              reasoningEffort: "max",
            },
          },
          selectedModelId: "changed-too",
        }),
        baseline,
      ),
    ).toBe(false);
    expect(hasOnlyProfileDraftReasoningEffortChange(baseline, baseline)).toBe(false);
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
      extra_env: {},
      exclude_user_settings: true,
    });
  });
});
