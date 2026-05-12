// 会话服务 — 会话扫描和解析

import { normalizeProvider, PROVIDER_CODEX } from "../profile/types.js";
import type { ProfileKey } from "../profile/types.js";

export type SessionListScope = "project" | "global_recent";

export interface ListSessionsRequest {
  provider: string;
  scope: SessionListScope;
  cwd?: string;
  profile_key?: ProfileKey;
  limit?: number;
  offset?: number;
}

export interface SessionSummary {
  provider: "claude" | "codex";
  session_id: string;
  cwd: string;
  updated_at: string;
  preview: string;
  source_kind?: CodexSessionSourceKind;
  source_home?: string;
}

export type CodexSessionSourceKind = "app_runtime" | "global_codex";

export interface CodexSessionHome {
  kind: CodexSessionSourceKind;
  home: string;
}

interface SessionListLoaders {
  listClaudeSessions: (request: ListSessionsRequest) => Promise<SessionSummary[]>;
  listCodexSessions: (request: ListSessionsRequest) => Promise<SessionSummary[]>;
}

interface SessionFileSummary extends SessionSummary {
  filePath: string;
  cwdCandidates?: string[];
}

interface CodexIndexEntry {
  session_id: string;
  cwd: string;
  updated_at: string;
  preview: string;
}

const MAX_PREVIEW_LENGTH = 120;
const codexIndexCache = new Map<string, {
  mtimeMs: number;
  size: number;
  entries: CodexIndexEntry[];
}>();

export function isSessionListScope(value: unknown): value is SessionListScope {
  return value === "project" || value === "global_recent";
}

function normalizeComparablePath(value: string): string {
  return value.trim().replace(/\\/g, "/").toLowerCase();
}

function requireProjectCwd(request: ListSessionsRequest): string {
  const cwd = request.cwd?.trim() ?? "";
  if (!cwd) {
    throw new Error("project scope requires cwd");
  }
  return cwd;
}

function trimPreview(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.slice(0, MAX_PREVIEW_LENGTH);
}

function encodeClaudeProjectPath(cwd: string): string {
  return cwd
    .trim()
    .replace(/\\/g, "/")
    .replace(/[:/]/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-");
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function extractTextValue(value: unknown): string {
  if (typeof value === "string") {
    return trimPreview(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractTextValue(item);
      if (text) {
        return text;
      }
    }
    return "";
  }
  const record = asRecord(value);
  if (!record) {
    return "";
  }
  return firstString(
    extractTextValue(record.text),
    extractTextValue(record.content),
    extractTextValue(record.message),
    extractTextValue(record.parts),
  );
}

async function safeReadJsonl(filePath: string): Promise<unknown[]> {
  const fs = await import("node:fs/promises");
  const content = await fs.readFile(filePath, "utf-8");
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const records: unknown[] = [];
  for (const line of lines) {
    records.push(JSON.parse(line));
  }
  return records;
}

async function walkJsonlFiles(rootDir: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const results: string[] = [];

  async function visit(dirPath: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        results.push(fullPath);
      }
    }
  }

  await visit(rootDir);
  return results;
}

async function collectClaudeCandidateFiles(projectDir: string): Promise<string[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const candidates: string[] = [];

  let entries;
  try {
    entries = await fs.readdir(projectDir, { withFileTypes: true });
  } catch {
    return candidates;
  }

  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      candidates.push(path.join(projectDir, entry.name));
    }
  }

  const legacySessionsDir = path.join(projectDir, "sessions");
  try {
    const legacyEntries = await fs.readdir(legacySessionsDir, { withFileTypes: true });
    for (const entry of legacyEntries) {
      if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        candidates.push(path.join(legacySessionsDir, entry.name));
      }
    }
  } catch {
    // ignore missing legacy directory
  }

  return candidates;
}

