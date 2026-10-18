import type {
  AdvancedModelMapping,
  Profile,
  ProfileChannel,
  RuntimeSettings,
  RuntimeStartupMode,
} from "./profile/types.js";
import {
  defaultRuntimeSettings,
  getActiveProfileChannel,
  normalizeClaudeReasoningEffort,
  normalizeCodexReasoningEffort,
  normalizeProfile,
  shouldRecommendClaudeSingleModelCompatibility,
} from "./profile/types.js";
import { normalizeProfilePermissions, type ProfilePermissions } from "./profile/permissions.js";
import type { SiteBalanceAuthKind } from "./balance/site-balance-sessions.js";
import {
  cloneSiteCustomCompatibility,
  customCompatibilityEquals,
  type SiteCustomCompatibility,
} from "./services/custom-compatibility.js";

export interface ProfileEditorDraft {
  name: string;
  url: string;
  key: string;
  selectedModelId: string;
  channels?: ProfileChannel[];
  activeChannelId?: string;
  advancedModelMapping: AdvancedModelMapping;
  permissions: ProfilePermissions | null;
  balanceSessionSelection: string;
  balanceSessionDraft: {
    label: string;
    access_token: string;
    auth_kind?: SiteBalanceAuthKind;
    browser_session_id?: string;
    browser_slot?: number;
    browser_origin?: string;
    refresh_token?: string;
    token_expires_at?: number;
    user_id: string;
    custom_compatibility?: SiteCustomCompatibility | { enabled: false };
  };
  cwd: string;
  command_base: string;
  settings_file: string;
  launch_mode: "new";
  extra_args: string;
  extra_env: Record<string, string>;
  exclude_user_settings: boolean;
  startup_mode?: RuntimeStartupMode;
}

