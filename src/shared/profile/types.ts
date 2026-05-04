// Profile 领域模型 — 翻译自 Go internal/domain/profile/
// 与 Go/Python 版本的 Profile 结构完全兼容

export const PROVIDER_CLAUDE = "claude" as const;
export const PROVIDER_CODEX = "codex" as const;
export const DEFAULT_PROVIDER = PROVIDER_CLAUDE;
export const DEFAULT_CLAUDE_COMMAND = "claude";
export const DEFAULT_CODEX_COMMAND = "codex";
export const DEFAULT_CODEX_MODEL = "gpt-5.4";
export const DEFAULT_LAUNCH_MODE = "direct";
export const DEFAULT_PERMISSION_PRESET = "全部允许（推荐）";
export const KEY_SEPARATOR = "::";

export type ProviderID = typeof PROVIDER_CLAUDE | typeof PROVIDER_CODEX;
export type ProfileKey = string; // "provider::name"

export interface Profile {
  provider: ProviderID;
  name: string;
  url: string;  // Base URL
  key: string;  // API Key / Token
}

export type LaunchMode = "direct" | "continue" | "resume_selected";

export interface RuntimeSettings {
  proxy: string;
  cwd: string;
  command_base: string;
  model: string;
  launch_mode: LaunchMode;
  extra_args: string;
  exclude_user_settings: boolean;
}

export interface GlobalSettings {
  proxy: string;
  disable_telemetry: boolean;
  disable_error_reporting: boolean;
  disable_nonessential_traffic: boolean;
  permissions_preset: string;
  include_co_authored_by: boolean;
}

// ---- 标准化函数 ----

export function normalizeProvider(raw: string): ProviderID {
  const lowered = raw.trim().toLowerCase();
  if (lowered === PROVIDER_CODEX) return PROVIDER_CODEX;
  return PROVIDER_CLAUDE;
}

export function normalizeProfile(profile: Profile): Profile {
  return {
    provider: normalizeProvider(profile.provider),
    name: profile.name.trim(),
    url: profile.url.trim(),
    key: profile.key.trim(),
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
  };
}

export function normalizeLaunchMode(mode: string): LaunchMode {
  switch (mode.trim()) {
    case "continue":
      return "continue";
    case "resume_selected":
      return "resume_selected";
    default:
      return DEFAULT_LAUNCH_MODE;
  }
}

export function defaultRuntimeSettings(providerID: string): RuntimeSettings {
  const provider = normalizeProvider(providerID);
  return {
    proxy: "",
    cwd: "",
    command_base: provider === PROVIDER_CODEX ? DEFAULT_CODEX_COMMAND : DEFAULT_CLAUDE_COMMAND,
    model: provider === PROVIDER_CODEX ? DEFAULT_CODEX_MODEL : "",
    launch_mode: DEFAULT_LAUNCH_MODE,
    extra_args: "",
    exclude_user_settings: true,
  };
}

export function normalizeRuntimeSettings(settings: RuntimeSettings, providerID: string): RuntimeSettings {
  const defaults = defaultRuntimeSettings(providerID);
  const provider = normalizeProvider(providerID);
  return {
    proxy: settings.proxy.trim(),
    cwd: settings.cwd.trim(),
    command_base: settings.command_base.trim() || defaults.command_base,
    model: settings.model.trim() || (provider === PROVIDER_CODEX ? DEFAULT_CODEX_MODEL : ""),
    launch_mode: normalizeLaunchMode(settings.launch_mode),
    extra_args: settings.extra_args.trim(),
    exclude_user_settings: settings.exclude_user_settings,
  };
}

export function defaultGlobalSettings(): GlobalSettings {
  return {
    proxy: "",
    disable_telemetry: true,
    disable_error_reporting: true,
    disable_nonessential_traffic: true,
    permissions_preset: DEFAULT_PERMISSION_PRESET,
    include_co_authored_by: false,
  };
}

export function normalizeGlobalSettings(settings: GlobalSettings): GlobalSettings {
  const defaults = defaultGlobalSettings();
  return {
    proxy: settings.proxy?.trim() ?? defaults.proxy,
    disable_telemetry: settings.disable_telemetry ?? defaults.disable_telemetry,
    disable_error_reporting: settings.disable_error_reporting ?? defaults.disable_error_reporting,
    disable_nonessential_traffic: settings.disable_nonessential_traffic ?? defaults.disable_nonessential_traffic,
    permissions_preset: settings.permissions_preset?.trim() || defaults.permissions_preset,
    include_co_authored_by: settings.include_co_authored_by ?? defaults.include_co_authored_by,
  };
}