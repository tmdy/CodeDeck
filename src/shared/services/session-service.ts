// 会话服务 — 会话扫描和解析

import { normalizeProvider, PROVIDER_CLAUDE, PROVIDER_CODEX } from "../profile/types.js";
import type { ProfileKey } from "../profile/types.js";
import {
  decodeSessionCursor,
  isSessionAfterCursor,
  paginatedSessions,
} from "../session-pagination.js";

export type SessionListScope = "project" | "global_recent";
export type SessionDetailLevel = "summary" | "full";

export interface ListSessionsRequest {
  provider: string;
  scope: SessionListScope;
  cwd?: string;
  profile_key?: ProfileKey;
  limit?: number;
  offset?: number;
  cursor?: string;
  detail?: SessionDetailLevel;
}

export type SessionCatalogState = "ready" | "updating" | "building";

export interface SessionPageResult {
  sessions: SessionSummary[];
  next_cursor?: string;
  has_more: boolean;
  catalog_state: SessionCatalogState;
  partial: boolean;
  revision: number;
}

export interface SessionRefreshResult {
  revision: number;
  discovered: number;
  updated: number;
  catalog_state: "ready" | "building";
}

export interface GetSessionDetailRequest extends ListSessionsRequest {
  session_id: string;
  source_kind?: CodexSessionSourceKind;
  source_home?: string;
  source_file_relative_path?: string;
}

export interface SessionSummary {
  provider: "claude" | "codex";
  session_id: string;
  cwd: string;
  updated_at: string;
  preview: string;
  user_prompts?: string[];
  conversation_excerpts?: SessionConversationExcerpt[];
  source_kind?: CodexSessionSourceKind;
  source_home?: string;
  source_file_relative_path?: string;
}

