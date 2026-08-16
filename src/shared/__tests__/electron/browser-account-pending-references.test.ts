import { afterEach, describe, expect, it, vi } from "vitest";
import {
  PendingBrowserAccountReferenceRegistry,
  type PendingBrowserAccountReference,
} from "../../electron/browser-account-pending-references.js";

function createRegistry(ttlMs: number = 1_000) {
  let nextId = 0;
  const discardReference = vi.fn(async () => undefined);
  const registry = new PendingBrowserAccountReferenceRegistry({
    createReference: (baseUrl) => {
      nextId += 1;
      return {
        browserSessionId: `browser-${nextId}`,
        browserOrigin: new URL(baseUrl).origin,
        partition: `persist:browser-${nextId}`,
      };
    },
    createSessionId: () => `session-${nextId + 1}`,
    buildAccountKey: (baseUrl, sessionId) => `${baseUrl}::${sessionId}`,
    discardReference,
    ttlMs,
  });
  return { registry, discardReference };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("pending browser account references", () => {
  it("reuses the same isolated reference when a failed new-account login is retried", async () => {
    vi.useFakeTimers();
    const { registry, discardReference } = createRegistry();
    const seen: PendingBrowserAccountReference[] = [];

    await expect(registry.run("https://chy.example.com", async (pending) => {
      seen.push(pending);
      throw new Error("closed");
    })).rejects.toThrow("closed");

    await registry.run("https://chy.example.com", async (pending) => {
      seen.push(pending);
      return "saved";
    });

    expect(seen).toHaveLength(2);
    expect(seen[1]).toBe(seen[0]);
    expect(discardReference).not.toHaveBeenCalled();
  });

  it("coalesces concurrent login requests for the same tentative account", async () => {
    const { registry } = createRegistry();
    let resolveAttempt!: (value: string) => void;
    const operation = vi.fn(() => new Promise<string>((resolve) => {
      resolveAttempt = resolve;
    }));

    const first = registry.run("https://chy.example.com", operation);
    const second = registry.run("https://chy.example.com", operation);
    await Promise.resolve();
    resolveAttempt("saved");

    await expect(Promise.all([first, second])).resolves.toEqual(["saved", "saved"]);
    expect(operation).toHaveBeenCalledOnce();
  });

  it("prepares and reuses a tentative reference before login starts", async () => {
    vi.useFakeTimers();
    const { registry, discardReference } = createRegistry(1_000);

    const first = registry.prepare("https://chy.example.com");
    await vi.advanceTimersByTimeAsync(600);
    const second = registry.prepare("https://chy.example.com");

    expect(second).toBe(first);
    await vi.advanceTimersByTimeAsync(999);
    expect(discardReference).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(discardReference).toHaveBeenCalledWith(
      "https://chy.example.com::session-1",
      "browser-1",
    );
  });

  it("hands a prepared reference to the next login and consumes it on success", async () => {
    const { registry, discardReference } = createRegistry();
    const prepared = registry.prepare("https://chy.example.com");
    let seen: PendingBrowserAccountReference | undefined;

    await registry.run("https://chy.example.com", async (pending) => {
      seen = pending;
      return "saved";
    });

    expect(seen).toBe(prepared);
    expect(discardReference).not.toHaveBeenCalled();
  });

  it("allocates distinct references for different sites and after a successful save", async () => {
    const { registry } = createRegistry();
    const ids: string[] = [];

    await registry.run("https://first.example.com", async (pending) => {
      ids.push(pending.reference.browserSessionId);
    });
    await registry.run("https://second.example.com", async (pending) => {
      ids.push(pending.reference.browserSessionId);
    });
    await registry.run("https://first.example.com", async (pending) => {
      ids.push(pending.reference.browserSessionId);
    });

    expect(ids).toEqual(["browser-1", "browser-2", "browser-3"]);
  });

  it("discards an unreachable reference after the retry lifetime expires", async () => {
    vi.useFakeTimers();
    const { registry, discardReference } = createRegistry();

    await expect(registry.run("https://chy.example.com", async () => {
      throw new Error("timed out");
    })).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(1_000);

    expect(discardReference).toHaveBeenCalledOnce();
    expect(discardReference).toHaveBeenCalledWith(
      "https://chy.example.com::session-1",
      "browser-1",
    );
  });

  it("cleans pending partitions immediately during application shutdown", async () => {
    vi.useFakeTimers();
    const { registry, discardReference } = createRegistry();

    registry.prepare("https://chy.example.com");
    await registry.shutdown();
    await vi.runAllTimersAsync();

    expect(discardReference).toHaveBeenCalledOnce();
    expect(discardReference).toHaveBeenCalledWith(
      "https://chy.example.com::session-1",
      "browser-1",
    );
  });
});