export function buildSelectedProfileDraft(
  profile: Profile,
  runtime: RuntimeSettings | undefined,
  provider: string,
  balanceSessionDraft?: {
    label?: string;
    access_token?: string;
    auth_kind?: SiteBalanceAuthKind;
    browser_session_id?: string;
    browser_slot?: number;
    browser_origin?: string;
    refresh_token?: string;
    token_expires_at?: number;
    user_id?: string;
    custom_compatibility?: SiteCustomCompatibility | { enabled: false };
  },
): ProfileEditorDraft {
  const baseRuntime = runtime ?? defaultRuntimeSettings(provider);
  const normalizedProfile = normalizeProfile(profile);
  const activeChannel = getActiveProfileChannel(normalizedProfile);
  return {
    name: profile.name,
    url: profile.url,
    key: activeChannel.key,
    selectedModelId: activeChannel.selectedModelId ?? baseRuntime.model ?? "",
    channels: normalizedProfile.channels?.map(cloneProfileChannel) ?? [],
    activeChannelId: normalizedProfile.activeChannelId ?? "",
    advancedModelMapping: cloneAdvancedModelMapping(profile.advancedModelMapping),
    permissions: profile.permissions ? normalizeProfilePermissions(profile.permissions, provider) : null,
    balanceSessionSelection: profile.balance_session_id ?? "auto",
    balanceSessionDraft: {
      label: balanceSessionDraft?.label ?? "",
      access_token: balanceSessionDraft?.access_token ?? "",
      ...(balanceSessionDraft?.auth_kind ? { auth_kind: balanceSessionDraft.auth_kind } : {}),
      ...(balanceSessionDraft?.browser_session_id
        ? { browser_session_id: balanceSessionDraft.browser_session_id }
        : {}),
      ...(balanceSessionDraft?.browser_slot
        ? { browser_slot: balanceSessionDraft.browser_slot }
        : {}),
      ...(balanceSessionDraft?.browser_origin
        ? { browser_origin: balanceSessionDraft.browser_origin }
        : {}),
      ...(balanceSessionDraft?.refresh_token
        ? { refresh_token: balanceSessionDraft.refresh_token }
        : {}),
      ...(balanceSessionDraft?.token_expires_at
        ? { token_expires_at: balanceSessionDraft.token_expires_at }
        : {}),
      user_id: balanceSessionDraft?.user_id ?? "",
      ...(balanceSessionDraft?.custom_compatibility?.enabled === false
        ? { custom_compatibility: { enabled: false as const } }
        : balanceSessionDraft?.custom_compatibility
          ? { custom_compatibility: cloneSiteCustomCompatibility(balanceSessionDraft.custom_compatibility) }
          : {}),
    },
    cwd: baseRuntime.cwd,
    command_base: baseRuntime.command_base,
    settings_file: baseRuntime.settings_file ?? "",
    launch_mode: "new",
    extra_args: baseRuntime.extra_args,
    extra_env: cloneEnvMap(baseRuntime.extra_env),
    exclude_user_settings: baseRuntime.exclude_user_settings,
    ...(baseRuntime.startup_mode ? { startup_mode: baseRuntime.startup_mode } : {}),
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
    channels: [{
      id: "default",
      name: "默认渠道",
      key: "",
      ...(selectedModelId ? { selectedModelId } : {}),
    }],
    activeChannelId: "default",
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
      auth_kind: "browser_session",
      user_id: "",
    },
    cwd: runtime.cwd,
    command_base: runtime.command_base,
    settings_file: runtime.settings_file ?? "",
    launch_mode: "new",
    extra_args: runtime.extra_args,
    extra_env: {},
    exclude_user_settings: runtime.exclude_user_settings,
    ...(runtime.startup_mode ? { startup_mode: runtime.startup_mode } : {}),
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
    ...(draft.startup_mode === "native" ? { startup_mode: "native" as const } : {}),
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
      !profileChannelsEqual(editorChannels(current), [{ id: "default", name: "默认渠道", key: "" }]) ||
      (current.activeChannelId ?? "default") !== "default" ||
      current.advancedModelMapping.enabled ||
      current.permissions !== null ||
      current.balanceSessionSelection !== "auto" ||
      current.balanceSessionDraft.label ||
      current.balanceSessionDraft.access_token ||
      current.balanceSessionDraft.user_id ||
      current.balanceSessionDraft.custom_compatibility?.enabled === true ||
      current.advancedModelMapping.claude?.defaultTarget ||
      current.advancedModelMapping.claude?.opusTarget ||
      current.advancedModelMapping.claude?.sonnetTarget ||
      current.advancedModelMapping.claude?.haikuTarget ||
      current.advancedModelMapping.claude?.subagentTarget ||
      current.advancedModelMapping.claude?.reasoningEffort ||
      current.advancedModelMapping.codex?.subagentTarget ||
      current.advancedModelMapping.codex?.reasoningEffort ||
      current.advancedModelMapping.codex?.subagentReasoningEffort ||
      current.cwd ||
      current.command_base ||
      current.settings_file ||
      current.extra_args ||
      Object.keys(current.extra_env ?? {}).length > 0 ||
      current.exclude_user_settings !== true ||
      current.startup_mode === "native",
    );
  }

  return (
    current.name !== baseline.name ||
    current.url !== baseline.url ||
    current.key !== baseline.key ||
    current.selectedModelId !== baseline.selectedModelId ||
    !profileChannelsEqual(editorChannels(current), editorChannels(baseline)) ||
    (current.activeChannelId ?? "default") !== (baseline.activeChannelId ?? "default") ||
    !advancedModelMappingsEqual(current.advancedModelMapping, baseline.advancedModelMapping) ||
    !profilePermissionsEqual(current.permissions, baseline.permissions) ||
    current.balanceSessionSelection !== baseline.balanceSessionSelection ||
    !balanceSessionDraftsEqual(current.balanceSessionDraft, baseline.balanceSessionDraft) ||
    current.cwd !== baseline.cwd ||
    current.command_base !== baseline.command_base ||
    current.settings_file !== baseline.settings_file ||
    current.extra_args !== baseline.extra_args ||
      !envMapsEqual(current.extra_env, baseline.extra_env) ||
    current.exclude_user_settings !== baseline.exclude_user_settings ||
    (current.startup_mode ?? "managed") !== (baseline.startup_mode ?? "managed")
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

  const currentChannels = editorChannels(current);
  const baselineChannels = editorChannels(baseline);
  const currentActiveChannelId = current.activeChannelId ?? currentChannels[0]?.id ?? "default";
  const baselineActiveChannelId = baseline.activeChannelId ?? baselineChannels[0]?.id ?? "default";
  const restoredChannels = currentChannels.map((channel) => channel.id === currentActiveChannelId
    ? {
        ...channel,
        selectedModelId: baselineChannels.find((item) => item.id === baselineActiveChannelId)
          ?.selectedModelId,
      }
    : channel);
  return !hasProfileDraftChanges({
    ...current,
    selectedModelId: baseline.selectedModelId,
    channels: restoredChannels,
  }, baseline);
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
  const currentCodexSubagentEffort = current.advancedModelMapping.codex?.subagentReasoningEffort ?? "";
  const baselineCodexSubagentEffort = baseline.advancedModelMapping.codex?.subagentReasoningEffort ?? "";
  if (
    currentClaudeEffort === baselineClaudeEffort
    && currentCodexEffort === baselineCodexEffort
    && currentCodexSubagentEffort === baselineCodexSubagentEffort
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
          subagentReasoningEffort: baselineCodexSubagentEffort,
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
    && (left.codex?.subagentTarget ?? "") === (right.codex?.subagentTarget ?? "")
    && (left.codex?.reasoningEffort ?? "") === (right.codex?.reasoningEffort ?? "")
    && (left.codex?.subagentReasoningEffort ?? "") === (right.codex?.subagentReasoningEffort ?? "");
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

function cloneProfileChannel(channel: ProfileChannel): ProfileChannel {
  return {
    ...channel,
    ...(channel.models ? { models: [...channel.models] } : {}),
  };
}

function profileChannelsEqual(left: ProfileChannel[], right: ProfileChannel[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function editorChannels(draft: Pick<ProfileEditorDraft, "channels" | "key" | "selectedModelId">): ProfileChannel[] {
  return draft.channels?.length
    ? draft.channels
    : [{
        id: "default",
        name: "默认渠道",
        key: draft.key,
        ...(draft.selectedModelId ? { selectedModelId: draft.selectedModelId } : {}),
      }];
}

export function balanceSessionDraftsEqual(
  left: ProfileEditorDraft["balanceSessionDraft"],
  right: ProfileEditorDraft["balanceSessionDraft"],
): boolean {
  return (left.label ?? "") === (right.label ?? "")
    && (left.access_token ?? "") === (right.access_token ?? "")
    && (left.auth_kind ?? "access_token") === (right.auth_kind ?? "access_token")
    && (left.browser_session_id ?? "") === (right.browser_session_id ?? "")
    && (left.browser_slot ?? 0) === (right.browser_slot ?? 0)
    && (left.browser_origin ?? "") === (right.browser_origin ?? "")
    && (left.refresh_token ?? "") === (right.refresh_token ?? "")
    && (left.token_expires_at ?? 0) === (right.token_expires_at ?? 0)
    && (left.user_id ?? "") === (right.user_id ?? "")
    && customCompatibilityDraftsEqual(left.custom_compatibility, right.custom_compatibility);
}

function customCompatibilityDraftsEqual(
  left: ProfileEditorDraft["balanceSessionDraft"]["custom_compatibility"],
  right: ProfileEditorDraft["balanceSessionDraft"]["custom_compatibility"],
): boolean {
  if (left?.enabled === false || right?.enabled === false) {
    return left?.enabled === right?.enabled;
  }
  return customCompatibilityEquals(left, right);
}

function cloneAdvancedModelMapping(value?: AdvancedModelMapping): AdvancedModelMapping {
  const legacyCodex = value?.codex as (AdvancedModelMapping["codex"] & { commandLineModelOverride?: string }) | undefined;
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
      subagentTarget: value?.codex?.subagentTarget ?? legacyCodex?.commandLineModelOverride ?? "",
      reasoningEffort: normalizeCodexReasoningEffort(value?.codex?.reasoningEffort),
      subagentReasoningEffort: normalizeCodexReasoningEffort(value?.codex?.subagentReasoningEffort),
    },
  };
}
