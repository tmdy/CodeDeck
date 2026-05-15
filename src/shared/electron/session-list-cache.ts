import path from "node:path";
import type {
  CodexSessionHome,
  ListSessionsRequest,
  SessionSummary,
} from "../services/session-service.js";

interface SessionListCacheEntry {
  provider: string;
  expiresAt: number;
  sessions: SessionSummary[];
}

interface SessionListInflightEntry {
  provider: string;
  promise: Promise<SessionSummary[]>;
}

export interface SessionListCache {
  run(options: {
    request: ListSessionsRequest;
    codexHomes: CodexSessionHome[];
    load: () => Promise<SessionSummary[]>;
  }): Promise<SessionSummary[]>;
  invalidate(provider?: string): void;
}

function normalizeCachePath(value?: string): string {
  if (!value?.trim()) {
    return "";
  }
  return path.resolve(value).replace(/\\/g, "/");
}

function normalizeProvider(value: string): string {
  return value.trim().toLowerCase();
}

export function buildSessionListCacheKey(
  request: ListSessionsRequest,
  codexHomes: CodexSessionHome[],
): string {
  const normalizedRequest = {
    provider: normalizeProvider(request.provider),
    scope: request.scope,
    cwd: normalizeCachePath(request.cwd),
    profile_key: request.profile_key?.trim() ?? "",
    limit: request.limit ?? 0,
    offset: request.offset ?? 0,
  };
  const normalizedHomes = codexHomes
    .map((home) => ({
      kind: home.kind,
      home: normalizeCachePath(home.home),
    }))
    .sort((left, right) => `${left.kind}:${left.home}`.localeCompare(`${right.kind}:${right.home}`));
  return JSON.stringify({
    request: normalizedRequest,
    codexHomes: normalizedHomes,
  });
}

export function createSessionListCache(options: {
  ttlMs?: number;
  nowMs?: () => number;
} = {}): SessionListCache {
  const ttlMs = options.ttlMs ?? 5_000;
  const nowMs = options.nowMs ?? Date.now;
  const cache = new Map<string, SessionListCacheEntry>();
  const inflight = new Map<string, SessionListInflightEntry>();

  function invalidate(provider?: string): void {
    const normalizedProvider = provider ? normalizeProvider(provider) : "";
    if (!normalizedProvider) {
      cache.clear();
      inflight.clear();
      return;
    }

    for (const [key, entry] of cache.entries()) {
      if (entry.provider === normalizedProvider) {
        cache.delete(key);
      }
    }
    for (const [key, entry] of inflight.entries()) {
      if (entry.provider === normalizedProvider) {
        inflight.delete(key);
      }
    }
  }

  async function run(options: {
    request: ListSessionsRequest;
    codexHomes: CodexSessionHome[];
    load: () => Promise<SessionSummary[]>;
  }): Promise<SessionSummary[]> {
    const key = buildSessionListCacheKey(options.request, options.codexHomes);
    const provider = normalizeProvider(options.request.provider);
    const cached = cache.get(key);

    if (cached && cached.expiresAt > nowMs()) {
      return cached.sessions;
    }
    if (cached) {
      cache.delete(key);
    }

    const running = inflight.get(key);
    if (running) {
      return running.promise;
    }

    const promise = options.load()
      .then((sessions) => {
        const active = inflight.get(key);
        if (active?.promise === promise) {
          cache.set(key, {
            provider,
            expiresAt: nowMs() + ttlMs,
            sessions,
          });
        }
        return sessions;
      })
      .finally(() => {
        const active = inflight.get(key);
        if (active?.promise === promise) {
          inflight.delete(key);
        }
      });

    inflight.set(key, { provider, promise });
    return promise;
  }

  return {
    run,
    invalidate,
  };
}
