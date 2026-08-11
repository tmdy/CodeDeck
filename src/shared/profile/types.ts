// Profile 领域模型 — 翻译自 Go internal/domain/profile/
// 与 Go/Python 版本的 Profile 结构完全兼容

import {
  normalizeLaunchMode as normalizeLaunchModeValue,
  type LaunchMode,
} from "./launch-mode.js";
import { normalizeThemeMode, type ThemeMode } from "../theme.js";
import {
  normalizeGlobalPermissions,
  normalizeProfilePermissions,
  type GlobalPermissions,
  type GlobalPermissionsInput,
  type ProfilePermissionsInput,
} from "./permissions.js";

export const PROVIDER_CLAUDE = "claude" as const;
export const PROVIDER_CODEX = "codex" as const;
export const DEFAULT_PROVIDER = PROVIDER_CLAUDE;
export const DEFAULT_CLAUDE_COMMAND = "claude";
export const DEFAULT_CODEX_COMMAND = "codex";
export const OFFICIAL_CLAUDE_PROFILE_NAME = "官方 Claude";
export const OFFICIAL_CODEX_PROFILE_NAME = "官方 Codex";
export const DEFAULT_LAUNCH_MODE = "new";
export const DEFAULT_PERMISSION_PRESET = "全部允许（推荐）";
export const KEY_SEPARATOR = "::";

export type ProviderID = typeof PROVIDER_CLAUDE | typeof PROVIDER_CODEX;
export type ProfileKey = string; // "provider::name"
export type RuntimeTerminalMode = "direct" | "monitored";
export type RuntimeStartupMode = "managed" | "native";

export type ClaudeModelAliasMode = "none" | "single_model_compat" | "custom";
export const CLAUDE_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const CODEX_REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type ClaudeReasoningEffort = (typeof CLAUDE_REASONING_EFFORTS)[number];
export type CodexReasoningEffort = (typeof CODEX_REASONING_EFFORTS)[number];

export interface ClaudeAdvancedModelMapping {
  aliasMode?: ClaudeModelAliasMode;
  reasoningEffort?: ClaudeReasoningEffort | "";
  defaultTarget?: string;
  opusTarget?: string;
  sonnetTarget?: string;
  haikuTarget?: string;
  subagentTarget?: string;
}

export interface CodexAdvancedModelMapping {
  subagentTarget?: string;
  reasoningEffort?: CodexReasoningEffort | "";
}

export interface AdvancedModelMapping {
  enabled: boolean;
  claude?: ClaudeAdvancedModelMapping;
  codex?: CodexAdvancedModelMapping;
}

export interface ProfileChannel {
  id: string;
  name: string;
  key: string;
  selectedModelId?: string;
  models?: string[];
  modelsFetchedAt?: string;
  modelsBaseUrl?: string;
}

export interface Profile {
  provider: ProviderID;
  name: string;
  url: string;  // Base URL
  key: string;  // 活动渠道 Key；保留用于旧配置和既有调用方兼容
  selectedModelId?: string;
  channels?: ProfileChannel[];
  activeChannelId?: string;
  advancedModelMapping?: AdvancedModelMapping;
  permissions?: ProfilePermissionsInput;
  balance_session_id?: string;
}
export type { LaunchMode } from "./launch-mode.js";

export interface RuntimeSettings {
  cwd: string;
  command_base: string;
  model: string; // 兼容旧状态，仅作为 selectedModelId 迁移回退字段
  settings_file?: string;
  launch_mode: LaunchMode;
  terminal_mode?: RuntimeTerminalMode;
  extra_args: string;
  extra_env: Record<string, string>;
  exclude_user_settings: boolean;
  startup_mode?: RuntimeStartupMode;
}

export interface GlobalSettings {
  proxy: string;
  theme_mode: ThemeMode;
  hide_codex_subagent_sessions: boolean;
  permissions: GlobalPermissions;
  permissions_preset?: string;
}

// ---- 标准化函数 ----

export function normalizeProvider(raw: string): ProviderID {
  const lowered = raw.trim().toLowerCase();
  if (lowered === PROVIDER_CODEX) return PROVIDER_CODEX;
  return PROVIDER_CLAUDE;
}

