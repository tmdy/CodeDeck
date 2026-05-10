import type { Profile, ProfileKey } from "../profile/types.js";
import { normalizeProfile } from "../profile/types.js";
import { itemKey } from "../profile/keys-internal.js";
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
  user_id: string;
  updated_at: string;
}

export interface SiteBalanceSessionDraft {
  id?: string;
  label: string;
  access_token: string;
  user_id: string;
}

export type SiteBalanceSessionsByBaseUrl = Record<string, SiteBalanceSession[]>;

export interface EncryptedProfileConfig {
  profiles: Profile[];
  site_balance_sessions_by_base_url: SiteBalanceSessionsByBaseUrl;
}

export type ResolvedBalanceAuth =
  | {
      kind: "none";
      base_url: string;
      reason: "no_session" | "missing_bound_session";
    }
  | {
      kind: "implicit_single_session";
      base_url: string;
      session: SiteBalanceSession;
    }
  | {
      kind: "explicit_session";
      base_url: string;
      session: SiteBalanceSession;
    }
  | {
      kind: "ambiguous_multiple_sessions";
      base_url: string;
      sessions: SiteBalanceSession[];
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
    };
  }

  if (!value || typeof value !== "object") {
    return emptyEncryptedProfileConfig();
  }

  const record = value as {
    profiles?: unknown;
    site_balance_sessions_by_base_url?: unknown;
  };

  return {
    profiles: Array.isArray(record.profiles)
      ? record.profiles.map((profile) => normalizeProfile(profile as Profile))
      : [],
    site_balance_sessions_by_base_url: normalizeSiteBalanceSessionsByBaseUrl(
      record.site_balance_sessions_by_base_url,
    ),
  };
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
  return {
    id: draft.id?.trim() || undefined,
    label: draft.label.trim(),
    access_token: draft.access_token.trim(),
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

  if (sessions.length === 1) {
    return {
      kind: "implicit_single_session",
      base_url: baseUrl,
      session: { ...sessions[0] },
    };
  }

  if (sessions.length > 1) {
    return {
      kind: "ambiguous_multiple_sessions",
      base_url: baseUrl,
      sessions: sessions.map((session) => ({ ...session })),
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
  if (resolved.kind === "ambiguous_multiple_sessions") {
    return "未选择后台会话";
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
  const userId = record.user_id?.trim();
  const baseUrl = normalizeBalanceBaseUrl(record.base_url ?? fallbackBaseUrl);

  if (!id || !label || !accessToken || !userId || !baseUrl) {
    return null;
  }

  return {
    id,
    label,
    base_url: baseUrl,
    access_token: accessToken,
    user_id: userId,
    updated_at: record.updated_at?.trim() || "",
  };
}

function withSequentialAccountLabels(sessions: SiteBalanceSession[]): SiteBalanceSession[] {
  return sessions.map((session, index) => ({
    ...session,
    label: `账号${index + 1}`,
  }));
}

function resolveShareableBalanceScope(
  profile: Pick<Profile, "url" | "balance_session_id">,
  sessionsByBaseUrl: SiteBalanceSessionsByBaseUrl,
): { baseUrl: string; sessionId: string } | null {
  const resolved = resolveBalanceAuth(profile, sessionsByBaseUrl);
  if (resolved.kind !== "explicit_session" && resolved.kind !== "implicit_single_session") {
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