async function summarizeClaudeSessionFile(filePath: string, fallbackCwd: string): Promise<SessionFileSummary> {
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const records = await safeReadJsonl(filePath);
  const stat = await fs.stat(filePath);
  let preview = "";
  let cwd = fallbackCwd;
  const cwdCandidates: string[] = [];
  const seenCwds = new Set<string>();

  function addCwdCandidate(value: string): void {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    const normalized = normalizeComparablePath(trimmed);
    if (seenCwds.has(normalized)) {
      return;
    }
    seenCwds.add(normalized);
    cwdCandidates.push(trimmed);
  }

  for (const recordValue of records) {
    const record = asRecord(recordValue);
    if (!record) {
      continue;
    }
    const recordCwd = firstString(record.cwd);
    if (recordCwd) {
      cwd = recordCwd;
      addCwdCandidate(recordCwd);
    }
    if (!preview) {
      preview = firstString(
        extractTextValue(record.message),
        extractTextValue(record.content),
      );
    }
  }

  const sessionId = path.basename(filePath, ".jsonl");
  return {
    provider: "claude",
    session_id: sessionId,
    cwd,
    updated_at: stat.mtime.toISOString(),
    preview: preview || sessionId,
    filePath,
    cwdCandidates: cwdCandidates.length > 0 ? cwdCandidates : [cwd],
  };
}

function parseCodexIndexEntry(value: unknown): CodexIndexEntry | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const sessionId = firstString(record.id, record.session_id, record.sessionId);
  if (!sessionId) {
    return null;
  }
  return {
    session_id: sessionId,
    cwd: firstString(record.cwd, record.project_path, record.projectPath),
    updated_at: firstString(record.updated_at, record.updatedAt),
    preview: firstString(record.thread_name, record.title, record.name, record.preview),
  };
}

function inferSessionIdFromFilePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const match = normalized.match(/([0-9a-f]{8,}(?:-[0-9a-z]{4,}){1,})\.jsonl$/i);
  if (match) {
    return match[1];
  }
  const parts = normalized.split("/");
  const fileName = parts[parts.length - 1] ?? "";
  return fileName.replace(/\.jsonl$/i, "");
}

async function summarizeCodexSessionFile(filePath: string): Promise<SessionFileSummary> {
  const fs = await import("node:fs/promises");
  const records = await safeReadJsonl(filePath);
  const stat = await fs.stat(filePath);

  let sessionId = inferSessionIdFromFilePath(filePath);
  let cwd = "";
  let preview = "";
  let updatedAt = stat.mtime.toISOString();

  for (const recordValue of records) {
    const record = asRecord(recordValue);
    if (!record) {
      continue;
    }
    if (firstString(record.type) === "session_meta") {
      const payload = asRecord(record.payload);
      sessionId = firstString(payload?.id, sessionId);
      cwd = firstString(payload?.cwd, cwd);
      updatedAt = firstString(payload?.updated_at, payload?.updatedAt, updatedAt);
      preview = firstString(payload?.thread_name, payload?.threadName, preview);
      continue;
    }
    cwd = firstString(record.cwd, cwd);
    if (!preview) {
      preview = firstString(
        extractTextValue(record.payload),
        extractTextValue(record.message),
        extractTextValue(record.content),
      );
    }
  }

  return {
    provider: "codex",
    session_id: sessionId,
    cwd,
    updated_at: updatedAt,
    preview: preview || sessionId,
    filePath,
  };
}

async function buildCodexFallbackMap(sessionsRoot: string): Promise<Map<string, SessionFileSummary>> {
  const map = new Map<string, SessionFileSummary>();
  const filePaths = await walkJsonlFiles(sessionsRoot);
  for (const filePath of filePaths) {
    try {
      const summary = await summarizeCodexSessionFile(filePath);
      map.set(summary.session_id, summary);
    } catch {
      // 单个坏文件不影响其他会话
    }
  }
  return map;
}

async function findCodexSessionFile(root: string, sessionId: string): Promise<SessionFileSummary | null> {
  const fallbackMap = await buildCodexFallbackMap(root);
  return fallbackMap.get(sessionId) ?? null;
}

async function readCodexIndex(indexPath: string): Promise<CodexIndexEntry[]> {
  const fs = await import("node:fs/promises");
  try {
    const stat = await fs.stat(indexPath);
    const cached = codexIndexCache.get(indexPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.entries;
    }
    const records = await safeReadJsonl(indexPath);
    const entries = records
      .map((record) => parseCodexIndexEntry(record))
      .filter((record): record is CodexIndexEntry => record !== null);
    codexIndexCache.set(indexPath, {
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      entries,
    });
    return entries;
  } catch {
    return [];
  }
}