export function normalizeProfile(profile: Profile): Profile {
  const legacySelectedModelId = normalizeSelectedModelId(profile);
  const channels = isOfficialNativeProfile(profile)
    ? []
    : normalizeProfileChannels(
        profile.channels,
        profile.key,
        legacySelectedModelId,
      );
  const requestedActiveChannelId = profile.activeChannelId?.trim() ?? "";
  const activeChannel = channels.find((channel) => channel.id === requestedActiveChannelId)
    ?? channels[0];
  return {
    provider: normalizeProvider(profile.provider),
    name: profile.name.trim(),
    url: profile.url.trim(),
    key: activeChannel?.key ?? "",
    selectedModelId: activeChannel?.selectedModelId ?? "",
    channels,
    activeChannelId: activeChannel?.id,
    advancedModelMapping: normalizeAdvancedModelMapping(profile.advancedModelMapping),
    permissions: profile.permissions
      ? normalizeProfilePermissions(profile.permissions, profile.provider)
      : undefined,
    balance_session_id: profile.balance_session_id?.trim() || undefined,
  };
}

/** 提取可同步字段（不含运行时数据），用于加密存储 */
export function extractSyncedProfile(profile: Profile): Profile {
  const n = normalizeProfile(profile);
  return {
    provider: n.provider,
    name: n.name,
    url: n.url,
    key: n.key,
    selectedModelId: n.selectedModelId,
    channels: n.channels?.map(cloneProfileChannel),
    activeChannelId: n.activeChannelId,
    advancedModelMapping: n.advancedModelMapping,
    permissions: n.permissions,
    balance_session_id: n.balance_session_id,
  };
}

export function normalizeLaunchMode(mode: string): LaunchMode {
  return normalizeLaunchModeValue(mode);
}

export function defaultRuntimeSettings(providerID: string): RuntimeSettings {
  const provider = normalizeProvider(providerID);
  return {
    cwd: "",
    command_base: provider === PROVIDER_CODEX ? DEFAULT_CODEX_COMMAND : DEFAULT_CLAUDE_COMMAND,
    model: "",
    settings_file: "",
    launch_mode: DEFAULT_LAUNCH_MODE,
    extra_args: "",
    extra_env: {},
    exclude_user_settings: true,
  };
}

export function normalizeRuntimeSettings(settings: RuntimeSettings, providerID: string): RuntimeSettings {
  const defaults = defaultRuntimeSettings(providerID);
  const terminalMode = normalizeRuntimeTerminalMode(settings.terminal_mode);
  const startupMode = normalizeRuntimeStartupMode(settings.startup_mode);
  return {
    cwd: settings.cwd.trim(),
    command_base: settings.command_base.trim() || defaults.command_base,
    model: settings.model?.trim() ?? "",
    settings_file: settings.settings_file?.trim() ?? defaults.settings_file,
    launch_mode: normalizeLaunchMode(settings.launch_mode),
    ...(terminalMode ? { terminal_mode: terminalMode } : {}),
    extra_args: settings.extra_args.trim(),
    extra_env: normalizeRuntimeEnv(settings.extra_env),
    exclude_user_settings: settings.exclude_user_settings ?? defaults.exclude_user_settings,
    ...(startupMode === "native" ? { startup_mode: startupMode } : {}),
  };
}

export function officialNativeProfileName(providerID: string): string {
  return normalizeProvider(providerID) === PROVIDER_CODEX
    ? OFFICIAL_CODEX_PROFILE_NAME
    : OFFICIAL_CLAUDE_PROFILE_NAME;
}

export function createOfficialNativeProfile(providerID: string): Profile {
  const provider = normalizeProvider(providerID);
  return {
    provider,
    name: officialNativeProfileName(provider),
    url: "",
    key: "",
    channels: [],
  };
}

