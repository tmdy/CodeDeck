import type { Profile, ProfileKey } from "../profile/types.js";
import { normalizeProfile, normalizeRuntimeEnv } from "../profile/types.js";
import { itemKey, normalizeKeyWithFallback, splitKey } from "../profile/keys-internal.js";
import type { BalanceCheckState } from "./types.js";

const BASE_URL_SUFFIXES = [
  "/anthropic/v1/messages",
  "/v1/chat/completions",
  "/chat/completions",
  "/v1/messages",
  "/messages",
  "/completions",
  "/anthropic",
  "/v1",
] as const;

export interface SiteBalanceSession {
  id: string;
  label: string;
  base_url: string;
  access_token: string;
  /** How access_token is transported to management endpoints. */
  auth_kind?: SiteBalanceAuthKind;
  /** Opaque local reference to an Electron-owned persistent partition. */
  browser_session_id?: string;
  /** Stable global browser identity slot shared across Profiles. */
  browser_slot?: number;
  /** Exact origin bound to browser_session_id. */
  browser_origin?: string;
  refresh_token?: string;
  token_expires_at?: number;
  user_id: string;
  /** Missing in legacy configs; normalization always supplies false. */
  auto_checkin_enabled?: boolean;
  updated_at: string;
}

export interface SiteBalanceSessionDraft {
  id?: string;
  label: string;
  access_token: string;
  auth_kind?: SiteBalanceAuthKind;
  browser_session_id?: string;
  browser_slot?: number;
  browser_origin?: string;
  refresh_token?: string;
  token_expires_at?: number;
  user_id: string;
}

export type SiteBalanceAuthKind = "access_token" | "session_cookie" | "browser_session";

export interface BrowserIdentitySlot {
  slot: number;
  browser_session_id: string;
}

export function normalizeSiteBalanceAuthKind(value: unknown): SiteBalanceAuthKind {
  if (value === "session_cookie" || value === "browser_session") {
    return value;
  }
  return "access_token";
}

export function normalizeBrowserOrigin(value: string): string {
  const parsed = new URL(value.trim());
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("浏览器登录地址必须以 http:// 或 https:// 开头");
  }
  return parsed.origin;
}

export function normalizeBrowserSessionId(value: string): string {
  const normalized = value.trim();
  if (!/^[a-zA-Z0-9_-]+$/.test(normalized)) {
    throw new Error("浏览器会话引用无效");
  }
  return normalized;
}

export function normalizeBrowserSlot(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : undefined;
}

export type SiteBalanceSessionsByBaseUrl = Record<string, SiteBalanceSession[]>;

export interface EncryptedProfileConfig {
  profiles: Profile[];
  site_balance_sessions_by_base_url: SiteBalanceSessionsByBaseUrl;
  browser_identity_slots?: BrowserIdentitySlot[];
  runtime_env_by_profile?: Record<ProfileKey, Record<string, string>>;
  global_proxy?: string;
  protected_settings_version?: 1;
}

export type ResolvedBalanceAuth =
  | {
      kind: "none";
      base_url: string;
      reason: "no_session" | "missing_bound_session";
    }
  | {
      kind: "explicit_session";
      base_url: string;
      session: SiteBalanceSession;
    };