export interface SessionConversationExcerpt {
  role: "user" | "assistant";
  text: string;
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

interface SessionDetailLoaders {
  getClaudeSessionDetail: (request: GetSessionDetailRequest) => Promise<SessionSummary | null>;
  getCodexSessionDetail: (request: GetSessionDetailRequest) => Promise<SessionSummary | null>;
}

interface CodexHomesLoaders {
  listCodexSessions?: (
    request: ListSessionsRequest,
    codexHome?: string,
  ) => Promise<SessionSummary[]>;
}

interface SessionFileSummary extends SessionSummary {
  filePath: string;
  cwdCandidates?: string[];
}

export interface SessionCatalogFileEntry {
  summary: SessionSummary;
  file_path: string;
  mtime_ms: number;
  size: number;
}

interface CodexIndexEntry {
  session_id: string;
  cwd: string;
  updated_at: string;
  preview: string;
}

interface ClaudeCandidateFile {
  filePath: string;
  fallbackCwd: string;
}

interface StatCandidateFile extends ClaudeCandidateFile {
  mtimeMs: number;
}

const MAX_PREVIEW_LENGTH = 120;
const MAX_USER_PROMPTS = 4;
const MAX_USER_PROMPT_LENGTH = 240;
const MAX_CONVERSATION_EXCERPTS = 6;
const MAX_CONVERSATION_EXCERPT_LENGTH = 180;
const SUMMARY_JSONL_RECORD_LIMIT = 80;
const CODEX_FALLBACK_MAP_CACHE_TTL_MS = 120_000;
const codexIndexCache = new Map<string, {
  mtimeMs: number;
  size: number;
  entries: CodexIndexEntry[];
}>();
const codexFallbackMapCache = new Map<string, {
  expiresAt: number;
  entries: Map<string, SessionFileSummary>;
}>();

export interface FindMonitoredTerminalSessionTitleOptions {
  provider: string;
  cwd: string;
  startedAt: string | number | Date;
  sessionId?: string;
  codexHome?: string;
  claudeHome?: string;
}

export type MonitoredTerminalSessionTitleResult =
  | { status: "pending"; candidateCount: 0 }
  | { status: "ambiguous"; candidateCount: number }
  | {
      status: "resolved";
      title: string;
      sessionId: string;
      candidateCount: number;
    };

export interface ResolveMonitoredTerminalSessionFileOptions {
  provider: string;
  cwd: string;
  sessionId: string;
  codexHome?: string;
  claudeHome?: string;
}

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

function isSummaryDetailRequest(request: ListSessionsRequest): boolean {
  return request.detail === "summary";
}

function trimPreview(value: string): string {
  return trimText(value, MAX_PREVIEW_LENGTH);
}

function trimUserPrompt(value: string): string {
  return trimText(value, MAX_USER_PROMPT_LENGTH);
}

function trimConversationExcerpt(value: string): string {
  return trimText(value, MAX_CONVERSATION_EXCERPT_LENGTH);
}

function trimText(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.slice(0, maxLength);
}

function encodeClaudeProjectPath(cwd: string): string {
  return cwd
    .trim()
    .replace(/\\/g, "/")
    .replace(/[:/]/g, "-")
    .replace(/[^a-zA-Z0-9-]/g, "-");
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

function extractUserPromptTextValue(value: unknown): string {
  if (typeof value === "string") {
    return trimUserPrompt(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractUserPromptTextValue(item);
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
    extractUserPromptTextValue(record.text),
    extractUserPromptTextValue(record.input_text),
    extractUserPromptTextValue(record.content),
    extractUserPromptTextValue(record.message),
    extractUserPromptTextValue(record.parts),
    extractUserPromptTextValue(record.payload),
  );
}

function extractConversationTextValue(value: unknown): string {
  if (typeof value === "string") {
    return trimConversationExcerpt(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractConversationTextValue(item);
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
    extractConversationTextValue(record.text),
    extractConversationTextValue(record.input_text),
    extractConversationTextValue(record.output_text),
    extractConversationTextValue(record.content),
    extractConversationTextValue(record.message),
    extractConversationTextValue(record.parts),
    extractConversationTextValue(record.payload),
  );
}

function getSessionRecordRole(record: Record<string, unknown>): SessionConversationExcerpt["role"] | "" {
  const type = firstString(record.type).toLowerCase();
  const role = firstString(record.role).toLowerCase();
  if (type === "user" || role === "user") {
    return "user";
  }
  if (type === "assistant" || role === "assistant") {
    return "assistant";
  }
  const payload = asRecord(record.payload);
  if (!payload) {
    return "";
  }
  const payloadType = firstString(payload.type).toLowerCase();
  const payloadRole = firstString(payload.role).toLowerCase();
  if (payloadType === "user" || payloadRole === "user") {
    return "user";
  }
  if (payloadType === "assistant" || payloadRole === "assistant") {
    return "assistant";
  }
  return "";
}

function isUserSessionRecord(record: Record<string, unknown>): boolean {
  return getSessionRecordRole(record) === "user";
}

function extractUserPrompt(record: Record<string, unknown>): string {
  if (!isUserSessionRecord(record)) {
    return "";
  }
  const payload = asRecord(record.payload);
  const prompt = firstString(
    extractUserPromptTextValue(record.message),
    extractUserPromptTextValue(record.content),
    extractUserPromptTextValue(payload),
  );
  return isSessionScaffoldPrompt(prompt) ? "" : prompt;
}

function isSessionScaffoldPrompt(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("<environment_context>")
    || trimmed.startsWith("<permissions instructions>")
    || trimmed.startsWith("<collaboration_mode>")
    || trimmed.startsWith("<turn_aborted>")
    || trimmed.startsWith("# AGENTS.md instructions");
}

function collectUserPrompts(records: unknown[]): string[] {
  const prompts: string[] = [];
  for (const recordValue of records) {
    if (prompts.length >= MAX_USER_PROMPTS) {
      break;
    }
    const record = asRecord(recordValue);
    if (!record) {
      continue;
    }
    const prompt = extractUserPrompt(record);
    if (prompt) {
      prompts.push(prompt);
    }
  }
  return prompts;
}

function collectConversationExcerpts(records: unknown[]): SessionConversationExcerpt[] {
  const excerpts: SessionConversationExcerpt[] = [];
  for (const recordValue of records) {
    if (excerpts.length >= MAX_CONVERSATION_EXCERPTS) {
      break;
    }
    const record = asRecord(recordValue);
    if (!record) {
      continue;
    }
    const role = getSessionRecordRole(record);
    if (!role) {
      continue;
    }
    const payload = asRecord(record.payload);
    const text = firstString(
      extractConversationTextValue(record.message),
      extractConversationTextValue(record.content),
      extractConversationTextValue(payload),
    );
    if (!text || isSessionScaffoldPrompt(text)) {
      continue;
    }
    excerpts.push({ role, text });
  }
  return excerpts;
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

async function readFirstJsonlRecords(filePath: string, maxRecords: number): Promise<unknown[]> {
  const fs = await import("node:fs");
  const readline = await import("node:readline");
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });
  const reader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  const records: unknown[] = [];

  try {
    for await (const line of reader) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        break;
      }
      if (records.length >= maxRecords) {
        break;
      }
    }
  } finally {
    reader.close();
    stream.destroy();
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

async function sortClaudeCandidateFilesByMtime(
  candidates: ClaudeCandidateFile[],
): Promise<StatCandidateFile[]> {
  const fs = await import("node:fs/promises");
  const withStats = await Promise.all(candidates.map(async (candidate) => {
    try {
      const stat = await fs.stat(candidate.filePath);
      return { ...candidate, mtimeMs: stat.mtimeMs };
    } catch {
      return null;
    }
  }));
  return withStats
    .filter((candidate): candidate is StatCandidateFile => candidate !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs || left.filePath.localeCompare(right.filePath));
}

function sessionSummaryFromFileSummary(summary: SessionFileSummary): SessionSummary {
  const {
    provider,
    session_id,
    cwd,
    updated_at,
    preview,
    user_prompts,
    conversation_excerpts,
    source_file_relative_path,
  } = summary;
  return {
    provider,
    session_id,
    cwd,
    updated_at,
    preview,
    ...(user_prompts?.length ? { user_prompts } : {}),
    ...(conversation_excerpts?.length ? { conversation_excerpts } : {}),
    ...(source_file_relative_path ? { source_file_relative_path } : {}),
  };
}

async function collectClaudeSessionsPage(options: {
  candidates: ClaudeCandidateFile[];
  request: ListSessionsRequest;
  normalizedCwd?: string;
  displayCwd?: string;
}): Promise<SessionSummary[]> {
  const sortedCandidates = await sortClaudeCandidateFilesByMtime(options.candidates);
  const offset = Math.max(0, options.request.offset ?? 0);
  const limit = options.request.limit && options.request.limit > 0 ? options.request.limit : undefined;
  const cursor = decodeSessionCursor(options.request.cursor);
  const sessions: SessionFileSummary[] = [];
  let skipped = 0;

  for (const candidate of sortedCandidates) {
    try {
      const summary = isSummaryDetailRequest(options.request)
        ? await summarizeClaudeSessionFileFast(candidate.filePath, candidate.fallbackCwd)
        : await summarizeClaudeSessionFile(candidate.filePath, candidate.fallbackCwd);
      if (options.normalizedCwd) {
        const cwdCandidates = summary.cwdCandidates?.length
          ? summary.cwdCandidates
          : [summary.cwd || candidate.fallbackCwd];
        const matchesRequestedCwd = cwdCandidates.some(
          (value) => normalizeComparablePath(value) === options.normalizedCwd,
        );
        if (!matchesRequestedCwd) {
          continue;
        }
      }
      if (cursor && !isSessionAfterCursor(summary, cursor)) {
        continue;
      }
      if (skipped < offset) {
        skipped += 1;
        continue;
      }
      sessions.push(options.displayCwd ? { ...summary, cwd: options.displayCwd } : summary);
      if (limit !== undefined && sessions.length >= limit) {
        break;
      }
    } catch {
      // 单个坏文件不影响其他会话
    }
  }

  return sessions.map(sessionSummaryFromFileSummary);
}

async function summarizeClaudeSessionFileFast(filePath: string, fallbackCwd: string): Promise<SessionFileSummary> {
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const records = await readFirstJsonlRecords(filePath, SUMMARY_JSONL_RECORD_LIMIT);
  const stat = await fs.stat(filePath);
  let preview = "";
  let cwd = fallbackCwd;
  const cwdCandidates: string[] = [];
  const seenCwds = new Set<string>();
  const userPrompts = collectUserPrompts(records);
  const conversationExcerpts = collectConversationExcerpts(records);

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
    if (preview && userPrompts.length >= MAX_USER_PROMPTS) {
      break;
    }
  }

  const sessionId = path.basename(filePath, ".jsonl");
  return {
    provider: "claude",
    session_id: sessionId,
    cwd,
    updated_at: stat.mtime.toISOString(),
    preview: preview || userPrompts[0] || sessionId,
    ...(userPrompts.length > 0 ? { user_prompts: userPrompts } : {}),
    ...(conversationExcerpts.length > 0 ? { conversation_excerpts: conversationExcerpts } : {}),
    filePath,
    cwdCandidates: cwdCandidates.length > 0 ? cwdCandidates : [cwd],
  };
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
  const userPrompts = collectUserPrompts(records);
  const conversationExcerpts = collectConversationExcerpts(records);

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
    ...(userPrompts.length > 0 ? { user_prompts: userPrompts } : {}),
    ...(conversationExcerpts.length > 0 ? { conversation_excerpts: conversationExcerpts } : {}),
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
  const userPrompts = collectUserPrompts(records);
  const conversationExcerpts = collectConversationExcerpts(records);

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

  const displayPreview = firstString(
    preview && !isSessionScaffoldPrompt(preview) ? preview : "",
    userPrompts[0],
    sessionId,
  );

  return {
    provider: "codex",
    session_id: sessionId,
    cwd,
    updated_at: updatedAt,
    preview: displayPreview,
    ...(userPrompts.length > 0 ? { user_prompts: userPrompts } : {}),
    ...(conversationExcerpts.length > 0 ? { conversation_excerpts: conversationExcerpts } : {}),
    filePath,
  };
}

async function buildCodexFallbackMap(sessionsRoot: string): Promise<Map<string, SessionFileSummary>> {
  const path = await import("node:path");
  const cacheKey = normalizeComparablePath(sessionsRoot);
  const cached = codexFallbackMapCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.entries;
  }
  if (cached) {
    codexFallbackMapCache.delete(cacheKey);
  }

  const map = new Map<string, SessionFileSummary>();
  const filePaths = await walkJsonlFiles(sessionsRoot);
  for (const filePath of filePaths) {
    try {
      const parsedSummary = await summarizeCodexSessionFile(filePath);
      const relativePath = path.relative(sessionsRoot, parsedSummary.filePath);
      const summary: SessionFileSummary = {
        ...parsedSummary,
        ...(relativePath ? { source_file_relative_path: relativePath } : {}),
      };
      const existing = map.get(summary.session_id);
      if (!existing || compareUpdatedAtDesc(summary, existing) < 0) {
        map.set(summary.session_id, summary);
      }
    } catch {
      // 单个坏文件不影响其他会话
    }
  }
  codexFallbackMapCache.set(cacheKey, {
    expiresAt: Date.now() + CODEX_FALLBACK_MAP_CACHE_TTL_MS,
    entries: map,
  });
  return map;
}

async function summarizeCodexSessionFileFast(filePath: string): Promise<SessionFileSummary> {
  const fs = await import("node:fs/promises");
  const records = await readFirstJsonlRecords(filePath, SUMMARY_JSONL_RECORD_LIMIT);
  const stat = await fs.stat(filePath);

  let sessionId = inferSessionIdFromFilePath(filePath);
  let cwd = "";
  let preview = "";
  let updatedAt = stat.mtime.toISOString();
  const userPrompts = collectUserPrompts(records);
  const conversationExcerpts = collectConversationExcerpts(records);

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
    preview: firstString(
      preview && !isSessionScaffoldPrompt(preview) ? preview : "",
      userPrompts[0],
      sessionId,
    ),
    ...(userPrompts.length > 0 ? { user_prompts: userPrompts } : {}),
    ...(conversationExcerpts.length > 0 ? { conversation_excerpts: conversationExcerpts } : {}),
    filePath,
  };
}