export function normalizeProfileChannels(
  value: unknown,
  legacyKey: string = "",
  legacySelectedModelId: string = "",
): ProfileChannel[] {
  const rawChannels = Array.isArray(value) ? value : [];
  const seenIds = new Set<string>();
  const channels = rawChannels.flatMap((raw, index): ProfileChannel[] => {
    if (!raw || typeof raw !== "object") {
      return [];
    }
    const candidate = raw as Partial<ProfileChannel>;
    const requestedId = typeof candidate.id === "string" ? candidate.id.trim() : "";
    let id = requestedId || `channel-${index + 1}`;
    let suffix = 2;
    while (seenIds.has(id)) {
      id = `${requestedId || `channel-${index + 1}`}-${suffix}`;
      suffix += 1;
    }
    seenIds.add(id);
    const selectedModelId = typeof candidate.selectedModelId === "string"
      ? candidate.selectedModelId.trim()
      : "";
    const models = normalizeChannelModels(candidate.models);
    const modelsFetchedAt = typeof candidate.modelsFetchedAt === "string"
      ? candidate.modelsFetchedAt.trim()
      : "";
    const modelsBaseUrl = typeof candidate.modelsBaseUrl === "string"
      ? candidate.modelsBaseUrl.trim()
      : "";
    return [{
      id,
      name: typeof candidate.name === "string" ? candidate.name.trim() : "",
      key: typeof candidate.key === "string" ? candidate.key.trim() : "",
      ...(selectedModelId ? { selectedModelId } : {}),
      ...(models.length > 0 ? { models } : {}),
      ...(modelsFetchedAt ? { modelsFetchedAt } : {}),
      ...(modelsBaseUrl ? { modelsBaseUrl } : {}),
    }];
  });

  if (channels.length > 0) {
    return channels;
  }
  const key = legacyKey.trim();
  const selectedModelId = legacySelectedModelId.trim();
  return [{
    id: "default",
    name: "默认渠道",
    key,
    ...(selectedModelId ? { selectedModelId } : {}),
  }];
}

export function getActiveProfileChannel(profile: Profile): ProfileChannel {
  const normalized = normalizeProfile(profile);
  return normalized.channels?.find((channel) => channel.id === normalized.activeChannelId)
    ?? normalized.channels?.[0]
    ?? { id: "default", name: "默认渠道", key: "" };
}

export function getProfileApiKey(profile: Profile): string {
  return getActiveProfileChannel(profile).key;
}

export function getProfileSelectedModelId(profile: Profile): string {
  return getActiveProfileChannel(profile).selectedModelId ?? "";
}