export function normalizeBalanceBaseUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }

  try {
    const parsed = new URL(trimmed);
    let pathname = parsed.pathname.replace(/\/+$/, "");

    let changed = true;
    while (changed && pathname) {
      changed = false;
      for (const suffix of BASE_URL_SUFFIXES) {
        if (pathname.toLowerCase().endsWith(suffix)) {
          pathname = pathname.slice(0, -suffix.length);
          pathname = pathname.replace(/\/+$/, "");
          changed = true;
          break;
        }
      }
    }

    parsed.pathname = pathname || "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

export function emptyEncryptedProfileConfig(): EncryptedProfileConfig {
  return {
    profiles: [],
    site_balance_sessions_by_base_url: {},
    browser_identity_slots: [],
    runtime_env_by_profile: {},
    global_proxy: "",
    protected_settings_version: 1,
  };
}

export function cloneSiteBalanceSessionsByBaseUrl(
  value: SiteBalanceSessionsByBaseUrl,
): SiteBalanceSessionsByBaseUrl {
  return Object.fromEntries(
    Object.entries(value).map(([baseUrl, sessions]) => [
      baseUrl,
      sessions.map((session) => ({ ...session })),
    ]),
  );
}

export function normalizeEncryptedProfileConfig(value: unknown): EncryptedProfileConfig {
  if (Array.isArray(value)) {
    return {
      profiles: value.map((profile) => normalizeProfile(profile as Profile)),
      site_balance_sessions_by_base_url: {},
      browser_identity_slots: [],
      runtime_env_by_profile: {},
      global_proxy: "",
    };
  }

  if (!value || typeof value !== "object") {
    return emptyEncryptedProfileConfig();
  }

  const record = value as {
    profiles?: unknown;
    site_balance_sessions_by_base_url?: unknown;
    browser_identity_slots?: unknown;
    runtime_env_by_profile?: unknown;
    global_proxy?: unknown;
    protected_settings_version?: unknown;
  };

  const reconciled = reconcileBrowserIdentitySlots(
    normalizeSiteBalanceSessionsByBaseUrl(record.site_balance_sessions_by_base_url),
    normalizeBrowserIdentitySlots(record.browser_identity_slots),
  );
  return {
    profiles: Array.isArray(record.profiles)
      ? record.profiles.map((profile) => normalizeProfile(profile as Profile))
      : [],
    site_balance_sessions_by_base_url: reconciled.sessionsByBaseUrl,
    browser_identity_slots: reconciled.slots,
    runtime_env_by_profile: normalizeRuntimeEnvByProfile(record.runtime_env_by_profile),
    global_proxy: typeof record.global_proxy === "string" ? record.global_proxy.trim() : "",
    protected_settings_version: record.protected_settings_version === 1 ? 1 : undefined,
  };
}

export function normalizeRuntimeEnvByProfile(
  value: unknown,
): Record<ProfileKey, Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: Record<ProfileKey, Record<string, string>> = {};
  for (const [rawKey, rawEnv] of Object.entries(value as Record<string, unknown>)) {
    const [provider] = splitKey(rawKey);
    const profileKey = normalizeKeyWithFallback(rawKey, provider);
    if (!profileKey || !rawEnv || typeof rawEnv !== "object" || Array.isArray(rawEnv)) {
      continue;
    }
    const env = normalizeRuntimeEnv(Object.fromEntries(
      Object.entries(rawEnv as Record<string, unknown>)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ));
    if (Object.keys(env).length > 0) {
      result[profileKey] = env;
    }
  }
  return result;
}

export function normalizeSiteBalanceSessionsByBaseUrl(value: unknown): SiteBalanceSessionsByBaseUrl {
  if (!value || typeof value !== "object") {
    return {};
  }

  const result: SiteBalanceSessionsByBaseUrl = {};
  for (const [rawBaseUrl, rawSessions] of Object.entries(value as Record<string, unknown>)) {
    const baseUrl = normalizeBalanceBaseUrl(rawBaseUrl);
    if (!baseUrl || !Array.isArray(rawSessions)) {
      continue;
    }
    const sessions = rawSessions
      .map((session) => normalizeSiteBalanceSession(session, baseUrl))
      .filter((session): session is SiteBalanceSession => session !== null);
    if (sessions.length > 0) {
      result[baseUrl] = withSequentialAccountLabels(sessions);
    }
  }
  return result;
}

export function normalizeSiteBalanceSessionDraft(
  draft: SiteBalanceSessionDraft,
): SiteBalanceSessionDraft {
  const authKind = normalizeSiteBalanceAuthKind(draft.auth_kind);
  const browserSessionId = draft.browser_session_id?.trim()
    ? normalizeBrowserSessionId(draft.browser_session_id)
    : undefined;
  const browserOrigin = draft.browser_origin?.trim()
    ? normalizeBrowserOrigin(draft.browser_origin)
    : undefined;
  const browserSlot = normalizeBrowserSlot(draft.browser_slot);
  return {
    id: draft.id?.trim() || undefined,
    label: draft.label.trim(),
    access_token: authKind === "browser_session" ? "" : draft.access_token.trim(),
    auth_kind: authKind,
    ...(browserSessionId
      ? { browser_session_id: browserSessionId }
      : {}),
    ...(browserSlot ? { browser_slot: browserSlot } : {}),
    ...(browserOrigin ? { browser_origin: browserOrigin } : {}),
    refresh_token: authKind === "browser_session" ? undefined : draft.refresh_token?.trim() || undefined,
    token_expires_at: authKind !== "browser_session"
      && Number.isFinite(draft.token_expires_at) && (draft.token_expires_at ?? 0) > 0
      ? draft.token_expires_at
      : undefined,
    user_id: draft.user_id.trim(),
  };
}

export function getSiteBalanceSessionsForBaseUrl(
  value: SiteBalanceSessionsByBaseUrl,
  rawUrl: string,
): SiteBalanceSession[] {
  const baseUrl = normalizeBalanceBaseUrl(rawUrl);
  const sessions = value[baseUrl] ?? [];
  return withSequentialAccountLabels(sessions);
}

