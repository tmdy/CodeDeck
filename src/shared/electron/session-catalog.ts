import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { normalizeProvider } from "../profile/types.js";
import { getNextSessionCursor, paginatedSessions } from "../session-pagination.js";
import {
  scanClaudeSessionCatalog,
  scanCodexSessionCatalog,
  type CodexSessionHome,
  type ListSessionsRequest,
  type SessionCatalogFileEntry,
  type SessionCatalogState,
  type SessionPageResult,
  type SessionRefreshResult,
  type SessionSummary,
} from "../services/session-service.js";

const CATALOG_VERSION = 1;
const CATALOG_REFRESH_TTL_MS = 60_000;

interface StoredCatalogEntry extends SessionCatalogFileEntry {
  provider: "claude" | "codex";
  source_kind?: SessionSummary["source_kind"];
  source_home?: string;
}

interface SessionCatalogSnapshot {
  version: number;
  revision: number;
  scanned_at_by_source: Record<string, number>;
  entries: StoredCatalogEntry[];
}

export interface SessionCatalogUpdate {
  provider: string;
  revision: number;
  catalog_state: SessionCatalogState;
  discovered?: number;
  updated?: number;
  scanned_files?: number;
  duration_ms?: number;
}

interface SessionCatalogOptions {
  filePath: string;
  nowMs?: () => number;
  onUpdate?: (update: SessionCatalogUpdate) => void;
}

function emptySnapshot(): SessionCatalogSnapshot {
  return {
    version: CATALOG_VERSION,
    revision: 0,
    scanned_at_by_source: {},
    entries: [],
  };
}

function normalizePath(value?: string): string {
  return value?.trim() ? path.resolve(value).replace(/\\/g, "/").toLowerCase() : "";
}

function sourceKey(provider: string, sourceHome = ""): string {
  return `${normalizeProvider(provider)}:${normalizePath(sourceHome)}`;
}

function entrySourceKey(entry: StoredCatalogEntry): string {
  return sourceKey(entry.provider, entry.source_home);
}

function entryIdentity(entry: StoredCatalogEntry): string {
  return `${entrySourceKey(entry)}:${entry.summary.session_id}`;
}

function fileIdentity(filePath: string): string {
  return normalizePath(filePath);
}

function normalizeComparablePath(value?: string): string {
  return value?.trim().replace(/\\/g, "/").replace(/\/$/, "").toLowerCase() ?? "";
}

function sessionTime(summary: SessionSummary): number {
  const value = new Date(summary.updated_at).getTime();
  return Number.isNaN(value) ? 0 : value;
}

function compareSessions(left: SessionSummary, right: SessionSummary): number {
  const timeDifference = sessionTime(right) - sessionTime(left);
  if (timeDifference !== 0) {
    return timeDifference;
  }
  const idDifference = left.session_id.localeCompare(right.session_id);
  if (idDifference !== 0) {
    return idDifference;
  }
  return (left.source_kind ?? "").localeCompare(right.source_kind ?? "");
}

function sourcePriority(summary: SessionSummary): number {
  if (summary.source_kind === "app_runtime") {
    return 0;
  }
  if (summary.source_kind === "global_codex") {
    return 1;
  }
  return 2;
}

function mergeSummary(existing: SessionSummary | undefined, next: SessionSummary): SessionSummary {
  if (!existing) {
    return next;
  }
  return {
    ...existing,
    ...next,
    cwd: next.cwd || existing.cwd,
    preview: next.preview || existing.preview,
    user_prompts: next.user_prompts?.length ? next.user_prompts : existing.user_prompts,
    conversation_excerpts: next.conversation_excerpts?.length
      ? next.conversation_excerpts
      : existing.conversation_excerpts,
    source_file_relative_path: next.source_file_relative_path || existing.source_file_relative_path,
  };
}

function publicSummary(entry: StoredCatalogEntry): SessionSummary {
  return {
    ...entry.summary,
    ...(entry.source_kind ? { source_kind: entry.source_kind } : {}),
    ...(entry.source_home ? { source_home: entry.source_home } : {}),
  };
}