function normalizeChannelModels(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(new Set(
    value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function cloneProfileChannel(channel: ProfileChannel): ProfileChannel {
  return {
    ...channel,
    ...(channel.models ? { models: [...channel.models] } : {}),
  };
}

export function isOfficialNativeProfile(profile: Pick<Profile, "provider" | "name">): boolean {
  return profile.name.trim() === officialNativeProfileName(profile.provider);
}

export function withOfficialNativeProfiles(profiles: Profile[]): Profile[] {
  const userProfiles = profiles.filter((profile) => !isOfficialNativeProfile(profile));
  return [
    createOfficialNativeProfile(PROVIDER_CLAUDE),
    createOfficialNativeProfile(PROVIDER_CODEX),
    ...userProfiles,
  ];
}

export function normalizeRuntimeTerminalMode(value: unknown): RuntimeTerminalMode | undefined {
  return value === "direct" || value === "monitored" ? value : undefined;
}

export function normalizeRuntimeStartupMode(value: unknown): RuntimeStartupMode {
  return value === "native" ? "native" : "managed";
}

export function normalizeRuntimeEnv(env?: Record<string, string>): Record<string, string> {
  if (!env) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(env)
      .map(([key, value]) => [key.trim(), value] as const)
      .filter(([key]) => key.length > 0),
  );
}

export function defaultGlobalSettings(): GlobalSettings {
  return {
    proxy: "",
    theme_mode: "system",
    hide_codex_subagent_sessions: true,
    permissions: normalizeGlobalPermissions(undefined),
  };
}

function normalizeSelectedModelId(profile: Profile): string {
  const candidates = [
    profile.selectedModelId,
    (profile as Profile & { targetModel?: string }).targetModel,
    (profile as Profile & { codexTargetModel?: string }).codexTargetModel,
    (profile as Profile & { claudeTargetModel?: string }).claudeTargetModel,
    (profile as Profile & { claudeModelAlias?: string }).claudeModelAlias,
    (profile as Profile & { defaultModelTarget?: string }).defaultModelTarget,
  ];
  const selected = candidates.find((value) => typeof value === "string" && value.trim());
  return selected?.trim() ?? "";
}

function normalizeAdvancedModelMapping(value?: AdvancedModelMapping): AdvancedModelMapping | undefined {
  if (!value) {
    return undefined;
  }
  const aliasMode = resolveClaudeModelAliasMode(value);
  const claudeReasoningEffort = normalizeClaudeReasoningEffort(value.claude?.reasoningEffort);
  const codexReasoningEffort = normalizeCodexReasoningEffort(value.codex?.reasoningEffort);
  const claude = value.claude ? {
    aliasMode,
    ...(claudeReasoningEffort ? { reasoningEffort: claudeReasoningEffort } : {}),
    defaultTarget: value.claude.defaultTarget?.trim() || undefined,
    opusTarget: value.claude.opusTarget?.trim() || undefined,
    sonnetTarget: value.claude.sonnetTarget?.trim() || undefined,
    haikuTarget: value.claude.haikuTarget?.trim() || undefined,
    subagentTarget: value.claude.subagentTarget?.trim() || undefined,
  } : undefined;
  const legacyCodex = value.codex as (CodexAdvancedModelMapping & { commandLineModelOverride?: string }) | undefined;
  const codex = value.codex ? {
    subagentTarget: value.codex.subagentTarget?.trim()
      || legacyCodex?.commandLineModelOverride?.trim()
      || undefined,
    ...(codexReasoningEffort ? { reasoningEffort: codexReasoningEffort } : {}),
  } : undefined;

  return {
    enabled: value.enabled ?? false,
    claude,
    codex,
  };
}

export function normalizeClaudeReasoningEffort(value: unknown): ClaudeReasoningEffort | "" {
  return normalizeReasoningEffort(value, CLAUDE_REASONING_EFFORTS);
}

export function normalizeCodexReasoningEffort(value: unknown): CodexReasoningEffort | "" {
  return normalizeReasoningEffort(value, CODEX_REASONING_EFFORTS);
}

function normalizeReasoningEffort<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | "" {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = value.trim().toLowerCase();
  return allowed.includes(normalized as T) ? normalized as T : "";
}

export function resolveClaudeModelAliasMode(value?: AdvancedModelMapping): ClaudeModelAliasMode {
  if (!value?.enabled) {
    return "none";
  }
  const rawMode = value.claude?.aliasMode;
  if (rawMode === "none" || rawMode === "single_model_compat" || rawMode === "custom") {
    return rawMode;
  }
  const hasLegacyTargets = Boolean(
    value.claude?.defaultTarget?.trim()
    || value.claude?.opusTarget?.trim()
    || value.claude?.sonnetTarget?.trim()
    || value.claude?.haikuTarget?.trim()
    || value.claude?.subagentTarget?.trim(),
  );
  return hasLegacyTargets ? "custom" : "none";
}

export function isOfficialAnthropicBaseUrl(baseUrl: string): boolean {
  try {
    const hostname = new URL(baseUrl.trim()).hostname.toLowerCase();
    return hostname === "api.anthropic.com" || hostname.endsWith(".anthropic.com");
  } catch {
    return false;
  }
}

export function isOfficialClaudeModelId(selectedModelId: string): boolean {
  return /^claude-(opus|sonnet|haiku)(?:[-.]|$)/.test(selectedModelId.trim().toLowerCase());
}

export function shouldRecommendClaudeSingleModelCompatibility(baseUrl: string, selectedModelId: string): boolean {
  const url = baseUrl.trim();
  const model = selectedModelId.trim().toLowerCase();
  if (!url || !model) {
    return false;
  }
  return !isOfficialClaudeModelId(model);
}

export function normalizeGlobalSettings(settings: Partial<GlobalSettings> & {
  permissions?: GlobalPermissionsInput;
  permissions_preset?: string;
}): GlobalSettings {
  const defaults = defaultGlobalSettings();
  return {
    proxy: settings.proxy?.trim() ?? defaults.proxy,
    theme_mode: normalizeThemeMode(settings.theme_mode),
    hide_codex_subagent_sessions: typeof settings.hide_codex_subagent_sessions === "boolean"
      ? settings.hide_codex_subagent_sessions
      : defaults.hide_codex_subagent_sessions,
    permissions: normalizeGlobalPermissions(settings.permissions) as GlobalPermissions,
  };
}