export function resolveBalanceAuth(
  profile: Pick<Profile, "url" | "balance_session_id">,
  sessionsByBaseUrl: SiteBalanceSessionsByBaseUrl,
): ResolvedBalanceAuth {
  const baseUrl = normalizeBalanceBaseUrl(profile.url);
  const sessions = withSequentialAccountLabels(sessionsByBaseUrl[baseUrl] ?? []);
  const balanceSessionId = profile.balance_session_id?.trim() || "";

  if (balanceSessionId) {
    const matched = sessions.find((session) => session.id === balanceSessionId);
    if (matched) {
      return {
        kind: "explicit_session",
        base_url: baseUrl,
        session: { ...matched },
      };
    }
    return {
      kind: "none",
      base_url: baseUrl,
      reason: "missing_bound_session",
    };
  }

  return {
    kind: "none",
    base_url: baseUrl,
    reason: "no_session",
  };
}

export function describeBalanceSessionHint(
  profile: Pick<Profile, "url" | "balance_session_id">,
  sessionsByBaseUrl: SiteBalanceSessionsByBaseUrl,
): string {
  const resolved = resolveBalanceAuth(profile, sessionsByBaseUrl);

  if (resolved.kind === "explicit_session") {
    return `后台会话：${resolved.session.label}`;
  }
  if (resolved.kind === "none" && resolved.reason === "missing_bound_session") {
    return "后台会话：所绑定会话已被删除";
  }
  return "";
}

export function resolveSharedBalanceProfileKeys(
  profiles: Profile[],
  sourceProfileKey: ProfileKey,
  sessionsByBaseUrl: SiteBalanceSessionsByBaseUrl,
): ProfileKey[] {
  const sourceProfile = profiles.find((profile) => itemKey(profile) === sourceProfileKey);
  if (!sourceProfile) {
    return [];
  }

  const sourceScope = resolveShareableBalanceScope(sourceProfile, sessionsByBaseUrl);
  if (!sourceScope) {
    return [sourceProfileKey];
  }

  const sharedKeys = profiles.flatMap((profile) => {
    const key = itemKey(profile);
    const targetScope = resolveShareableBalanceScope(profile, sessionsByBaseUrl);
    return targetScope
      && targetScope.baseUrl === sourceScope.baseUrl
      && targetScope.sessionId === sourceScope.sessionId
      ? [key]
      : [];
  });

  return sourceFirstUniqueKeys(sourceProfileKey, sharedKeys);
}

export function buildProfileBalanceCheckState(
  profile: Pick<Profile, "provider" | "name" | "url">,
  state: BalanceCheckState,
): BalanceCheckState {
  return {
    ...state,
    provider: profile.provider,
    profile_name: profile.name,
    base_url: normalizeBalanceBaseUrl(profile.url),
    items: state.items.map((item) => ({ ...item })),
  };
}

function normalizeSiteBalanceSession(
  value: unknown,
  fallbackBaseUrl: string,
): SiteBalanceSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<SiteBalanceSession>;
  const id = record.id?.trim();
  const label = record.label?.trim();
  const accessToken = record.access_token?.trim();
  const authKind = normalizeSiteBalanceAuthKind(record.auth_kind);
  let browserSessionId: string | undefined;
  let browserOrigin: string | undefined;
  const browserSlot = normalizeBrowserSlot(record.browser_slot);
  try {
    browserSessionId = record.browser_session_id?.trim()
      ? normalizeBrowserSessionId(record.browser_session_id)
      : undefined;
    browserOrigin = record.browser_origin?.trim()
      ? normalizeBrowserOrigin(record.browser_origin)
      : undefined;
  } catch {
    return null;
  }
  const refreshToken = record.refresh_token?.trim() || undefined;
  const tokenExpiresAt = typeof record.token_expires_at === "number"
    && Number.isFinite(record.token_expires_at)
    && record.token_expires_at > 0
    ? record.token_expires_at
    : undefined;
  const userId = record.user_id?.trim() ?? "";
  const baseUrl = normalizeBalanceBaseUrl(record.base_url ?? fallbackBaseUrl);

  if (
    !id
    || !label
    || !baseUrl
    || (authKind === "browser_session"
      ? !browserSessionId || !browserOrigin || !userId
      : !accessToken)
  ) {
    return null;
  }

  return {
    id,
    label,
    base_url: baseUrl,
    access_token: authKind === "browser_session" ? "" : accessToken ?? "",
    auth_kind: authKind,
    ...(authKind === "browser_session" && browserSessionId
      ? { browser_session_id: browserSessionId }
      : {}),
    ...(authKind === "browser_session" && browserSlot
      ? { browser_slot: browserSlot }
      : {}),
    ...(authKind === "browser_session" && browserOrigin
      ? { browser_origin: browserOrigin }
      : {}),
    ...(authKind !== "browser_session" && refreshToken ? { refresh_token: refreshToken } : {}),
    ...(authKind !== "browser_session" && tokenExpiresAt ? { token_expires_at: tokenExpiresAt } : {}),
    user_id: userId,
    auto_checkin_enabled: record.auto_checkin_enabled === true,
    updated_at: record.updated_at?.trim() || "",
  };
}