export function invalidateCodexSessionCache(home?: string): void {
  if (!home?.trim()) {
    codexIndexCache.clear();
    return;
  }
  const normalizedHome = normalizeComparablePath(home);
  for (const key of Array.from(codexIndexCache.keys())) {
    if (normalizeComparablePath(key).startsWith(normalizedHome)) {
      codexIndexCache.delete(key);
    }
  }
}

function paginatedSessions(sessions: SessionSummary[], request: ListSessionsRequest): SessionSummary[] {
  const offset = Math.max(0, request.offset ?? 0);
  const limit = request.limit && request.limit > 0 ? request.limit : undefined;
  if (limit === undefined) {
    return sessions.slice(offset);
  }
  return sessions.slice(offset, offset + limit);
}

async function summarizeCodexSessionFromIndex(root: string, entry: CodexIndexEntry): Promise<SessionSummary | null> {
  const path = await import("node:path");
  if (entry.cwd && entry.preview) {
    return null;
  }
  const date = new Date(entry.updated_at);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  const dayRoot = path.join(
    root,
    "sessions",
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  );
  const filePaths = await walkJsonlFiles(dayRoot);
  const filePath = filePaths.find((candidate) => candidate.includes(entry.session_id));
  if (!filePath) {
    return null;
  }
  return summarizeCodexSessionFile(filePath);
}

