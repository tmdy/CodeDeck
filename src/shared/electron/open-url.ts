export const DEFAULT_PROFILE_BROWSER_PARTITION = "persist:codedeck-profile-browser";

export type ProfileBrowserTarget =
  | { kind: "default" }
  | { kind: "saved_session"; session_id: string }
  | { kind: "browser_slot"; slot: number }
  | { kind: "pending_browser_account" };

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(record);
  return actualKeys.length === keys.length && keys.every((key) => actualKeys.includes(key));
}

export function parseProfileBrowserTarget(value: unknown): ProfileBrowserTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    (record.kind === "default" || record.kind === "pending_browser_account")
    && hasExactKeys(record, ["kind"])
  ) {
    return { kind: record.kind };
  }
  if (
    record.kind === "saved_session"
    && typeof record.session_id === "string"
    && hasExactKeys(record, ["kind", "session_id"])
  ) {
    const sessionId = record.session_id.trim();
    return sessionId ? { kind: "saved_session", session_id: sessionId } : null;
  }
  if (
    record.kind === "browser_slot"
    && typeof record.slot === "number"
    && Number.isSafeInteger(record.slot)
    && record.slot > 0
    && hasExactKeys(record, ["kind", "slot"])
  ) {
    return { kind: "browser_slot", slot: record.slot };
  }
  return null;
}

export function resolveBaseUrlBrowserTarget(baseUrl: string): string {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    throw new Error("Base URL 不能为空");
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Base URL 格式无效");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("仅支持打开 http 或 https 地址");
  }

  return parsed.origin;
}
