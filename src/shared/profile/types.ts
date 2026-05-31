// Profile 领域模型 — 翻译自 Go internal/domain/profile/
// 与 Go/Python 版本的 Profile 结构完全兼容

import {
  normalizeLaunchMode as normalizeLaunchModeValue,
  type LaunchMode,
} from "./launch-mode.js";
import { normalizeThemeMode, type ThemeMode } from "../theme.js";
import {
  normalizeProfilePermissions,
  permissionPresetFromLegacyLabel,
  type CommonPermissionSettings,
  type ProfilePermissions,
} from "./permissions.js";

export const PROVIDER_CLAUDE = "claude" as const;
export const PROVIDER_CODEX = "codex" as const;
export const DEFAULT_PROVIDER = PROVIDER_CLAUDE;
export const DEFAULT_CLAUDE_COMMAND = "claude";
export const DEFAULT_CODEX_COMMAND = "codex";
export const DEFAULT_LAUNCH_MODE = "new";
export const DEFAULT_PERMISSION_PRESET = "全部允许（推荐）";
export const KEY_SEPARATOR = "::";

export type ProviderID = typeof PROVIDER_CLAUDE | typeof PROVIDER_CODEX;
export type ProfileKey = string; // "provider::name"
export type ProfilePermissionsInput = Partial<Omit<ProfilePermissions, "common">> & {
  common?: Partial<CommonPermissionSettings>;
};

export type ClaudeModelAliasMode = "none" | "single_model_compat" | "custom";

export interface ClaudeAdvancedModelMapping {
  aliasMode?: ClaudeModelAliasMode;
  defaultTarget?: string;
  opusTarget?: string;
  sonnetTarget?: string;
  haikuTarget?: string;
  subagentTarget?: string;
}

export interface CodexAdvancedModelMapping {
  commandLineModelOverride?: string;
}

export interface AdvancedModelMapping {
  enabled: boolean;
  claude?: ClaudeAdvancedModelMapping;
  codex?: CodexAdvancedModelMapping;
}

export interface Profile {
  provider: ProviderID;
  name: string;
  url: string;  // Base URL
  key: string;  // API Key / Token
  selectedModelId?: string;
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
  extra_args: string;
  extra_env: Record<string, string>;
  exclude_user_settings: boolean;
}

export interface GlobalSettings {
  proxy: string;
  theme_mode: ThemeMode;
  disable_telemetry: boolean;
  disable_error_reporting: boolean;
  disable_nonessential_traffic: boolean;
  permissions?: ProfilePermissionsInput;
  permissions_preset?: string;
  include_co_authored_by: boolean;
}

// ---- 标准化函数 ----

export function normalizeProvider(raw: string): ProviderID {
  const lowered = raw.trim().toLowerCase();
  if (lowered === PROVIDER_CODEX) return PROVIDER_CODEX;
  return PROVIDER_CLAUDE;
}

export function normalizeProfile(profile: Profile): Profile {
  const selectedModelId = normalizeSelectedModelId(profile);
  return {
    provider: normalizeProvider(profile.provider),
    name: profile.name.trim(),
    url: profile.url.trim(),
    key: profile.key.trim(),
    selectedModelId,
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
  return {
    cwd: settings.cwd.trim(),
    command_base: settings.command_base.trim() || defaults.command_base,
    model: settings.model?.trim() ?? "",
    settings_file: settings.settings_file?.trim() ?? defaults.settings_file,
    launch_mode: normalizeLaunchMode(settings.launch_mode),
    extra_args: settings.extra_args.trim(),
    extra_env: normalizeRuntimeEnv(settings.extra_env),
    exclude_user_settings: settings.exclude_user_settings ?? defaults.exclude_user_settings,
  };
}

function normalizeRuntimeEnv(env?: Record<string, string>): Record<string, string> {
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
    disable_telemetry: true,
    disable_error_reporting: true,
    disable_nonessential_traffic: true,
    permissions: normalizeProfilePermissions({ preset: "safe" }, DEFAULT_PROVIDER),
    include_co_authored_by: false,
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
  const claude = value.claude ? {
    aliasMode,
    defaultTarget: value.claude.defaultTarget?.trim() || undefined,
    opusTarget: value.claude.opusTarget?.trim() || undefined,
    sonnetTarget: value.claude.sonnetTarget?.trim() || undefined,
    haikuTarget: value.claude.haikuTarget?.trim() || undefined,
    subagentTarget: value.claude.subagentTarget?.trim() || undefined,
  } : undefined;
  const codex = value.codex ? {
    commandLineModelOverride: value.codex.commandLineModelOverride?.trim() || undefined,
  } : undefined;

  return {
    enabled: value.enabled ?? false,
    claude,
    codex,
  };
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

export function normalizeGlobalSettings(settings: GlobalSettings): GlobalSettings {
  const defaults = defaultGlobalSettings();
  const preset = settings.permissions?.preset
    ?? permissionPresetFromLegacyLabel(settings.permissions_preset)
    ?? normalizeProfilePermissions(defaults.permissions, DEFAULT_PROVIDER).preset;
  return {
    proxy: settings.proxy?.trim() ?? defaults.proxy,
    theme_mode: normalizeThemeMode(settings.theme_mode),
    disable_telemetry: settings.disable_telemetry ?? defaults.disable_telemetry,
    disable_error_reporting: settings.disable_error_reporting ?? defaults.disable_error_reporting,
    disable_nonessential_traffic: settings.disable_nonessential_traffic ?? defaults.disable_nonessential_traffic,
    permissions: normalizeProfilePermissions({
      ...settings.permissions,
      preset,
    }, DEFAULT_PROVIDER),
    include_co_authored_by: settings.include_co_authored_by ?? defaults.include_co_authored_by,
  };
}
