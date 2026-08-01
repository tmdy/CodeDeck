import type { ManagementAuthorizationMode, ManagementCookieMode } from "./services/management-auth.js";

export const SITE_CAPABILITY_TTL_MS = 30 * 24 * 60 * 60 * 1_000;

export type LearnedBalanceFamily =
  | "new_api_family"
  | "one_api"
  | "one_hub_family"
  | "veloera"
  | "sub2api"
  | "aihubmix"
  | "voapi_v2"
  | "sharedchat";

export interface LearnedCheckinPath {
  platform: "management" | "voapi_v2";
  endpoint_path: "/api/user/checkin" | "/api/user/sign_in" | "/api/check_in";
  method: "GET" | "POST";
  authorization_mode: ManagementAuthorizationMode | "none";
  cookie_mode: ManagementCookieMode | "none";
  requires_user_id: boolean;
  learned_at: string;
  credential_updated_at: string;
}

export interface LearnedBalancePath {
  family: LearnedBalanceFamily;
  auth_mode: "bearer" | "session_cookie";
  cookie_mode?: ManagementCookieMode;
  learned_at: string;
  credential_updated_at: string;
  base_url: string;
}

export interface SiteCapabilityCache {
  checkin_by_account: Record<string, LearnedCheckinPath>;
  balance_by_target: Record<string, LearnedBalancePath>;
}

export function emptySiteCapabilityCache(): SiteCapabilityCache {
  return { checkin_by_account: {}, balance_by_target: {} };
}

export function normalizeSiteCapabilityCache(
  value: unknown,
  now: number = Date.now(),
): SiteCapabilityCache {
  const result = emptySiteCapabilityCache();
  const root = asRecord(value);
  if (!root) return result;

  const checkin = asRecord(root.checkin_by_account);
  for (const [key, raw] of Object.entries(checkin ?? {})) {
    const record = asRecord(raw);
    if (!record || !isFresh(record.learned_at, now)) continue;
    if (
      (record.platform !== "management" && record.platform !== "voapi_v2")
      || !isCheckinEndpoint(record.endpoint_path)
      || (record.method !== "GET" && record.method !== "POST")
      || !isAuthorizationMode(record.authorization_mode)
      || !isCookieMode(record.cookie_mode)
      || typeof record.requires_user_id !== "boolean"
      || typeof record.credential_updated_at !== "string"
    ) continue;
    result.checkin_by_account[key] = {
      platform: record.platform,
      endpoint_path: record.endpoint_path,
      method: record.method,
      authorization_mode: record.authorization_mode,
      cookie_mode: record.cookie_mode,
      requires_user_id: record.requires_user_id,
      learned_at: record.learned_at as string,
      credential_updated_at: record.credential_updated_at,
    };
  }

  const balance = asRecord(root.balance_by_target);
  for (const [key, raw] of Object.entries(balance ?? {})) {
    const record = asRecord(raw);
    if (!record || !isFresh(record.learned_at, now)) continue;
    if (
      !isBalanceFamily(record.family)
      || (record.auth_mode !== "bearer" && record.auth_mode !== "session_cookie")
      || (record.cookie_mode !== undefined && !isConcreteCookieMode(record.cookie_mode))
      || typeof record.credential_updated_at !== "string"
      || typeof record.base_url !== "string"
    ) continue;
    result.balance_by_target[key] = {
      family: record.family,
      auth_mode: record.auth_mode,
      ...(isConcreteCookieMode(record.cookie_mode) ? { cookie_mode: record.cookie_mode } : {}),
      learned_at: record.learned_at as string,
      credential_updated_at: record.credential_updated_at,
      base_url: record.base_url,
    };
  }
  return result;
}

export function isCapabilityPathCurrent(
  learnedAt: string,
  credentialUpdatedAt: string,
  currentCredentialUpdatedAt: string,
  now: number = Date.now(),
): boolean {
  return isFresh(learnedAt, now) && credentialUpdatedAt === currentCredentialUpdatedAt;
}

function isFresh(value: unknown, now: number): value is string {
  if (typeof value !== "string") return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp)
    && timestamp <= now + 60_000
    && now - timestamp <= SITE_CAPABILITY_TTL_MS;
}

function isCheckinEndpoint(value: unknown): value is LearnedCheckinPath["endpoint_path"] {
  return value === "/api/user/checkin" || value === "/api/user/sign_in" || value === "/api/check_in";
}

function isAuthorizationMode(value: unknown): value is LearnedCheckinPath["authorization_mode"] {
  return value === "raw" || value === "bearer" || value === "none";
}

function isConcreteCookieMode(value: unknown): value is ManagementCookieMode {
  return value === "raw" || value === "session_wrapped" || value === "token_wrapped";
}

function isCookieMode(value: unknown): value is LearnedCheckinPath["cookie_mode"] {
  return value === "none" || isConcreteCookieMode(value);
}

function isBalanceFamily(value: unknown): value is LearnedBalanceFamily {
  return new Set<LearnedBalanceFamily>([
    "new_api_family",
    "one_api",
    "one_hub_family",
    "veloera",
    "sub2api",
    "aihubmix",
    "voapi_v2",
    "sharedchat",
  ]).has(value as LearnedBalanceFamily);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}