export class SessionCatalog {
  private readonly filePath: string;
  private readonly nowMs: () => number;
  private readonly onUpdate?: (update: SessionCatalogUpdate) => void;
  private snapshot = emptySnapshot();
  private loadPromise: Promise<void> | null = null;
  private savePromise: Promise<void> = Promise.resolve();
  private readonly builds = new Map<string, Promise<void>>();

  constructor(options: SessionCatalogOptions) {
    this.filePath = options.filePath;
    this.nowMs = options.nowMs ?? Date.now;
    this.onUpdate = options.onUpdate;
  }

  private async ensureLoaded(): Promise<void> {
    this.loadPromise ??= (async () => {
      try {
        const parsed = JSON.parse(await readFile(this.filePath, "utf-8")) as SessionCatalogSnapshot;
        if (parsed.version === CATALOG_VERSION && Array.isArray(parsed.entries)) {
          this.snapshot = {
            version: CATALOG_VERSION,
            revision: Number.isFinite(parsed.revision) ? parsed.revision : 0,
            scanned_at_by_source: parsed.scanned_at_by_source ?? {},
            entries: parsed.entries,
          };
        }
      } catch {
        this.snapshot = emptySnapshot();
      }
    })();
    await this.loadPromise;
  }

  private queueSave(): Promise<void> {
    const serialized = JSON.stringify(this.snapshot);
    this.savePromise = this.savePromise.catch(() => undefined).then(async () => {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.tmp-${process.pid}`;
      await writeFile(temporaryPath, serialized, "utf-8");
      try {
        await rename(temporaryPath, this.filePath);
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== "EEXIST" && code !== "EPERM") {
          throw error;
        }
        await rm(this.filePath, { force: true });
        await rename(temporaryPath, this.filePath);
      }
    });
    return this.savePromise;
  }

  private sourceKeysFor(provider: string, codexHomes: CodexSessionHome[]): string[] {
    if (normalizeProvider(provider) !== "codex") {
      return [sourceKey("claude")];
    }
    return codexHomes
      .filter((home) => home.home.trim())
      .map((home) => sourceKey("codex", home.home));
  }

  private shouldBuild(provider: string, codexHomes: CodexSessionHome[]): boolean {
    return this.sourceKeysFor(provider, codexHomes).some((key) => (
      this.builds.has(key)
      || this.nowMs() - (this.snapshot.scanned_at_by_source[key] ?? 0) >= CATALOG_REFRESH_TTL_MS
    ));
  }

  private catalogState(provider: string, codexHomes: CodexSessionHome[]): SessionCatalogState {
    const keys = this.sourceKeysFor(provider, codexHomes);
    if (keys.some((key) => this.builds.has(key))) {
      return keys.some((key) => !(this.snapshot.scanned_at_by_source[key] > 0)) ? "building" : "updating";
    }
    return keys.every((key) => this.snapshot.scanned_at_by_source[key] > 0) ? "ready" : "building";
  }

  private notify(
    provider: string,
    codexHomes: CodexSessionHome[],
    metrics: Pick<SessionCatalogUpdate, "discovered" | "updated" | "scanned_files" | "duration_ms"> = {},
  ): void {
    this.onUpdate?.({
      provider: normalizeProvider(provider),
      revision: this.snapshot.revision,
      catalog_state: this.catalogState(provider, codexHomes),
      ...metrics,
    });
  }

  private previousFiles(key: string): Map<string, SessionCatalogFileEntry> {
    return new Map(
      this.snapshot.entries
        .filter((entry) => entrySourceKey(entry) === key && entry.file_path)
        .map((entry) => [fileIdentity(entry.file_path), entry]),
    );
  }

  private replaceSourceEntries(
    key: string,
    provider: "claude" | "codex",
    sourceHome: string,
    sourceKind: SessionSummary["source_kind"] | undefined,
    scanned: SessionCatalogFileEntry[],
  ): { discovered: number; updated: number } {
    const previous = this.snapshot.entries.filter((entry) => entrySourceKey(entry) === key);
    const previousByIdentity = new Map(previous.map((entry) => [entryIdentity(entry), entry]));
    const newestBySession = new Map<string, SessionCatalogFileEntry>();
    for (const entry of scanned) {
      const existing = newestBySession.get(entry.summary.session_id);
      if (!existing || sessionTime(entry.summary) > sessionTime(existing.summary)) {
        newestBySession.set(entry.summary.session_id, entry);
      }
    }
    const replacements: StoredCatalogEntry[] = Array.from(newestBySession.values()).map((entry) => ({
      ...entry,
      provider,
      ...(sourceKind ? { source_kind: sourceKind } : {}),
      ...(sourceHome ? { source_home: sourceHome } : {}),
      summary: {
        ...entry.summary,
        ...(sourceKind ? { source_kind: sourceKind } : {}),
        ...(sourceHome ? { source_home: sourceHome } : {}),
      },
    }));
    let discovered = 0;
    let updated = 0;
    for (const entry of replacements) {
      const existing = previousByIdentity.get(entryIdentity(entry));
      if (!existing) {
        discovered += 1;
      } else if (
        existing.mtime_ms !== entry.mtime_ms
        || existing.size !== entry.size
        || JSON.stringify(existing.summary) !== JSON.stringify(entry.summary)
      ) {
        updated += 1;
      }
    }
    this.snapshot.entries = [
      ...this.snapshot.entries.filter((entry) => entrySourceKey(entry) !== key),
      ...replacements,
    ];
    return { discovered, updated };
  }

  private startBuild(provider: string, codexHomes: CodexSessionHome[]): void {
    const normalizedProvider = normalizeProvider(provider);
    if (normalizedProvider === "codex") {
      for (const home of codexHomes) {
        const key = sourceKey("codex", home.home);
        if (this.builds.has(key) || this.nowMs() - (this.snapshot.scanned_at_by_source[key] ?? 0) < CATALOG_REFRESH_TTL_MS) {
          continue;
        }
        let metrics: Pick<SessionCatalogUpdate, "discovered" | "updated" | "scanned_files" | "duration_ms"> = {};
        const build = (async () => {
          const startedAt = this.nowMs();
          const scanned = await scanCodexSessionCatalog(home.home, this.previousFiles(key));
          const changes = this.replaceSourceEntries(key, "codex", home.home, home.kind, scanned);
          this.snapshot.scanned_at_by_source[key] = this.nowMs();
          this.snapshot.revision += 1;
          await this.queueSave();
          metrics = {
            ...changes,
            scanned_files: scanned.length,
            duration_ms: this.nowMs() - startedAt,
          };
        })().catch(() => {
          // A failed background catalog build leaves the last good snapshot usable.
        }).finally(() => {
          this.builds.delete(key);
          this.notify(provider, codexHomes, metrics);
        });
        this.builds.set(key, build);
        this.notify(provider, codexHomes);
      }
      return;
    }

    const key = sourceKey("claude");
    if (this.builds.has(key) || this.nowMs() - (this.snapshot.scanned_at_by_source[key] ?? 0) < CATALOG_REFRESH_TTL_MS) {
      return;
    }
    let metrics: Pick<SessionCatalogUpdate, "discovered" | "updated" | "scanned_files" | "duration_ms"> = {};
    const build = (async () => {
      const startedAt = this.nowMs();
      const scanned = await scanClaudeSessionCatalog(this.previousFiles(key));
      const changes = this.replaceSourceEntries(key, "claude", "", undefined, scanned);
      this.snapshot.scanned_at_by_source[key] = this.nowMs();
      this.snapshot.revision += 1;
      await this.queueSave();
      metrics = {
        ...changes,
        scanned_files: scanned.length,
        duration_ms: this.nowMs() - startedAt,
      };
    })().catch(() => {
      // A failed background catalog build leaves the last good snapshot usable.
    }).finally(() => {
      this.builds.delete(key);
      this.notify(provider, codexHomes, metrics);
    });
    this.builds.set(key, build);
    this.notify(provider, codexHomes);
  }

  private mergeFastSessions(provider: string, sessions: SessionSummary[]): boolean {
    const normalizedProvider = normalizeProvider(provider) as "claude" | "codex";
    const byIdentity = new Map(this.snapshot.entries.map((entry) => [entryIdentity(entry), entry]));
    let changed = false;
    for (const summary of sessions) {
      const sourceHome = summary.source_home ?? "";
      const candidate: StoredCatalogEntry = {
        provider: normalizedProvider,
        source_kind: summary.source_kind,
        source_home: sourceHome || undefined,
        summary,
        file_path: "",
        mtime_ms: 0,
        size: 0,
      };
      const identity = entryIdentity(candidate);
      const existing = byIdentity.get(identity);
      const merged = mergeSummary(existing?.summary, summary);
      if (!existing) {
        this.snapshot.entries.push({ ...candidate, summary: merged });
        changed = true;
      } else if (JSON.stringify(existing.summary) !== JSON.stringify(merged)) {
        existing.summary = merged;
        changed = true;
      }
    }
    if (changed) {
      this.snapshot.revision += 1;
    }
    return changed;
  }

  async createPage(
    request: ListSessionsRequest,
    codexHomes: CodexSessionHome[],
    fastSessions: SessionSummary[],
  ): Promise<SessionPageResult> {
    await this.ensureLoaded();
    const changed = this.mergeFastSessions(request.provider, fastSessions);
    if (changed) {
      await this.queueSave().catch(() => undefined);
    }
    if (this.shouldBuild(request.provider, codexHomes)) {
      this.startBuild(request.provider, codexHomes);
    }

    const normalizedProvider = normalizeProvider(request.provider);
    const normalizedCwd = normalizeComparablePath(request.cwd);
    const matching = this.snapshot.entries
      .filter((entry) => entry.provider === normalizedProvider)
      .map(publicSummary)
      .filter((summary) => request.scope !== "project" || normalizeComparablePath(summary.cwd) === normalizedCwd)
      .sort((left, right) => sourcePriority(left) - sourcePriority(right) || compareSessions(left, right));
    const deduplicated = Array.from(
      matching.reduce((map, summary) => {
        if (!map.has(summary.session_id)) {
          map.set(summary.session_id, summary);
        }
        return map;
      }, new Map<string, SessionSummary>()).values(),
    ).sort(compareSessions);
    const page = paginatedSessions(deduplicated, request);
    const allAfterCursor = paginatedSessions(deduplicated, { ...request, limit: undefined });
    const state = this.catalogState(request.provider, codexHomes);
    const partial = state !== "ready";
    const limit = request.limit && request.limit > 0 ? request.limit : undefined;
    return {
      sessions: page,
      ...(getNextSessionCursor(page) ? { next_cursor: getNextSessionCursor(page) } : {}),
      has_more: limit !== undefined && page.length >= limit && (allAfterCursor.length > page.length || partial),
      catalog_state: state,
      partial,
      revision: this.snapshot.revision,
    };
  }

  async refresh(provider: string, codexHomes: CodexSessionHome[]): Promise<SessionRefreshResult> {
    await this.ensureLoaded();
    const sourceKeys = this.sourceKeysFor(provider, codexHomes);
    for (const key of sourceKeys) {
      this.snapshot.scanned_at_by_source[key] = 0;
    }
    this.startBuild(provider, codexHomes);

    const builds = sourceKeys
      .map((key) => this.builds.get(key))
      .filter((build): build is Promise<void> => !!build);
    await Promise.all(builds);

    return {
      revision: this.snapshot.revision,
      discovered: 0,
      updated: 0,
      catalog_state: this.catalogState(provider, codexHomes) === "ready" ? "ready" : "building",
    };
  }
}
