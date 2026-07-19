import type { ProviderID } from "./types.js";

export const PERMISSION_PRESETS = [
  "readonly",
  "safe",
  "auto_edit",
  "strict_whitelist",
  "full_access",
] as const;

export type PermissionPreset = typeof PERMISSION_PRESETS[number];

export const CLAUDE_PERMISSION_MODES = [
  "plan",
  "manual",
  "acceptEdits",
  "dontAsk",
  "bypassPermissions",
] as const;

export type ClaudePermissionMode = typeof CLAUDE_PERMISSION_MODES[number];

export const CODEX_SANDBOX_MODES = [
  "read-only",
  "workspace-write",
  "danger-full-access",
] as const;

export type CodexSandboxMode = typeof CODEX_SANDBOX_MODES[number];

export const CODEX_APPROVAL_POLICIES = [
  "on-request",
  "untrusted",
  "never",
] as const;

export type CodexApprovalPolicy = typeof CODEX_APPROVAL_POLICIES[number];

export interface CommonPermissionSettings {
  denyEnvFiles: boolean;
  denyGitPush: boolean;
  denyDangerousDelete: boolean;
  allowNetwork: boolean;
  additionalWritableRoots: string[];
}

export interface ClaudeProfilePermissions {
  provider: "claude";
  mode: ClaudePermissionMode;
  common: CommonPermissionSettings;
  fullAccessConfirmed?: boolean;
}

export interface CodexProfilePermissions {
  provider: "codex";
  sandboxMode: CodexSandboxMode;
  approvalPolicy: CodexApprovalPolicy;
  common: CommonPermissionSettings;
  fullAccessConfirmed?: boolean;
}

export type ProfilePermissions = ClaudeProfilePermissions | CodexProfilePermissions;

export interface GlobalPermissions {
  claude: ClaudeProfilePermissions;
  codex: CodexProfilePermissions;
}

export interface ProfilePermissionsInput {
  provider?: "claude" | "codex" | string;
  mode?: string;
  sandboxMode?: string;
  approvalPolicy?: string;
  preset?: PermissionPreset;
  common?: Partial<CommonPermissionSettings>;
  claude?: { permissionMode?: string };
  codex?: { sandboxMode?: string; approvalPolicy?: string };
  fullAccessConfirmed?: boolean;
}

export interface GlobalPermissionsInput {
  provider?: "claude" | "codex" | string;
  mode?: string;
  sandboxMode?: string;
  approvalPolicy?: string;
  preset?: PermissionPreset;
  common?: Partial<CommonPermissionSettings>;
  fullAccessConfirmed?: boolean;
  claude?: ProfilePermissionsInput;
  codex?: ProfilePermissionsInput;
}

export interface ResolveEffectivePermissionsOptions {
  provider: ProviderID | string;
  globalPermissions?: GlobalPermissionsInput;
  profilePermissions?: ProfilePermissionsInput;
  temporaryPreset?: PermissionPreset;
}