async function findCodexSessionFile(root: string, sessionId: string): Promise<SessionFileSummary | null> {
  const filePaths = await walkJsonlFiles(root);
  const filePath = filePaths.find((candidate) => candidate.includes(sessionId));
  return filePath ? summarizeCodexSessionFileFast(filePath) : null;
}

async function findCodexSessionFileFromIndex(root: string, sessionId: string): Promise<SessionFileSummary | null> {
  const path = await import("node:path");
  const indexEntries = await readCodexIndex(path.join(root, "session_index.jsonl"));
  const entry = indexEntries.find((candidate) => candidate.session_id === sessionId);
  if (!entry) {
    return null;
  }
  return summarizeCodexSessionFromIndex(root, entry);
}

async function summarizeKnownCodexSessionFile(
  sourceHome: string,
  sourceFileRelativePath: string,
  sessionId: string,
): Promise<SessionFileSummary | null> {
  const path = await import("node:path");
  const trimmedRelativePath = sourceFileRelativePath.trim();
  if (!trimmedRelativePath) {
    return null;
  }
  const sessionsRoot = path.join(sourceHome, "sessions");
  const sourcePath = path.resolve(sessionsRoot, trimmedRelativePath);
  const resolvedSessionsRoot = path.resolve(sessionsRoot);
  if (sourcePath !== resolvedSessionsRoot && !sourcePath.startsWith(`${resolvedSessionsRoot}${path.sep}`)) {
    return null;
  }

  try {
    const summary = await summarizeCodexSessionFileFast(sourcePath);
    if (summary.session_id !== sessionId) {
      return null;
    }
    return {
      ...summary,
      source_file_relative_path: path.relative(sessionsRoot, summary.filePath),
    };
  } catch {
    return null;
  }
}