export async function listClaudeSessions(
  request: ListSessionsRequest,
  claudeHome?: string,
): Promise<SessionSummary[]> {
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");

  const configRoot = claudeHome
    ? (path.basename(claudeHome) === "projects" ? path.dirname(claudeHome) : claudeHome)
    : (process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude"));
  const projectsRoot = path.join(configRoot, "projects");
  const sessions: SessionFileSummary[] = [];

  if (request.scope === "project") {
    const cwd = requireProjectCwd(request);
    const normalizedCwd = normalizeComparablePath(cwd);
    const projectDir = path.join(projectsRoot, encodeClaudeProjectPath(cwd));
    const candidateFiles = await collectClaudeCandidateFiles(projectDir);
    for (const filePath of candidateFiles) {
      try {
        const summary = await summarizeClaudeSessionFile(filePath, cwd);
        const cwdCandidates = summary.cwdCandidates?.length ? summary.cwdCandidates : [summary.cwd || cwd];
        if (cwdCandidates.some((candidate) => normalizeComparablePath(candidate) === normalizedCwd)) {
          sessions.push({ ...summary, cwd });
        }
      } catch {
        // 单个坏文件不影响其他会话
      }
    }
  } else {
    let projectEntries;
    try {
      projectEntries = await fs.readdir(projectsRoot, { withFileTypes: true });
    } catch {
      return [];
    }

    for (const entry of projectEntries) {
      if (!entry.isDirectory()) {
        continue;
      }
      const projectDir = path.join(projectsRoot, entry.name);
      const candidateFiles = await collectClaudeCandidateFiles(projectDir);
      for (const filePath of candidateFiles) {
        try {
          sessions.push(await summarizeClaudeSessionFile(filePath, projectDir));
        } catch {
          // 单个坏文件不影响其他会话
        }
      }
    }
  }

  sessions.sort(
    (left, right) =>
      new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  );

  return sessions.map(({ provider, session_id, cwd: sessionCwd, updated_at, preview }) => ({
    provider,
    session_id,
    cwd: sessionCwd,
    updated_at,
    preview,
  }));
}

export async function listCodexSessions(
  request: ListSessionsRequest,
  codexHome?: string,
): Promise<SessionSummary[]> {
  const path = await import("node:path");
  const os = await import("node:os");

  const root = codexHome || path.join(os.homedir(), ".codex");
  const normalizedCwd = request.scope === "project"
    ? normalizeComparablePath(requireProjectCwd(request))
    : "";
  const indexEntries = await readCodexIndex(path.join(root, "session_index.jsonl"));
  const needsFallback = indexEntries.length === 0;
  const fallbackMap = needsFallback ? await buildCodexFallbackMap(path.join(root, "sessions")) : new Map();

  const mergedFromIndex = await Promise.all(indexEntries.map(async (entry) => {
    const fallback = fallbackMap.get(entry.session_id);
    const targetedSummary = normalizedCwd && (!entry.cwd || !entry.preview)
      ? await summarizeCodexSessionFromIndex(root, entry)
      : null;
    return {
      provider: "codex",
      session_id: entry.session_id,
      cwd: firstString(entry.cwd, targetedSummary?.cwd, fallback?.cwd),
      updated_at: firstString(entry.updated_at, targetedSummary?.updated_at, fallback?.updated_at),
      preview: firstString(entry.preview, targetedSummary?.preview, fallback?.preview, entry.session_id),
    } satisfies SessionSummary;
  }));

  const baseSessions = mergedFromIndex.length > 0
    ? mergedFromIndex
    : Array.from(fallbackMap.values()).map(({ provider, session_id, cwd: sessionCwd, updated_at, preview }) => ({
      provider,
      session_id,
      cwd: sessionCwd,
      updated_at,
      preview,
    }));

  const filteredSessions = normalizedCwd
    ? baseSessions.filter((session) => normalizeComparablePath(session.cwd) === normalizedCwd)
    : baseSessions;

  filteredSessions.sort(
    (left, right) =>
      new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  );

  return paginatedSessions(filteredSessions, request);
}

export async function listCodexSessionsFromHomes(
  request: ListSessionsRequest,
  homes: CodexSessionHome[],
): Promise<SessionSummary[]> {
  const merged = new Map<string, SessionSummary>();

  for (const source of homes) {
    if (!source.home.trim()) {
      continue;
    }
    const sessions = await listCodexSessions({
      ...request,
      limit: undefined,
      offset: undefined,
    }, source.home);
    for (const session of sessions) {
      if (merged.has(session.session_id)) {
        continue;
      }
      merged.set(session.session_id, {
        ...session,
        source_kind: source.kind,
        source_home: source.home,
      });
    }
  }

  const sorted = Array.from(merged.values()).sort(
    (left, right) =>
      new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
  );
  return paginatedSessions(sorted, request);
}

async function writeJsonlRecords(filePath: string, records: unknown[]): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  if (records.length === 0) {
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(
    filePath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf-8",
  );
}

async function mergeCodexIndexEntry(sourceHome: string, runtimeHome: string, sessionId: string): Promise<void> {
  const path = await import("node:path");
  const sourceRecords = await safeReadJsonl(path.join(sourceHome, "session_index.jsonl")).catch(() => []);
  const selectedRecords = sourceRecords.filter((record) => parseCodexIndexEntry(record)?.session_id === sessionId);
  if (selectedRecords.length === 0) {
    return;
  }

  const targetPath = path.join(runtimeHome, "session_index.jsonl");
  const existingRecords = await safeReadJsonl(targetPath).catch(() => []);
  const existingIds = new Set(
    existingRecords
      .map((record) => parseCodexIndexEntry(record)?.session_id)
      .filter((id): id is string => !!id),
  );
  const nextRecords = selectedRecords.filter((record) => {
    const id = parseCodexIndexEntry(record)?.session_id;
    return id && !existingIds.has(id);
  });

  if (nextRecords.length === 0) {
    return;
  }
  await writeJsonlRecords(targetPath, [...existingRecords, ...nextRecords]);
}

export async function importCodexSessionToRuntimeHome(options: {
  sessionId: string;
  sourceHome: string;
  runtimeHome: string;
}): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const sessionId = options.sessionId.trim();
  if (!sessionId) {
    throw new Error("恢复指定会话时必须提供 sessionId。");
  }

  const sourceSummary = await findCodexSessionFile(path.join(options.sourceHome, "sessions"), sessionId);
  if (!sourceSummary) {
    throw new Error("全局 .codex 中未找到该会话文件，无法导入恢复。");
  }

  const relativePath = path.relative(path.join(options.sourceHome, "sessions"), sourceSummary.filePath);
  const targetPath = path.join(options.runtimeHome, "sessions", relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourceSummary.filePath, targetPath);
  await mergeCodexIndexEntry(options.sourceHome, options.runtimeHome, sessionId);
}

export async function listSessionsForProvider(
  request: ListSessionsRequest,
  loaders: SessionListLoaders = {
    listClaudeSessions,
    listCodexSessions,
  },
): Promise<SessionSummary[]> {
  if (!isSessionListScope(request.scope)) {
    throw new Error("invalid session list scope");
  }
  if (request.scope === "project") {
    requireProjectCwd(request);
  }
  if (normalizeProvider(request.provider) === PROVIDER_CODEX) {
    return loaders.listCodexSessions(request);
  }
  return loaders.listClaudeSessions(request);
}

export { encodeClaudeProjectPath };