export interface CodexPermissionConfig {
  sandboxMode: CodexSandboxMode;
  approvalPolicy: CodexApprovalPolicy;
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

export function defaultProfilePermissions(provider: ProviderID | string): ProfilePermissions {
  if (normalizePermissionProvider(provider) === "codex") {
    return {
      provider: "codex",
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
      common: defaultCommonPermissions(),
      fullAccessConfirmed: false,
    };
  }
  return {
    provider: "claude",
    mode: "manual",
    common: defaultCommonPermissions(),
    fullAccessConfirmed: false,
  };
}

export function defaultGlobalPermissions(): GlobalPermissions {
  return {
    claude: defaultProfilePermissions("claude") as ClaudeProfilePermissions,
    codex: defaultProfilePermissions("codex") as CodexProfilePermissions,
  };
}

export function isPermissionPreset(value: unknown): value is PermissionPreset {
  return typeof value === "string" && (PERMISSION_PRESETS as readonly string[]).includes(value);
}

export function isClaudePermissionMode(value: unknown): value is ClaudePermissionMode {
  return typeof value === "string" && (CLAUDE_PERMISSION_MODES as readonly string[]).includes(value);
}

export function isCodexSandboxMode(value: unknown): value is CodexSandboxMode {
  return typeof value === "string" && (CODEX_SANDBOX_MODES as readonly string[]).includes(value);
}

export function isCodexApprovalPolicy(value: unknown): value is CodexApprovalPolicy {
  return typeof value === "string" && (CODEX_APPROVAL_POLICIES as readonly string[]).includes(value);
}

export function normalizeProfilePermissions(
  permissions: ProfilePermissionsInput | undefined,
  provider: ProviderID | string,
): ProfilePermissions {
  const normalizedProvider = normalizePermissionProvider(provider);
  const defaults = defaultProfilePermissions(normalizedProvider);
  const record = asRecord(permissions);
  if (!record) {
    return defaults;
  }

  if (normalizedProvider === "codex") {
    if (!isCodexPermissionRecord(record)) {
      return defaults;
    }
    const sandboxMode = isCodexSandboxMode(record.sandboxMode)
      ? record.sandboxMode
      : (defaults as CodexProfilePermissions).sandboxMode;
    const approvalPolicy = isCodexApprovalPolicy(record.approvalPolicy)
      ? record.approvalPolicy
      : (defaults as CodexProfilePermissions).approvalPolicy;
    return {
      provider: "codex",
      sandboxMode,
      approvalPolicy,
      common: normalizeCommonPermissions(record.common, defaults.common),
      fullAccessConfirmed: record.fullAccessConfirmed === true,
    };
  }

  if (!isClaudePermissionRecord(record)) {
    return defaults;
  }
  const mode = isClaudePermissionMode(record.mode)
    ? record.mode
    : (defaults as ClaudeProfilePermissions).mode;
  return {
    provider: "claude",
    mode,
    common: normalizeCommonPermissions(record.common, defaults.common),
    fullAccessConfirmed: record.fullAccessConfirmed === true,
  };
}

export function normalizeGlobalPermissions(permissions: GlobalPermissionsInput | undefined): GlobalPermissions {
  const defaults = defaultGlobalPermissions();
  const record = asRecord(permissions);
  if (!record || (!("claude" in record) && !("codex" in record))) {
    return defaults;
  }

  return {
    claude: normalizeProfilePermissions(record.claude as ProfilePermissionsInput | undefined, "claude") as ClaudeProfilePermissions,
    codex: normalizeProfilePermissions(record.codex as ProfilePermissionsInput | undefined, "codex") as CodexProfilePermissions,
  };
}

export function resolveEffectivePermissions(options: ResolveEffectivePermissionsOptions): ProfilePermissions {
  const provider = normalizePermissionProvider(options.provider);
  const base = options.profilePermissions
    ? normalizeProfilePermissions(options.profilePermissions, provider)
    : getGlobalPermissionForProvider(options.globalPermissions, provider);
  if (!options.temporaryPreset) {
    return base;
  }
  return applyTemporaryPreset(base, options.temporaryPreset);
}

export function toClaudePermissionMode(permissions: ProfilePermissions | PermissionPreset | ClaudePermissionMode): ClaudePermissionMode {
  if (typeof permissions === "string") {
    if (isClaudePermissionMode(permissions)) {
      return permissions;
    }
    return legacyPresetToClaudeMode(permissions);
  }
  if (permissions.provider === "claude") {
    return permissions.mode;
  }
  return "manual";
}

export function toCodexPermissionConfig(permissions: ProfilePermissions | PermissionPreset): CodexPermissionConfig {
  if (typeof permissions === "string") {
    return legacyPresetToCodexConfig(permissions);
  }
  if (permissions.provider === "codex") {
    return {
      sandboxMode: permissions.sandboxMode,
      approvalPolicy: permissions.approvalPolicy,
    };
  }
  return {
    sandboxMode: "workspace-write",
    approvalPolicy: "on-request",
  };
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
  if (normalizePermissionProvider(provider) === "codex") {
    const codex = toCodexPermissionConfig(permissions);
    return `Codex: sandbox_mode=${codex.sandboxMode}; approval_policy=${codex.approvalPolicy}`;
  }
  return `Claude: --permission-mode ${toClaudePermissionMode(permissions)}`;
}

export function requiresFullAccessConfirmation(permissions: ProfilePermissions): boolean {
  if (permissions.provider === "claude") {
    return permissions.mode === "bypassPermissions" && permissions.fullAccessConfirmed !== true;
  }
  return permissions.sandboxMode === "danger-full-access" && permissions.fullAccessConfirmed !== true;
}

function normalizePermissionProvider(provider: ProviderID | string): "claude" | "codex" {
  return provider === "codex" ? "codex" : "claude";
}

function normalizeCommonPermissions(
  common: unknown,
  defaults = defaultCommonPermissions(),
): CommonPermissionSettings {
  const record = asRecord(common);
  const additionalWritableRoots = Array.isArray(record?.additionalWritableRoots)
    ? record.additionalWritableRoots
      .map((item) => typeof item === "string" ? item.trim() : "")
      .filter(Boolean)
    : [];

  return {
    denyEnvFiles: typeof record?.denyEnvFiles === "boolean" ? record.denyEnvFiles : defaults.denyEnvFiles,
    denyGitPush: typeof record?.denyGitPush === "boolean" ? record.denyGitPush : defaults.denyGitPush,
    denyDangerousDelete: typeof record?.denyDangerousDelete === "boolean" ? record.denyDangerousDelete : defaults.denyDangerousDelete,
    allowNetwork: typeof record?.allowNetwork === "boolean" ? record.allowNetwork : defaults.allowNetwork,
    additionalWritableRoots,
  };
}

function getGlobalPermissionForProvider(
  permissions: GlobalPermissionsInput | undefined,
  provider: "claude" | "codex",
): ProfilePermissions {
  const normalized = normalizeGlobalPermissions(permissions);
  return provider === "codex" ? normalized.codex : normalized.claude;
}

function applyTemporaryPreset(base: ProfilePermissions, preset: PermissionPreset): ProfilePermissions {
  if (base.provider === "codex") {
    const config = legacyPresetToCodexConfig(preset);
    return {
      ...base,
      ...config,
      fullAccessConfirmed: preset === "full_access" ? true : base.fullAccessConfirmed,
    };
  }
  return {
    ...base,
    mode: legacyPresetToClaudeMode(preset),
    fullAccessConfirmed: preset === "full_access" ? true : base.fullAccessConfirmed,
  };
}

function legacyPresetToClaudeMode(preset: PermissionPreset): ClaudePermissionMode {
  switch (preset) {
    case "readonly":
      return "plan";
    case "safe":
      return "manual";
    case "auto_edit":
      return "acceptEdits";
    case "strict_whitelist":
      return "dontAsk";
    case "full_access":
      return "bypassPermissions";
  }
}

function legacyPresetToCodexConfig(preset: PermissionPreset): CodexPermissionConfig {
  switch (preset) {
    case "readonly":
      return { sandboxMode: "read-only", approvalPolicy: "on-request" };
    case "safe":
      return { sandboxMode: "workspace-write", approvalPolicy: "on-request" };
    case "auto_edit":
      return { sandboxMode: "workspace-write", approvalPolicy: "untrusted" };
    case "strict_whitelist":
      return { sandboxMode: "workspace-write", approvalPolicy: "never" };
    case "full_access":
      return { sandboxMode: "danger-full-access", approvalPolicy: "never" };
  }
}

function isClaudePermissionRecord(record: Record<string, unknown>): boolean {
  return record.provider === "claude" || "mode" in record;
}

function isCodexPermissionRecord(record: Record<string, unknown>): boolean {
  return record.provider === "codex" || "sandboxMode" in record || "approvalPolicy" in record;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}