async function readCodexIndex(indexPath: string): Promise<CodexIndexEntry[]> {
  const fs = await import("node:fs/promises");
  try {
    const stat = await fs.stat(indexPath);
    const cached = codexIndexCache.get(indexPath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return cached.entries;
    }
    if (cached && stat.size > cached.size) {
      const handle = await fs.open(indexPath, "r");
      try {
        const buffer = Buffer.alloc(stat.size - cached.size);
        await handle.read(buffer, 0, buffer.length, cached.size);
        const appendedEntries: CodexIndexEntry[] = [];
        let validTail = true;
        for (const line of buffer.toString("utf-8").split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
          try {
            const entry = parseCodexIndexEntry(JSON.parse(line));
            if (entry) {
              appendedEntries.push(entry);
            }
          } catch {
            validTail = false;
            break;
          }
        }
        if (validTail) {
          const entries = [...cached.entries, ...appendedEntries];
          codexIndexCache.set(indexPath, {
            mtimeMs: stat.mtimeMs,
            size: stat.size,
            entries,
          });
          return entries;
        }
      } finally {
        await handle.close();
      }
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
    codexFallbackMapCache.clear();
    return;
  }
  const normalizedHome = normalizeComparablePath(home);
  for (const key of Array.from(codexFallbackMapCache.keys())) {
    if (key.startsWith(normalizedHome)) {
      codexFallbackMapCache.delete(key);
    }
  }
}

function codexSummaryFromCompleteIndexEntry(entry: CodexIndexEntry): SessionSummary | null {
  if (!entry.session_id || !entry.updated_at) {
    return null;
  }
  return {
    provider: "codex",
    session_id: entry.session_id,
    cwd: entry.cwd,
    updated_at: entry.updated_at,
    preview: firstString(entry.preview, entry.session_id),
  };
}

function requestedPageEnd(request: ListSessionsRequest): number | null {
  const limit = request.limit && request.limit > 0 ? request.limit : undefined;
  if (limit === undefined) {
    return null;
  }
  return Math.max(0, request.offset ?? 0) + limit;
}

async function summarizeCodexSessionFromIndex(
  root: string,
  entry: CodexIndexEntry,
): Promise<SessionFileSummary | null> {
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
  const summary = await summarizeCodexSessionFileFast(filePath);
  const relativePath = path.relative(path.join(root, "sessions"), summary.filePath);
  return {
    ...summary,
    ...(relativePath ? { source_file_relative_path: relativePath } : {}),
  };
}

function compareUpdatedAtDesc(left: { updated_at: string }, right: { updated_at: string }): number {
  const leftTime = new Date(left.updated_at).getTime();
  const rightTime = new Date(right.updated_at).getTime();
  const safeLeftTime = Number.isNaN(leftTime) ? 0 : leftTime;
  const safeRightTime = Number.isNaN(rightTime) ? 0 : rightTime;
  return safeRightTime - safeLeftTime;
}

async function summarizeCodexIndexEntryForList(
  root: string,
  entry: CodexIndexEntry,
  normalizedCwd: string,
  loadProjectDetails: boolean,
): Promise<SessionSummary | null> {
  let targetedSummary: SessionSummary | null = null;
  if (normalizedCwd && (!entry.cwd || !entry.preview || loadProjectDetails)) {
    try {
      targetedSummary = await summarizeCodexSessionFromIndex(root, entry);
    } catch {
      targetedSummary = null;
    }
  }

  const cwd = firstString(entry.cwd, targetedSummary?.cwd);
  if (normalizedCwd && normalizeComparablePath(cwd) !== normalizedCwd) {
    return null;
  }

  const userPrompts = targetedSummary?.user_prompts;
  const conversationExcerpts = targetedSummary?.conversation_excerpts;
  const sourceFileRelativePath = targetedSummary?.source_file_relative_path;
  return {
    provider: "codex",
    session_id: entry.session_id,
    cwd,
    updated_at: firstString(entry.updated_at, targetedSummary?.updated_at),
    preview: firstString(entry.preview, targetedSummary?.preview, entry.session_id),
    ...(userPrompts?.length ? { user_prompts: userPrompts } : {}),
    ...(conversationExcerpts?.length ? { conversation_excerpts: conversationExcerpts } : {}),
    ...(sourceFileRelativePath ? { source_file_relative_path: sourceFileRelativePath } : {}),
  };
}

async function listCodexSessionsFromIndexPage(
  root: string,
  indexEntries: CodexIndexEntry[],
  request: ListSessionsRequest,
  normalizedCwd: string,
): Promise<SessionSummary[]> {
  if (requestedPageEnd(request) === null && !request.cursor) {
    const path = await import("node:path");
    const fallbackMap = await buildCodexFallbackMap(path.join(root, "sessions"));
    const merged = new Map<string, SessionSummary>();
    for (const entry of [...indexEntries].sort(compareUpdatedAtDesc)) {
      const indexed = await summarizeCodexIndexEntryForList(root, entry, "", false);
      const file = fallbackMap.get(entry.session_id);
      const summary = indexed
        ? {
            ...sessionSummaryFromFileSummary(file ?? ({ ...indexed, filePath: "" } as SessionFileSummary)),
            ...indexed,
            cwd: indexed.cwd || file?.cwd || "",
            preview: indexed.preview || file?.preview || indexed.session_id,
            user_prompts: file?.user_prompts ?? indexed.user_prompts,
            conversation_excerpts: file?.conversation_excerpts ?? indexed.conversation_excerpts,
            source_file_relative_path: file?.source_file_relative_path ?? indexed.source_file_relative_path,
          }
        : file ? sessionSummaryFromFileSummary(file) : null;
      if (!summary || (normalizedCwd && normalizeComparablePath(summary.cwd) !== normalizedCwd)) {
        continue;
      }
      merged.set(summary.session_id, summary);
    }
    for (const file of fallbackMap.values()) {
      if (merged.has(file.session_id)) {
        continue;
      }
      const summary = sessionSummaryFromFileSummary(file);
      if (!normalizedCwd || normalizeComparablePath(summary.cwd) === normalizedCwd) {
        merged.set(summary.session_id, summary);
      }
    }
    return Array.from(merged.values()).sort(compareUpdatedAtDesc);
  }

  const sortedEntries = [...indexEntries].sort(compareUpdatedAtDesc);
  const summaries: SessionSummary[] = [];
  const needed = requestedPageEnd(request) ?? Number.POSITIVE_INFINITY;
  const cursor = decodeSessionCursor(request.cursor);
  for (const entry of sortedEntries) {
    const summary = normalizedCwd
      ? await summarizeCodexIndexEntryForList(root, entry, normalizedCwd, true)
      : codexSummaryFromCompleteIndexEntry(entry);
    if (!summary) {
      continue;
    }
    if (cursor && !isSessionAfterCursor(summary, cursor)) {
      continue;
    }
    summaries.push(summary);
    if (summaries.length >= needed) {
      break;
    }
  }
  return paginatedSessions(summaries, { ...request, cursor: undefined });
}

async function listCodexFallbackSessionsPage(
  sessionsRoot: string,
  request: ListSessionsRequest,
  normalizedCwd: string,
): Promise<SessionSummary[]> {
  const fallbackMap = await buildCodexFallbackMap(sessionsRoot);
  const sessions: SessionSummary[] = [];

  for (const fileSummary of fallbackMap.values()) {
    const summary = sessionSummaryFromFileSummary(fileSummary);
    if (normalizedCwd && normalizeComparablePath(summary.cwd) !== normalizedCwd) {
      continue;
    }
    sessions.push(summary);
  }

  return paginatedSessions(sessions.sort(compareUpdatedAtDesc), request);
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker()),
  );
  return results;
}

