import type {
  AdvancedModelMapping,
  Profile,
  RuntimeSettings,
} from "./profile/types.js";
import {
  defaultRuntimeSettings,
  normalizeClaudeReasoningEffort,
  normalizeCodexReasoningEffort,
  shouldRecommendClaudeSingleModelCompatibility,
} from "./profile/types.js";
import { normalizeProfilePermissions, type ProfilePermissions } from "./profile/permissions.js";

export interface ProfileEditorDraft {
  name: string;
  url: string;
  key: string;
  selectedModelId: string;
  advancedModelMapping: AdvancedModelMapping;
  permissions: ProfilePermissions | null;
  balanceSessionSelection: string;
  balanceSessionDraft: {
    label: string;
    access_token: string;
    user_id: string;
  };
  cwd: string;
  command_base: string;
  settings_file: string;
  launch_mode: "new";
  extra_args: string;
  extra_env: Record<string, string>;
  exclude_user_settings: boolean;
}

export function buildSelectedProfileDraft(
  profile: Profile,
  runtime: RuntimeSettings | undefined,
  provider: string,
  balanceSessionDraft?: {
    label?: string;
    access_token?: string;
    user_id?: string;
  },
): ProfileEditorDraft {
  const baseRuntime = runtime ?? defaultRuntimeSettings(provider);
  return {
    name: profile.name,
    url: profile.url,
    key: profile.key,
    selectedModelId: profile.selectedModelId ?? baseRuntime.model ?? "",
    advancedModelMapping: cloneAdvancedModelMapping(profile.advancedModelMapping),
    permissions: profile.permissions ? normalizeProfilePermissions(profile.permissions, provider) : null,
    balanceSessionSelection: profile.balance_session_id ?? "auto",
    balanceSessionDraft: {
      label: balanceSessionDraft?.label ?? "",
      access_token: balanceSessionDraft?.access_token ?? "",
      user_id: balanceSessionDraft?.user_id ?? "",
    },
    cwd: baseRuntime.cwd,
    command_base: baseRuntime.command_base,
    settings_file: baseRuntime.settings_file ?? "",
    launch_mode: "new",
    extra_args: baseRuntime.extra_args,
    extra_env: cloneEnvMap(baseRuntime.extra_env),
    exclude_user_settings: baseRuntime.exclude_user_settings,
  };
}

export function buildNewProfileDraft(provider: string, initial?: { url?: string; selectedModelId?: string }): ProfileEditorDraft {
  const runtime = defaultRuntimeSettings(provider);
  const url = initial?.url ?? "";
  const selectedModelId = initial?.selectedModelId ?? "";
  const useClaudeSingleModelCompat = provider === "claude"
    && shouldRecommendClaudeSingleModelCompatibility(url, selectedModelId);
  return {
    name: "",
    url,
    key: "",
    selectedModelId,
    advancedModelMapping: cloneAdvancedModelMapping(useClaudeSingleModelCompat
      ? {
          enabled: true,
          claude: { aliasMode: "single_model_compat" },
        }
      : undefined),
    permissions: null,
    balanceSessionSelection: "auto",
    balanceSessionDraft: {
      label: "",
      access_token: "",
      user_id: "",
    },
    cwd: runtime.cwd,
    command_base: runtime.command_base,
    settings_file: runtime.settings_file ?? "",
    launch_mode: "new",
    extra_args: runtime.extra_args,
    extra_env: {},
    exclude_user_settings: runtime.exclude_user_settings,
  };
}

export function buildRuntimeSettingsFromDraft(draft: ProfileEditorDraft): RuntimeSettings {
  return {
    cwd: draft.cwd,
    command_base: draft.command_base,
    model: "",
    settings_file: draft.settings_file,
    launch_mode: draft.launch_mode,
    extra_args: draft.extra_args,
    extra_env: cloneEnvMap(draft.extra_env),
    exclude_user_settings: draft.exclude_user_settings,
  };
}

