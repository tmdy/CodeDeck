import { describe, expect, it, vi } from "vitest";
import type {
  CodexSessionHome,
  ListSessionsRequest,
  SessionSummary,
} from "../../services/session-service.js";
import {
  buildSessionListCacheKey,
  createSessionListCache,
} from "../../electron/session-list-cache.js";

function createRequest(overrides: Partial<ListSessionsRequest> = {}): ListSessionsRequest {
  return {
    provider: "codex",
    scope: "global_recent",
    ...overrides,
  };
}

function createSession(sessionId: string): SessionSummary {
  return {
    provider: "codex",
    session_id: sessionId,
    cwd: "C:/workspace/project",
    updated_at: "2026-05-15T12:00:00.000Z",
    preview: sessionId,
  };
}

describe("session-list-cache", () => {
  it("normalizes request paths and home order when building cache keys", () => {
    const request = createRequest({
      provider: " Codex ",
      scope: "project",
      cwd: "C:/workspace/project/../project",
      profile_key: "codex::Official",
      limit: 20,
      offset: 40,
    });
    const homes: CodexSessionHome[] = [
      { kind: "global_codex", home: "C:/Users/99395/.codex" },
      { kind: "app_runtime", home: "C:/workspace/runtime-home" },
    ];

    const keyA = buildSessionListCacheKey(request, homes);
    const keyB = buildSessionListCacheKey(
      createRequest({
        provider: "codex",
        scope: "project",
        cwd: "C:/workspace/project",
        profile_key: "codex::Official",
        limit: 20,
        offset: 40,
      }),
      [...homes].reverse(),
    );

    expect(keyA).toBe(keyB);
  });

  it("deduplicates in-flight loads and reuses cached results until ttl expires", async () => {
    let now = 1_000;
    let resolveLoad!: (value: SessionSummary[]) => void;
    const cache = createSessionListCache({
      ttlMs: 5_000,
      nowMs: () => now,
    });
    const load = vi.fn().mockImplementation(
      () => new Promise<SessionSummary[]>((resolve) => {
        resolveLoad = resolve;
      }),
    );
    const request = createRequest({ scope: "project", cwd: "C:/workspace/project" });
    const codexHomes: CodexSessionHome[] = [{ kind: "app_runtime", home: "C:/workspace/runtime-home" }];

    const first = cache.run({ request, codexHomes, load });
    const second = cache.run({ request, codexHomes, load });

    expect(load).toHaveBeenCalledTimes(1);

    resolveLoad([createSession("session-1")]);

    await expect(first).resolves.toEqual([createSession("session-1")]);
    await expect(second).resolves.toEqual([createSession("session-1")]);

    await expect(cache.run({ request, codexHomes, load })).resolves.toEqual([createSession("session-1")]);
    expect(load).toHaveBeenCalledTimes(1);

    now += 5_001;

    await expect(cache.run({ request, codexHomes, load: vi.fn().mockResolvedValue([createSession("session-2")]) }))
      .resolves
      .toEqual([createSession("session-2")]);
  });

  it("invalidates cached entries by provider or globally", async () => {
    const cache = createSessionListCache({
      ttlMs: 5_000,
      nowMs: () => 1_000,
    });
    const codexLoad = vi.fn().mockResolvedValue([createSession("codex-1")]);
    const claudeLoad = vi.fn().mockResolvedValue([
      {
        provider: "claude" as const,
        session_id: "claude-1",
        cwd: "C:/workspace/project",
        updated_at: "2026-05-15T12:00:00.000Z",
        preview: "claude-1",
      },
    ]);
    const codexHomes: CodexSessionHome[] = [{ kind: "app_runtime", home: "C:/workspace/runtime-home" }];

    await cache.run({
      request: createRequest(),
      codexHomes,
      load: codexLoad,
    });
    await cache.run({
      request: createRequest({ provider: "claude" }),
      codexHomes: [],
      load: claudeLoad,
    });

    cache.invalidate("codex");

    await cache.run({
      request: createRequest(),
      codexHomes,
      load: codexLoad,
    });
    await cache.run({
      request: createRequest({ provider: "claude" }),
      codexHomes: [],
      load: claudeLoad,
    });

    expect(codexLoad).toHaveBeenCalledTimes(2);
    expect(claudeLoad).toHaveBeenCalledTimes(1);

    cache.invalidate();

    await cache.run({
      request: createRequest({ provider: "claude" }),
      codexHomes: [],
      load: claudeLoad,
    });

    expect(claudeLoad).toHaveBeenCalledTimes(2);
  });
});