function catalogEntryKey(filePath: string): string {
  return normalizeComparablePath(filePath);
}

export async function scanCodexSessionCatalog(
  codexHome: string,
  previousEntries: ReadonlyMap<string, SessionCatalogFileEntry> = new Map(),
): Promise<SessionCatalogFileEntry[]> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const sessionsRoot = path.join(codexHome, "sessions");
  const filePaths = await walkJsonlFiles(sessionsRoot);
  const candidates = (await Promise.all(filePaths.map(async (filePath) => {
    try {
      const stat = await fs.stat(filePath);
      return { filePath, mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      return null;
    }
  })))
    .filter((candidate): candidate is { filePath: string; mtimeMs: number; size: number } => candidate !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  const entries = await mapWithConcurrency(candidates, 8, async (candidate) => {
    const previous = previousEntries.get(catalogEntryKey(candidate.filePath));
    if (previous && previous.mtime_ms === candidate.mtimeMs && previous.size === candidate.size) {
      return previous;
    }
    const summary = await summarizeCodexSessionFileFast(candidate.filePath);
    const relativePath = path.relative(sessionsRoot, candidate.filePath);
    return {
      summary: {
        ...sessionSummaryFromFileSummary(summary),
        ...(relativePath ? { source_file_relative_path: relativePath } : {}),
      },
      file_path: candidate.filePath,
      mtime_ms: candidate.mtimeMs,
      size: candidate.size,
    };
  });
  return entries;
}

export async function scanClaudeSessionCatalog(
  previousEntries: ReadonlyMap<string, SessionCatalogFileEntry> = new Map(),
  claudeHome?: string,
): Promise<SessionCatalogFileEntry[]> {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const configRoot = claudeHome
    ? (path.basename(claudeHome) === "projects" ? path.dirname(claudeHome) : claudeHome)
    : (process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude"));
  const projectsRoot = path.join(configRoot, "projects");

  let projectEntries;
  try {
    projectEntries = await fs.readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates: ClaudeCandidateFile[] = [];
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) {
      continue;
    }
    const projectDir = path.join(projectsRoot, projectEntry.name);
    const filePaths = await collectClaudeCandidateFiles(projectDir);
    candidates.push(...filePaths.map((filePath) => ({ filePath, fallbackCwd: projectDir })));
  }

  const withStats = (await Promise.all(candidates.map(async (candidate) => {
    try {
      const stat = await fs.stat(candidate.filePath);
      return { ...candidate, mtimeMs: stat.mtimeMs, size: stat.size };
    } catch {
      return null;
    }
  })))
    .filter((candidate): candidate is ClaudeCandidateFile & { mtimeMs: number; size: number } => candidate !== null)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);

  return mapWithConcurrency(withStats, 8, async (candidate) => {
    const previous = previousEntries.get(catalogEntryKey(candidate.filePath));
    if (previous && previous.mtime_ms === candidate.mtimeMs && previous.size === candidate.size) {
      return previous;
    }
    const summary = await summarizeClaudeSessionFileFast(candidate.filePath, candidate.fallbackCwd);
    return {
      summary: sessionSummaryFromFileSummary(summary),
      file_path: candidate.filePath,
      mtime_ms: candidate.mtimeMs,
      size: candidate.size,
    };
  });
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

  if (request.scope === "project") {
    const cwd = requireProjectCwd(request);
    const normalizedCwd = normalizeComparablePath(cwd);
    const projectDir = path.join(projectsRoot, encodeClaudeProjectPath(cwd));
    const candidateFiles = await collectClaudeCandidateFiles(projectDir);
    return collectClaudeSessionsPage({
      candidates: candidateFiles.map((filePath) => ({ filePath, fallbackCwd: cwd })),
      request,
      normalizedCwd,
      displayCwd: cwd,
    });
  }

  let projectEntries;
  try {
    projectEntries = await fs.readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return [];
  }

  const candidates: ClaudeCandidateFile[] = [];
  for (const entry of projectEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const projectDir = path.join(projectsRoot, entry.name);
    const candidateFiles = await collectClaudeCandidateFiles(projectDir);
    candidates.push(...candidateFiles.map((filePath) => ({ filePath, fallbackCwd: projectDir })));
  }

  return collectClaudeSessionsPage({ candidates, request });
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
  if (indexEntries.length > 0) {
    return listCodexSessionsFromIndexPage(root, indexEntries, request, normalizedCwd);
  }
  return listCodexFallbackSessionsPage(path.join(root, "sessions"), request, normalizedCwd);
}