export function hasProfileDraftChanges(
  current: ProfileEditorDraft,
  baseline: ProfileEditorDraft | null,
): boolean {
  if (!baseline) {
    return Boolean(
      current.name ||
      current.url ||
      current.key ||
      current.selectedModelId ||
      current.advancedModelMapping.enabled ||
      current.permissions !== null ||
      current.balanceSessionSelection !== "auto" ||
      current.balanceSessionDraft.label ||
      current.balanceSessionDraft.access_token ||
      current.balanceSessionDraft.user_id ||
      current.advancedModelMapping.claude?.defaultTarget ||
      current.advancedModelMapping.claude?.opusTarget ||
      current.advancedModelMapping.claude?.sonnetTarget ||
      current.advancedModelMapping.claude?.haikuTarget ||
      current.advancedModelMapping.claude?.subagentTarget ||
      current.advancedModelMapping.claude?.reasoningEffort ||
      current.advancedModelMapping.codex?.commandLineModelOverride ||
      current.advancedModelMapping.codex?.reasoningEffort ||
      current.cwd ||
      current.command_base ||
      current.settings_file ||
      current.extra_args ||
      Object.keys(current.extra_env ?? {}).length > 0 ||
      current.exclude_user_settings !== true,
    );
  }

  return (
    current.name !== baseline.name ||
    current.url !== baseline.url ||
    current.key !== baseline.key ||
    current.selectedModelId !== baseline.selectedModelId ||
    !advancedModelMappingsEqual(current.advancedModelMapping, baseline.advancedModelMapping) ||
    !profilePermissionsEqual(current.permissions, baseline.permissions) ||
    current.balanceSessionSelection !== baseline.balanceSessionSelection ||
    !balanceSessionDraftsEqual(current.balanceSessionDraft, baseline.balanceSessionDraft) ||
    current.cwd !== baseline.cwd ||
    current.command_base !== baseline.command_base ||
    current.settings_file !== baseline.settings_file ||
    current.extra_args !== baseline.extra_args ||
      !envMapsEqual(current.extra_env, baseline.extra_env) ||
    current.exclude_user_settings !== baseline.exclude_user_settings
  );
}

export function hasOnlyProfileDraftCwdChange(
  current: ProfileEditorDraft,
  baseline: ProfileEditorDraft | null,
): boolean {
  if (!baseline || current.cwd === baseline.cwd) {
    return false;
  }

  return !hasProfileDraftChanges({ ...current, cwd: baseline.cwd }, baseline);
}

export function hasOnlyProfileDraftSelectedModelIdChange(
  current: ProfileEditorDraft,
  baseline: ProfileEditorDraft | null,
): boolean {
  if (!baseline || current.selectedModelId === baseline.selectedModelId) {
    return false;
  }

  return !hasProfileDraftChanges(
    { ...current, selectedModelId: baseline.selectedModelId },
    baseline,
  );
}

export function hasOnlyProfileDraftReasoningEffortChange(
  current: ProfileEditorDraft,
  baseline: ProfileEditorDraft | null,
): boolean {
  if (!baseline) {
    return false;
  }
  const currentClaudeEffort = current.advancedModelMapping.claude?.reasoningEffort ?? "";
  const baselineClaudeEffort = baseline.advancedModelMapping.claude?.reasoningEffort ?? "";
  const currentCodexEffort = current.advancedModelMapping.codex?.reasoningEffort ?? "";
  const baselineCodexEffort = baseline.advancedModelMapping.codex?.reasoningEffort ?? "";
  if (
    currentClaudeEffort === baselineClaudeEffort
    && currentCodexEffort === baselineCodexEffort
  ) {
    return false;
  }

  return !hasProfileDraftChanges(
    {
      ...current,
      advancedModelMapping: {
        ...current.advancedModelMapping,
        claude: {
          ...current.advancedModelMapping.claude,
          reasoningEffort: baselineClaudeEffort,
        },
        codex: {
          ...current.advancedModelMapping.codex,
          reasoningEffort: baselineCodexEffort,
        },
      },
    },
    baseline,
  );
}

export function hasOnlyProfileDraftBalanceSessionChange(
  current: ProfileEditorDraft,
  baseline: ProfileEditorDraft | null,
): boolean {
  if (
    !baseline
    || (
      current.balanceSessionSelection === baseline.balanceSessionSelection
      && balanceSessionDraftsEqual(current.balanceSessionDraft, baseline.balanceSessionDraft)
    )
  ) {
    return false;
  }

  return !hasProfileDraftChanges(
    {
      ...current,
      balanceSessionSelection: baseline.balanceSessionSelection,
      balanceSessionDraft: { ...baseline.balanceSessionDraft },
    },
    baseline,
  );
}

