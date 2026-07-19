import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { SessionCatalog, type SessionCatalogUpdate } from "../../electron/session-catalog.js";
import {
  scanCodexSessionCatalog,
  type CodexSessionHome,
  type SessionSummary,
} from "../../services/session-service.js";

async function writeJsonl(filePath: string, records: unknown[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf-8");
}

function normalizeFileKey(filePath: string): string {
  return path.resolve(filePath).replace(/\\/g, "/").toLowerCase();
}

function summary(sessionId: string, updatedAt: string): SessionSummary {
  return {
    provider: "codex",
    session_id: sessionId,
    cwd: "",
    updated_at: updatedAt,
    preview: sessionId,
    source_kind: "global_codex",
  };
}

describe("SessionCatalog", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("returns the fast first page and fills index-missing sessions in the background", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codedeck-session-catalog-"));
    tempDirs.push(root);
    const missingFile = path.join(root, "sessions", "2026", "07", "17", "rollout-file-new.jsonl");
    await writeJsonl(missingFile, [{
      type: "session_meta",
      payload: {
        id: "file-new",
        cwd: "C:/workspace/new",
        updated_at: "2026-07-17T12:00:00.000Z",
        thread_name: "New file session",
      },
    }]);

    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const updates: SessionCatalogUpdate[] = [];
    const catalog = new SessionCatalog({
      filePath: path.join(root, "cache", "catalog.json"),
      onUpdate: (update) => {
        updates.push(update);
        if (update.catalog_state === "ready" && update.revision > 0) {
          resolveReady();
        }
      },
    });
    const homes: CodexSessionHome[] = [{ kind: "global_codex", home: root }];
    const first = await catalog.createPage({
      provider: "codex",
      scope: "global_recent",
      limit: 20,
    }, homes, [summary("indexed-old", "2026-07-17T10:00:00.000Z")]);

    expect(first.sessions.map((session) => session.session_id)).toEqual(["indexed-old"]);
    expect(first.catalog_state).toBe("building");

    await ready;
    const completed = await catalog.createPage({
      provider: "codex",
      scope: "global_recent",
      limit: 20,
    }, homes, [summary("indexed-old", "2026-07-17T10:00:00.000Z")]);

    expect(completed.sessions.map((session) => session.session_id)).toEqual(["file-new", "indexed-old"]);
    expect(completed.catalog_state).toBe("ready");
    expect(updates.some((update) => update.catalog_state === "ready")).toBe(true);
  });

  it("waits for a manual refresh to finish rebuilding the catalog", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codedeck-session-catalog-refresh-"));
    tempDirs.push(root);
    const sessionFile = path.join(root, "sessions", "2026", "07", "17", "rollout-refresh.jsonl");
    await writeJsonl(sessionFile, [{
      type: "session_meta",
      payload: {
        id: "refresh-session",
        cwd: "C:/workspace/refresh",
        updated_at: "2026-07-17T12:00:00.000Z",
        thread_name: "Refresh session",
      },
    }]);

    const catalog = new SessionCatalog({
      filePath: path.join(root, "cache", "catalog.json"),
    });
    const homes: CodexSessionHome[] = [{ kind: "global_codex", home: root }];

    const refreshResult = await catalog.refresh("codex", homes);
    const page = await catalog.createPage({
      provider: "codex",
      scope: "global_recent",
      limit: 20,
    }, homes, []);

    expect(refreshResult.catalog_state).toBe("ready");
    expect(page.catalog_state).toBe("ready");
    expect(page.sessions.map((session) => session.session_id)).toEqual(["refresh-session"]);
  });

  it("reuses unchanged file summaries by mtime and size", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codedeck-session-scan-"));
    tempDirs.push(root);
    const filePath = path.join(root, "sessions", "2026", "07", "17", "rollout-unchanged.jsonl");
    await writeJsonl(filePath, [{
      type: "session_meta",
      payload: { id: "unchanged", cwd: "C:/workspace", updated_at: "2026-07-17T12:00:00.000Z" },
    }]);

    const first = await scanCodexSessionCatalog(root);
    const previous = new Map([[normalizeFileKey(filePath), first[0]]]);
    const second = await scanCodexSessionCatalog(root, previous);

    expect(second[0]).toBe(first[0]);
  });

  it("uses a stable cursor when a newer session is inserted above the next page", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "codedeck-session-cursor-"));
    tempDirs.push(root);
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    const catalog = new SessionCatalog({
      filePath: path.join(root, "cache", "catalog.json"),
      onUpdate: (update) => {
        if (update.catalog_state === "ready") {
          resolveReady();
        }
      },
    });
    const homes: CodexSessionHome[] = [{ kind: "global_codex", home: root }];
    const initial = [
      summary("session-3", "2026-07-17T12:00:00.000Z"),
      summary("session-2", "2026-07-17T11:00:00.000Z"),
      summary("session-1", "2026-07-17T10:00:00.000Z"),
    ];
    const first = await catalog.createPage({
      provider: "codex",
      scope: "global_recent",
      limit: 2,
    }, homes, initial);
    await ready;

    const second = await catalog.createPage({
      provider: "codex",
      scope: "global_recent",
      limit: 2,
      cursor: first.next_cursor,
    }, homes, [summary("session-4", "2026-07-17T13:00:00.000Z"), ...initial]);

    expect(first.sessions.map((session) => session.session_id)).toEqual(["session-3", "session-2"]);
    expect(second.sessions.map((session) => session.session_id)).toEqual(["session-1"]);
  });
});