function parseSessionTimeMs(value: string): number {
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function parseStartedAtMs(value: FindMonitoredTerminalSessionTitleOptions["startedAt"]): number {
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function previewFromMonitoredSession(session?: SessionSummary): string {
  return session?.preview.trim() ?? "";
}

export async function findMonitoredTerminalSessionTitle(
  options: FindMonitoredTerminalSessionTitleOptions,
): Promise<MonitoredTerminalSessionTitleResult> {
  const cwd = options.cwd.trim();
  if (!cwd) {
    return { status: "pending", candidateCount: 0 };
  }

  const provider = normalizeProvider(options.provider);
  const sessionId = options.sessionId?.trim();
  const request: ListSessionsRequest = {
    provider,
    scope: "project",
    cwd,
    ...(sessionId ? {} : { limit: 20 }),
  };
  if (provider === PROVIDER_CODEX) {
    invalidateCodexSessionCache(options.codexHome);
  }
  const sessions = provider === PROVIDER_CODEX
    ? await listCodexSessions(request, options.codexHome)
    : await listClaudeSessions(request, options.claudeHome);

  if (sessionId) {
    const selectedTitle = previewFromMonitoredSession(
      sessions.find((session) => session.session_id === sessionId),
    );
    if (selectedTitle) {
      return {
        status: "resolved",
        title: selectedTitle,
        sessionId,
        candidateCount: 1,
      };
    }
    return { status: "pending", candidateCount: 0 };
  }

  const startedAtMs = parseStartedAtMs(options.startedAt);
  const matchedSessions = sessions.filter((session) =>
    previewFromMonitoredSession(session)
    && parseSessionTimeMs(session.updated_at) >= startedAtMs
    && normalizeProvider(session.provider) === provider
    && (provider === PROVIDER_CLAUDE || provider === PROVIDER_CODEX)
  );
  if (matchedSessions.length === 0) {
    return { status: "pending", candidateCount: 0 };
  }
  if (matchedSessions.length > 1) {
    return { status: "ambiguous", candidateCount: matchedSessions.length };
  }
  const matchedSession = matchedSessions[0];
  return {
    status: "resolved",
    title: previewFromMonitoredSession(matchedSession),
    sessionId: matchedSession.session_id,
    candidateCount: 1,
  };
}

export async function resolveMonitoredTerminalSessionFile(
  options: ResolveMonitoredTerminalSessionFileOptions,
): Promise<string | undefined> {
  const path = await import("node:path");
  const os = await import("node:os");
  const provider = normalizeProvider(options.provider);
  const sessionId = options.sessionId.trim();
  if (!sessionId) {
    return undefined;
  }

  if (provider === PROVIDER_CLAUDE) {
    const configRoot = options.claudeHome
      ? (path.basename(options.claudeHome) === "projects"
        ? path.dirname(options.claudeHome)
        : options.claudeHome)
      : (process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude"));
    const projectDir = path.join(configRoot, "projects", encodeClaudeProjectPath(options.cwd));
    const candidates = await collectClaudeCandidateFiles(projectDir);
    return candidates.find((candidate) => path.basename(candidate, ".jsonl") === sessionId);
  }

  if (provider === PROVIDER_CODEX) {
    const root = options.codexHome || path.join(os.homedir(), ".codex");
    const summary = await findCodexSessionFile(path.join(root, "sessions"), sessionId);
    return summary?.filePath;
  }
  return undefined;
}

export async function listCodexSessionsFromHomes(
  request: ListSessionsRequest,
  homes: CodexSessionHome[],
  loaders: CodexHomesLoaders = {},
): Promise<SessionSummary[]> {
  const merged = new Map<string, SessionSummary>();
  const requestedLimit = request.limit && request.limit > 0 ? request.limit : undefined;
  const requestedOffset = Math.max(0, request.offset ?? 0);
  const perHomeLimit = requestedLimit === undefined ? undefined : requestedOffset + requestedLimit;
  const loadCodexSessions = loaders.listCodexSessions ?? listCodexSessions;

  const pages = await Promise.all(
    homes
      .filter((source) => source.home.trim())
      .map(async (source) => ({
        source,
        sessions: await loadCodexSessions({
          ...request,
          limit: perHomeLimit,
          offset: 0,
        }, source.home),
      })),
  );

  for (const { source, sessions } of pages) {
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

export async function getClaudeSessionDetail(
  request: GetSessionDetailRequest,
  claudeHome?: string,
): Promise<SessionSummary | null> {
  const path = await import("node:path");
  const os = await import("node:os");
  const sessionId = request.session_id.trim();
  if (!sessionId) {
    return null;
  }

  const configRoot = claudeHome
    ? (path.basename(claudeHome) === "projects" ? path.dirname(claudeHome) : claudeHome)
    : (process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude"));
  const projectsRoot = path.join(configRoot, "projects");
  if (request.scope === "project") {
    const cwd = requireProjectCwd(request);
    const projectDir = path.join(projectsRoot, encodeClaudeProjectPath(cwd));
    const candidateFiles = await collectClaudeCandidateFiles(projectDir);
    const filePath = candidateFiles.find((candidate) => path.basename(candidate, ".jsonl") === sessionId);
    if (!filePath) {
      return null;
    }
    const summary = await summarizeClaudeSessionFileFast(filePath, cwd);
    return {
      ...sessionSummaryFromFileSummary(summary),
      cwd,
    };
  }

  let projectEntries;
  try {
    projectEntries = await (await import("node:fs/promises")).readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of projectEntries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const projectDir = path.join(projectsRoot, entry.name);
    const candidates = await collectClaudeCandidateFiles(projectDir);
    const filePath = candidates.find((candidate) => path.basename(candidate, ".jsonl") === sessionId);
    if (!filePath) {
      continue;
    }
    return sessionSummaryFromFileSummary(await summarizeClaudeSessionFileFast(filePath, projectDir));
  }
  return null;
}

export async function getCodexSessionDetail(
  request: GetSessionDetailRequest,
  codexHome?: string,
): Promise<SessionSummary | null> {
  const path = await import("node:path");
  const os = await import("node:os");
  const sessionId = request.session_id.trim();
  if (!sessionId) {
    return null;
  }

  const root = request.source_home?.trim() || codexHome || path.join(os.homedir(), ".codex");
  const fileSummary = (await summarizeKnownCodexSessionFile(
    root,
    request.source_file_relative_path ?? "",
    sessionId,
  ))
    ?? (await findCodexSessionFileFromIndex(root, sessionId))
    ?? (await findCodexSessionFile(path.join(root, "sessions"), sessionId));
  if (!fileSummary) {
    return null;
  }

  return {
    ...sessionSummaryFromFileSummary(fileSummary),
    ...(request.source_kind ? { source_kind: request.source_kind } : {}),
    source_home: root,
  };
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

function codexIndexRecordFromFileSummary(summary: SessionFileSummary): Record<string, string> {
  return {
    id: summary.session_id,
    thread_name: summary.preview,
    updated_at: summary.updated_at,
    cwd: summary.cwd,
  };
}

async function mergeCodexIndexEntry(
  sourceHome: string,
  runtimeHome: string,
  sessionId: string,
  fallbackSummary: SessionFileSummary,
): Promise<void> {
  const path = await import("node:path");
  const sourceRecords = await safeReadJsonl(path.join(sourceHome, "session_index.jsonl")).catch(() => []);
  const selectedRecords = sourceRecords.filter((record) => parseCodexIndexEntry(record)?.session_id === sessionId);
  const sourceIndexRecords = selectedRecords.length > 0
    ? selectedRecords
    : [codexIndexRecordFromFileSummary(fallbackSummary)];

  const targetPath = path.join(runtimeHome, "session_index.jsonl");
  const existingRecords = await safeReadJsonl(targetPath).catch(() => []);
  const existingIds = new Set(
    existingRecords
      .map((record) => parseCodexIndexEntry(record)?.session_id)
      .filter((id): id is string => !!id),
  );
  const nextRecords = sourceIndexRecords.filter((record) => {
    const id = parseCodexIndexEntry(record)?.session_id;
    return id && !existingIds.has(id);
  });

  if (nextRecords.length === 0) {
    return;
  }
  await writeJsonlRecords(targetPath, [...existingRecords, ...nextRecords]);
  invalidateCodexSessionCache(runtimeHome);
}

export async function importCodexSessionToRuntimeHome(options: {
  sessionId: string;
  sourceHome: string;
  runtimeHome: string;
  sourceFileRelativePath?: string;
}): Promise<void> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const sessionId = options.sessionId.trim();
  if (!sessionId) {
    throw new Error("恢复指定会话时必须提供 sessionId。");
  }

  const sourceSummary = (await summarizeKnownCodexSessionFile(
    options.sourceHome,
    options.sourceFileRelativePath ?? "",
    sessionId,
  ))
    ?? (await findCodexSessionFileFromIndex(options.sourceHome, sessionId))
    ?? (await findCodexSessionFile(path.join(options.sourceHome, "sessions"), sessionId));
  if (!sourceSummary) {
    throw new Error("全局 .codex 中未找到该会话文件，无法导入恢复。");
  }

  const relativePath = sourceSummary.source_file_relative_path
    ?? path.relative(path.join(options.sourceHome, "sessions"), sourceSummary.filePath);
  const targetPath = path.join(options.runtimeHome, "sessions", relativePath);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.copyFile(sourceSummary.filePath, targetPath);
  await mergeCodexIndexEntry(options.sourceHome, options.runtimeHome, sessionId, sourceSummary);
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

export async function getSessionDetailForProvider(
  request: GetSessionDetailRequest,
  loaders: SessionDetailLoaders = {
    getClaudeSessionDetail,
    getCodexSessionDetail,
  },
): Promise<SessionSummary | null> {
  if (!isSessionListScope(request.scope)) {
    throw new Error("invalid session list scope");
  }
  if (request.scope === "project") {
    requireProjectCwd(request);
  }
  if (!request.session_id.trim()) {
    throw new Error("session detail requires session_id");
  }
  if (normalizeProvider(request.provider) === PROVIDER_CODEX) {
    return loaders.getCodexSessionDetail(request);
  }
  return loaders.getClaudeSessionDetail(request);
}

export { encodeClaudeProjectPath };
