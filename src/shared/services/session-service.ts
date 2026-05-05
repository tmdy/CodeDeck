// 会话服务 — 会话扫描和解析

export interface SessionSummary {
  session_id: string;
  cwd: string;
  updated_at: string;
  preview: string;
}

interface SessionListLoaders {
  listClaudeSessions: (cwd: string) => Promise<SessionSummary[]>;
  listCodexSessions: (cwd: string) => Promise<SessionSummary[]>;
}

interface SessionFileSummary extends SessionSummary {
  filePath: string;
}

interface CodexIndexEntry {
  session_id: string;
  cwd: string;
  updated_at: string;
  preview: string;
}

const MAX_PREVIEW_LENGTH = 120;

function normalizeComparablePath(value: string): string {
  return value.trim().replace(/\\/g, "/").toLowerCase();
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

  for (const recordValue of records) {
    const record = asRecord(recordValue);
    if (!record) {
      continue;
    }
    cwd = firstString(record.cwd, cwd);
    if (!preview) {
      preview = firstString(
        extractTextValue(record.message),
        extractTextValue(record.content),
      );
    }
  }

  const sessionId = path.basename(filePath, ".jsonl");
  return {
    session_id: sessionId,
    cwd,
    updated_at: stat.mtime.toISOString(),
    preview: preview || sessionId,
    filePath,
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

async function readCodexIndex(indexPath: string): Promise<CodexIndexEntry[]> {
  try {
    const records = await safeReadJsonl(indexPath);
    return records
      .map((record) => parseCodexIndexEntry(record))
      .filter((record): record is CodexIndexEntry => record !== null);
  } catch {
    return [];
  }
}

export async function listClaudeSessions(
  cwd: string,
  claudeHome?: string,
): Promise<SessionSummary[]> {
  const path = await import("node:path");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");

  const configRoot = claudeHome
    ? (path.basename(claudeHome) === "projects" ? path.dirname(claudeHome) : claudeHome)
    : (process.env.CLAUDE_CONFIG_DIR?.trim() || path.join(os.homedir(), ".claude"));
  const projectsRoot = path.join(configRoot, "projects");
  const normalizedCwd = normalizeComparablePath(cwd);
  const sessions: SessionFileSummary[] = [];

  if (normalizedCwd) {
    const projectDir = path.join(projectsRoot, encodeClaudeProjectPath(cwd));
    const candidateFiles = await collectClaudeCandidateFiles(projectDir);
    for (const filePath of candidateFiles) {
      try {
        const summary = await summarizeClaudeSessionFile(filePath, cwd);
        if (normalizeComparablePath(summary.cwd || cwd) === normalizedCwd) {
          sessions.push(summary);
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

  return sessions.map(({ session_id, cwd: sessionCwd, updated_at, preview }) => ({
    session_id,
    cwd: sessionCwd,
    updated_at,
    preview,
  }));
}

export async function listCodexSessions(
  cwd: string,
  codexHome?: string,
): Promise<SessionSummary[]> {
  const path = await import("node:path");
  const os = await import("node:os");

  const root = codexHome || path.join(os.homedir(), ".codex");
  const normalizedCwd = normalizeComparablePath(cwd);
  const indexEntries = await readCodexIndex(path.join(root, "session_index.jsonl"));
  const needsFallback = normalizedCwd.length > 0 || indexEntries.some((entry) => !entry.cwd || !entry.preview);
  const fallbackMap = needsFallback ? await buildCodexFallbackMap(path.join(root, "sessions")) : new Map();

  const mergedFromIndex = indexEntries.map((entry) => {
    const fallback = fallbackMap.get(entry.session_id);
    return {
      session_id: entry.session_id,
      cwd: firstString(entry.cwd, fallback?.cwd),
      updated_at: firstString(entry.updated_at, fallback?.updated_at),
      preview: firstString(entry.preview, fallback?.preview, entry.session_id),
    } satisfies SessionSummary;
  });

  const baseSessions = mergedFromIndex.length > 0
    ? mergedFromIndex
    : Array.from(fallbackMap.values()).map(({ session_id, cwd: sessionCwd, updated_at, preview }) => ({
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

  return filteredSessions;
}

export async function listSessionsForProvider(
  provider: string,
  cwd: string,
  loaders: SessionListLoaders = {
    listClaudeSessions,
    listCodexSessions,
  },
): Promise<SessionSummary[]> {
  if (provider === "codex") {
    return loaders.listCodexSessions(cwd);
  }
  return loaders.listClaudeSessions(cwd);
}

export { encodeClaudeProjectPath };
