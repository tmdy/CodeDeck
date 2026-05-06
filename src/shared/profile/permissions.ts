import type { ProviderID } from "./types.js";

export const PERMISSION_PRESETS = [
  "readonly",
  "safe",
  "auto_edit",
  "strict_whitelist",
  "full_access",
] as const;

export type PermissionPreset = typeof PERMISSION_PRESETS[number];

export interface CommonPermissionSettings {
  denyEnvFiles: boolean;
  denyGitPush: boolean;
  denyDangerousDelete: boolean;
  allowNetwork: boolean;
  additionalWritableRoots: string[];
}

export interface ClaudePermissionSettings {
  permissionMode?: string;
}

export interface CodexPermissionSettings {
  sandboxMode?: string;
  approvalPolicy?: string;
}

export interface ProfilePermissions {
  preset: PermissionPreset;
  common: CommonPermissionSettings;
  claude?: ClaudePermissionSettings;
  codex?: CodexPermissionSettings;
  fullAccessConfirmed?: boolean;
}

export interface ResolveEffectivePermissionsOptions {
  provider: ProviderID | string;
  globalPermissions?: ProfilePermissions;
  profilePermissions?: ProfilePermissions;
  temporaryPreset?: PermissionPreset;
}

export interface CodexPermissionConfig {
  sandboxMode: "read-only" | "workspace-write" | "danger-full-access";
  approvalPolicy: "on-request" | "untrusted" | "never";
}

export function defaultCommonPermissions(): CommonPermissionSettings {
  return {
    denyEnvFiles: true,
    denyGitPush: true,
    denyDangerousDelete: true,
    allowNetwork: true,
    additionalWritableRoots: [],
  };
}

export function defaultProfilePermissions(_provider: ProviderID | string): ProfilePermissions {
  return {
    preset: "safe",
    common: defaultCommonPermissions(),
    claude: {},
    codex: {},
    fullAccessConfirmed: false,
  };
}

export function isPermissionPreset(value: unknown): value is PermissionPreset {
  return typeof value === "string" && (PERMISSION_PRESETS as readonly string[]).includes(value);
}

export function normalizeProfilePermissions(
  permissions: (Partial<Omit<ProfilePermissions, "common">> & { common?: Partial<CommonPermissionSettings> }) | undefined,
  provider: ProviderID | string,
): ProfilePermissions {
  const defaults = defaultProfilePermissions(provider);
  const common = permissions?.common ?? {} as Partial<CommonPermissionSettings>;
  const additionalWritableRoots = Array.isArray(common.additionalWritableRoots)
    ? common.additionalWritableRoots
      .map((item) => item.trim())
      .filter(Boolean)
    : [];

  return {
    preset: isPermissionPreset(permissions?.preset) ? permissions.preset : defaults.preset,
    common: {
      denyEnvFiles: common.denyEnvFiles ?? defaults.common.denyEnvFiles,
      denyGitPush: common.denyGitPush ?? defaults.common.denyGitPush,
      denyDangerousDelete: common.denyDangerousDelete ?? defaults.common.denyDangerousDelete,
      allowNetwork: common.allowNetwork ?? defaults.common.allowNetwork,
      additionalWritableRoots,
    },
    claude: { ...(permissions?.claude ?? {}) },
    codex: { ...(permissions?.codex ?? {}) },
    fullAccessConfirmed: permissions?.fullAccessConfirmed ?? false,
  };
}

export function resolveEffectivePermissions(options: ResolveEffectivePermissionsOptions): ProfilePermissions {
  const base = normalizeProfilePermissions(
    options.profilePermissions ?? options.globalPermissions,
    options.provider,
  );
  if (!options.temporaryPreset) {
    return base;
  }
  return normalizeProfilePermissions({
    ...base,
    preset: options.temporaryPreset,
    fullAccessConfirmed: options.temporaryPreset === "full_access" ? true : base.fullAccessConfirmed,
  }, options.provider);
}

export function toClaudePermissionMode(preset: PermissionPreset): string {
  switch (preset) {
    case "readonly":
      return "plan";
    case "safe":
      return "default";
    case "auto_edit":
      return "acceptEdits";
    case "strict_whitelist":
      return "dontAsk";
    case "full_access":
      return "bypassPermissions";
  }
}

export function toCodexPermissionConfig(preset: PermissionPreset): CodexPermissionConfig {
  switch (preset) {
    case "readonly":
      return { sandboxMode: "read-only", approvalPolicy: "on-request" };
    case "safe":
      return { sandboxMode: "workspace-write", approvalPolicy: "on-request" };
    case "auto_edit":
      return { sandboxMode: "workspace-write", approvalPolicy: "untrusted" };
    case "strict_whitelist":
      return { sandboxMode: "read-only", approvalPolicy: "never" };
    case "full_access":
      return { sandboxMode: "danger-full-access", approvalPolicy: "never" };
  }
}

export function permissionPresetFromLegacyLabel(value: unknown): PermissionPreset | undefined {
  if (isPermissionPreset(value)) {
    return value;
  }
  const label = typeof value === "string" ? value.trim() : "";
  if (!label) {
    return undefined;
  }
  const normalized = label.toLowerCase();
  if (normalized.includes("只读") || normalized.includes("readonly")) return "readonly";
  if (normalized.includes("严格") || normalized.includes("白名单") || normalized.includes("strict")) return "strict_whitelist";
  if (normalized.includes("自动") || normalized.includes("auto")) return "auto_edit";
  if (normalized.includes("全权限") || normalized.includes("full") || normalized.includes("bypass")) return "full_access";
  if (normalized.includes("全部允许") || normalized.includes("推荐") || normalized.includes("safe")) return "safe";
  return undefined;
}

export function summarizePermissions(provider: ProviderID | string, permissions: ProfilePermissions): string {
  if (provider === "codex") {
    const codex = toCodexPermissionConfig(permissions.preset);
    return `Codex: ${codex.sandboxMode} + ${codex.approvalPolicy}`;
  }
  return `Claude: ${toClaudePermissionMode(permissions.preset)}`;
}

export function requiresFullAccessConfirmation(permissions: ProfilePermissions): boolean {
  return permissions.preset === "full_access" && permissions.fullAccessConfirmed !== true;
}
