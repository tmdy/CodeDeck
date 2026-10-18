import { describe, expect, it, vi } from "vitest";
import { createSessionListCache } from "../../electron/session-list-cache.js";
import type { SessionSummary } from "../../services/session-service.js";

const session = (id: string): SessionSummary => ({ provider: "codex", session_id: id, cwd: "C:/test", updated_at: "2026-10-11T00:00:00Z", preview: id });
const request = (offset: number) => ({ provider: "codex", scope: "global_recent" as const, offset });

describe("session list cache capacity", () => {
  it("evicts old pages while preserving a recently reused page", async () => {
    const cache = createSessionListCache({ nowMs: () => 1000 });
    const load = vi.fn(async () => [session("loaded")]);
    const read = (offset: number) => cache.run({ request: request(offset), codexHomes: [], load });
    for (let index = 0; index < 64; index += 1) await read(index);
    await read(0);
    await read(64);
    expect(load).toHaveBeenCalledTimes(65);
    await read(0);
    expect(load).toHaveBeenCalledTimes(65);
    await read(1);
    expect(load).toHaveBeenCalledTimes(66);
  });

  it("does not discard shared pending loads while completed pages are evicted", async () => {
    const cache = createSessionListCache({ nowMs: () => 1000 });
    let resolve!: (sessions: SessionSummary[]) => void;
    const load = vi.fn(() => new Promise<SessionSummary[]>((done) => { resolve = done; }));
    const options = { request: request(0), codexHomes: [], load };
    const first = cache.run(options);
    for (let offset = 1; offset <= 80; offset += 1) {
      await cache.run({ request: request(offset), codexHomes: [], load: async () => [session(String(offset))] });
    }
    const second = cache.run(options);
    expect(load).toHaveBeenCalledTimes(1);
    resolve([session("shared")]);
    expect(await first).toEqual(await second);
  });

  it("prevents an invalidated pending result from replacing newer cached data", async () => {
    const cache = createSessionListCache();
    let resolve!: (sessions: SessionSummary[]) => void;
    const options = { request: request(0), codexHomes: [] };
    const old = cache.run({ ...options, load: () => new Promise((done) => { resolve = done; }) });
    cache.invalidate("codex");
    await cache.run({ ...options, load: async () => [session("new")] });
    resolve([session("old")]);
    expect(await old).toEqual([session("old")]);
    const fallback = vi.fn(async () => [session("unexpected")]);
    expect(await cache.run({ ...options, load: fallback })).toEqual([session("new")]);
    expect(fallback).not.toHaveBeenCalled();
  });
});
