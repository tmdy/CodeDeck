export type ManagementAuthorizationMode = "raw" | "bearer";
export type ManagementCookieMode = "raw" | "session_wrapped" | "token_wrapped";
export type ManagementAuthKind = "access_token" | "session_cookie";

export interface ManagementRequestContext {
  fetch: typeof fetch;
  headers: Readonly<Record<string, string>>;
  userIdHeaderPolicy: "omit" | "legacy_if_required";
  authMode: "browser_bearer" | "browser_cookie";
}

export interface ResolvedManagementAuth {
  kind: ManagementAuthKind;
  headers: Record<string, string>;
  authorizationMode: ManagementAuthorizationMode | "none";
  cookieMode: ManagementCookieMode | "none";
}

export interface ManagementAuthorizationCandidate {
  mode: ManagementAuthorizationMode;
  headerValue: string;
}

export interface ManagementCookieCandidate {
  mode: ManagementCookieMode;
  headerValue: string;
}

/** Build exactly one transport for an explicitly selected account kind. */
export function resolveManagementAuth(
  token: string,
  kind: ManagementAuthKind,
): ResolvedManagementAuth | null {
  const raw = stripBearerPrefix(token).raw;
  if (!raw) return null;
  if (kind === "session_cookie") {
    return {
      kind,
      headers: { Cookie: raw.includes("=") || raw.includes(";") ? raw : `session=${raw}` },
      authorizationMode: "none",
      cookieMode: raw.includes("=") || raw.includes(";") ? "raw" : "session_wrapped",
    };
  }
  return {
    kind,
    headers: {
      Authorization: `Bearer ${raw}`,
      "All-API-Hub": "true",
      "All-API-Hub-Cookie-Auth": "token",
    },
    authorizationMode: "bearer",
    cookieMode: "none",
  };
}

function stripBearerPrefix(value: string): { raw: string; hadBearerPrefix: boolean } {
  const trimmed = value.trim();
  const match = trimmed.match(/^Bearer\s+(.+)$/i);
  return match
    ? { raw: match[1].trim(), hadBearerPrefix: true }
    : { raw: trimmed, hadBearerPrefix: false };
}

function deduplicateByHeaderValue<T extends { headerValue: string }>(candidates: T[]): T[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (!candidate.headerValue || seen.has(candidate.headerValue)) {
      return false;
    }
    seen.add(candidate.headerValue);
    return true;
  });
}

export function buildManagementAuthorizationCandidates(
  token: string,
): ManagementAuthorizationCandidate[] {
  const { raw, hadBearerPrefix } = stripBearerPrefix(token);
  if (!raw) {
    return [];
  }

  const rawCandidate: ManagementAuthorizationCandidate = {
    mode: "raw",
    headerValue: raw,
  };
  const bearerCandidate: ManagementAuthorizationCandidate = {
    mode: "bearer",
    headerValue: `Bearer ${raw}`,
  };
  return deduplicateByHeaderValue(
    hadBearerPrefix
      ? [bearerCandidate, rawCandidate]
      : [rawCandidate, bearerCandidate],
  );
}

export function buildManagementCookieCandidates(token: string): ManagementCookieCandidate[] {
  const { raw } = stripBearerPrefix(token);
  if (!raw) {
    return [];
  }

  const candidates: ManagementCookieCandidate[] = [];
  if (raw.includes("=") || raw.includes(";")) {
    candidates.push({ mode: "raw", headerValue: raw });
  }
  candidates.push(
    { mode: "session_wrapped", headerValue: `session=${raw}` },
    { mode: "token_wrapped", headerValue: `token=${raw}` },
  );
  return deduplicateByHeaderValue(candidates);
}