function advancedModelMappingsEqual(left: AdvancedModelMapping, right: AdvancedModelMapping): boolean {
  return left.enabled === right.enabled
    && (left.claude?.aliasMode ?? "none") === (right.claude?.aliasMode ?? "none")
    && (left.claude?.defaultTarget ?? "") === (right.claude?.defaultTarget ?? "")
    && (left.claude?.opusTarget ?? "") === (right.claude?.opusTarget ?? "")
    && (left.claude?.sonnetTarget ?? "") === (right.claude?.sonnetTarget ?? "")
    && (left.claude?.haikuTarget ?? "") === (right.claude?.haikuTarget ?? "")
    && (left.claude?.subagentTarget ?? "") === (right.claude?.subagentTarget ?? "")
    && (left.claude?.reasoningEffort ?? "") === (right.claude?.reasoningEffort ?? "")
    && (left.codex?.commandLineModelOverride ?? "") === (right.codex?.commandLineModelOverride ?? "")
    && (left.codex?.reasoningEffort ?? "") === (right.codex?.reasoningEffort ?? "");
}

function profilePermissionsEqual(left: ProfilePermissions | null, right: ProfilePermissions | null): boolean {
  if (left === null || right === null) {
    return left === right;
  }

  if (left.provider !== right.provider || !commonPermissionsEqual(left.common, right.common)) {
    return false;
  }
  if ((left.fullAccessConfirmed ?? false) !== (right.fullAccessConfirmed ?? false)) {
    return false;
  }
  if (left.provider === "codex" && right.provider === "codex") {
    return left.sandboxMode === right.sandboxMode
      && left.approvalPolicy === right.approvalPolicy;
  }
  if (left.provider === "claude" && right.provider === "claude") {
    return left.mode === right.mode;
  }
  return false;
}

function commonPermissionsEqual(left: ProfilePermissions["common"], right: ProfilePermissions["common"]): boolean {
  return left.denyEnvFiles === right.denyEnvFiles
    && left.denyGitPush === right.denyGitPush
    && left.denyDangerousDelete === right.denyDangerousDelete
    && left.allowNetwork === right.allowNetwork
    && stringArraysEqual(left.additionalWritableRoots, right.additionalWritableRoots);
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((item, index) => item === right[index]);
}

function envMapsEqual(left?: Record<string, string> | null, right?: Record<string, string> | null): boolean {
  const leftEntries = Object.entries(left ?? {});
  const rightMap = right ?? {};
  const rightEntries = Object.entries(rightMap);
  if (leftEntries.length !== rightEntries.length) {
    return false;
  }
  return leftEntries.every(([key, value]) => rightMap[key] === value);
}

function cloneEnvMap(value?: Record<string, string>): Record<string, string> {
  return { ...(value ?? {}) };
}

export function balanceSessionDraftsEqual(
  left: ProfileEditorDraft["balanceSessionDraft"],
  right: ProfileEditorDraft["balanceSessionDraft"],
): boolean {
  return (left.label ?? "") === (right.label ?? "")
    && (left.access_token ?? "") === (right.access_token ?? "")
    && (left.user_id ?? "") === (right.user_id ?? "");
}

function cloneAdvancedModelMapping(value?: AdvancedModelMapping): AdvancedModelMapping {
  return {
    enabled: value?.enabled ?? false,
    claude: {
      aliasMode: value?.claude?.aliasMode ?? "none",
      reasoningEffort: normalizeClaudeReasoningEffort(value?.claude?.reasoningEffort),
      defaultTarget: value?.claude?.defaultTarget ?? "",
      opusTarget: value?.claude?.opusTarget ?? "",
      sonnetTarget: value?.claude?.sonnetTarget ?? "",
      haikuTarget: value?.claude?.haikuTarget ?? "",
      subagentTarget: value?.claude?.subagentTarget ?? "",
    },
    codex: {
      commandLineModelOverride: value?.codex?.commandLineModelOverride ?? "",
      reasoningEffort: normalizeCodexReasoningEffort(value?.codex?.reasoningEffort),
    },
  };
}