function withSequentialAccountLabels(sessions: SiteBalanceSession[]): SiteBalanceSession[] {
  return sessions.map((session, index) => ({
    ...session,
    label: session.auth_kind === "browser_session" && session.browser_slot
      ? `账号${session.browser_slot}`
      : `账号${index + 1}`,
  }));
}

export function normalizeBrowserIdentitySlots(value: unknown): BrowserIdentitySlot[] {
  if (!Array.isArray(value)) return [];
  const bySlot = new Map<number, BrowserIdentitySlot>();
  const usedSessionIds = new Set<string>();
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const record = candidate as Partial<BrowserIdentitySlot>;
    const slot = normalizeBrowserSlot(record.slot);
    let browserSessionId: string;
    try {
      browserSessionId = typeof record.browser_session_id === "string"
        ? normalizeBrowserSessionId(record.browser_session_id)
        : "";
    } catch {
      continue;
    }
    if (!slot || !browserSessionId || bySlot.has(slot) || usedSessionIds.has(browserSessionId)) {
      continue;
    }
    bySlot.set(slot, { slot, browser_session_id: browserSessionId });
    usedSessionIds.add(browserSessionId);
  }
  return [...bySlot.values()].sort((left, right) => left.slot - right.slot);
}

export function allocateBrowserSlot(slots: ReadonlyArray<Pick<BrowserIdentitySlot, "slot">>): number {
  const used = new Set(slots.map((slot) => slot.slot));
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

export function reconcileBrowserIdentitySlots(
  sessionsByBaseUrl: SiteBalanceSessionsByBaseUrl,
  configuredSlots: BrowserIdentitySlot[],
): { sessionsByBaseUrl: SiteBalanceSessionsByBaseUrl; slots: BrowserIdentitySlot[] } {
  const slots = normalizeBrowserIdentitySlots(configuredSlots);
  const slotByNumber = new Map(slots.map((slot) => [slot.slot, slot]));
  const slotBySessionId = new Map(slots.map((slot) => [slot.browser_session_id, slot]));
  const sessions = cloneSiteBalanceSessionsByBaseUrl(sessionsByBaseUrl);

  for (const account of Object.values(sessions).flat()) {
    if (account.auth_kind !== "browser_session" || !account.browser_session_id) continue;
    const requestedSlot = normalizeBrowserSlot(account.browser_slot);
    let identitySlot = requestedSlot ? slotByNumber.get(requestedSlot) : undefined;
    if (identitySlot && identitySlot.browser_session_id !== account.browser_session_id) {
      identitySlot = undefined;
    }
    identitySlot ??= slotBySessionId.get(account.browser_session_id);
    if (!identitySlot) {
      const slot = requestedSlot && !slotByNumber.has(requestedSlot)
        ? requestedSlot
        : allocateBrowserSlot(slots);
      identitySlot = { slot, browser_session_id: account.browser_session_id };
      slots.push(identitySlot);
      slots.sort((left, right) => left.slot - right.slot);
      slotByNumber.set(slot, identitySlot);
      slotBySessionId.set(identitySlot.browser_session_id, identitySlot);
    }
    account.browser_slot = identitySlot.slot;
    account.browser_session_id = identitySlot.browser_session_id;
    account.label = `账号${identitySlot.slot}`;
  }

  return { sessionsByBaseUrl: sessions, slots };
}

function resolveShareableBalanceScope(
  profile: Pick<Profile, "url" | "balance_session_id">,
  sessionsByBaseUrl: SiteBalanceSessionsByBaseUrl,
): { baseUrl: string; sessionId: string } | null {
  const resolved = resolveBalanceAuth(profile, sessionsByBaseUrl);
  if (resolved.kind !== "explicit_session") {
    return null;
  }

  return {
    baseUrl: resolved.base_url,
    sessionId: resolved.session.id,
  };
}

function sourceFirstUniqueKeys(sourceProfileKey: ProfileKey, keys: ProfileKey[]): ProfileKey[] {
  const seen = new Set<ProfileKey>();
  const result: ProfileKey[] = [];
  for (const key of [sourceProfileKey, ...keys]) {
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(key);
  }
  return result;
}
