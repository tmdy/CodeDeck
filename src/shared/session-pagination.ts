import type { ListSessionsRequest, SessionSummary } from "./services/session-service.js";

function parseSessionTimeMs(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function sessionCursorValue(
  session: Pick<SessionSummary, "updated_at" | "session_id" | "source_kind">,
): string {
  return JSON.stringify([
    parseSessionTimeMs(session.updated_at),
    session.session_id,
    session.source_kind ?? "",
  ]);
}

export function decodeSessionCursor(cursor?: string): [number, string, string] | null {
  if (!cursor?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(cursor) as unknown;
    if (
      Array.isArray(parsed)
      && parsed.length === 3
      && typeof parsed[0] === "number"
      && typeof parsed[1] === "string"
      && typeof parsed[2] === "string"
    ) {
      return [parsed[0], parsed[1], parsed[2]];
    }
  } catch {
    // Invalid cursors fall back to offset pagination for compatibility.
  }
  return null;
}

export function isSessionAfterCursor(
  session: SessionSummary,
  cursor: [number, string, string],
): boolean {
  const value: [number, string, string] = [
    parseSessionTimeMs(session.updated_at),
    session.session_id,
    session.source_kind ?? "",
  ];
  if (value[0] !== cursor[0]) {
    return value[0] < cursor[0];
  }
  if (value[1] !== cursor[1]) {
    return value[1].localeCompare(cursor[1]) > 0;
  }
  return value[2].localeCompare(cursor[2]) > 0;
}

export function getNextSessionCursor(sessions: SessionSummary[]): string | undefined {
  const last = sessions.at(-1);
  return last ? sessionCursorValue(last) : undefined;
}

export function paginatedSessions(
  sessions: SessionSummary[],
  request: Pick<ListSessionsRequest, "cursor" | "offset" | "limit">,
): SessionSummary[] {
  const cursor = decodeSessionCursor(request.cursor);
  const cursorFiltered = cursor ? sessions.filter((session) => isSessionAfterCursor(session, cursor)) : sessions;
  const offset = Math.max(0, request.offset ?? 0);
  const limit = request.limit && request.limit > 0 ? request.limit : undefined;
  if (limit === undefined) {
    return cursorFiltered.slice(offset);
  }
  return cursorFiltered.slice(offset, offset + limit);
}

