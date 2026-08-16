import { describe, expect, it, vi } from "vitest";
import {
  normalizeBalanceBaseUrl,
  normalizeBrowserOrigin,
  type SiteBalanceSession,
} from "../../balance/site-balance-sessions.js";
import {
  resolveProfileBrowserPartitionRequest,
  type ProfileBrowserPartitionDependencies,
} from "../../electron/profile-browser-partition.js";

function createDependencies(options: {
  savedSession?: SiteBalanceSession;
  slots?: Array<{ slot: number; browser_session_id: string }>;
} = {}) {
  const savedSession = options.savedSession ?? {
    id: "saved-1",
    label: "账号1",
    base_url: "https://example.com",
    access_token: "",
    auth_kind: "browser_session",
    browser_session_id: "saved-reference",
    browser_slot: 1,
    browser_origin: "https://example.com",
    user_id: "42",
    updated_at: "2026-08-16T00:00:00.000Z",
  };
  const slots = options.slots ?? [{ slot: 1, browser_session_id: "slot-reference" }];
  const preparePendingPartition = vi.fn(() => "persist:pending-reference");
  const dependencies: ProfileBrowserPartitionDependencies<SiteBalanceSession> = {
    defaultPartition: "persist:default",
    normalizeBaseUrl: normalizeBalanceBaseUrl,
    normalizeBrowserOrigin,
    findSavedSession: (_baseUrl, sessionId) => {
      if (sessionId !== savedSession.id) throw new Error("后台账号不存在");
      return savedSession;
    },
    getSavedSessionPartition: (account) => `persist:${account.browser_session_id}`,
    findBrowserSlot: (slot) => slots.find((candidate) => candidate.slot === slot),
    getBrowserSlotPartition: (browserSessionId) => `persist:${browserSessionId}`,
    preparePendingPartition,
  };
  return { dependencies, preparePendingPartition };
}

describe("resolveProfileBrowserPartitionRequest", () => {
  it("keeps default browsing isolated from browser accounts", () => {
    const { dependencies, preparePendingPartition } = createDependencies();

    expect(resolveProfileBrowserPartitionRequest(
      "https://example.com/v1",
      { kind: "default" },
      dependencies,
    )).toEqual({ partition: "persist:default", target: { kind: "default" } });
    expect(preparePendingPartition).not.toHaveBeenCalled();
  });

  it("resolves a saved browser session only for the exact account origin", () => {
    const { dependencies } = createDependencies();

    expect(resolveProfileBrowserPartitionRequest(
      "https://example.com/v1",
      { kind: "saved_session", session_id: "saved-1" },
      dependencies,
    ).partition).toBe("persist:saved-reference");
    expect(() => resolveProfileBrowserPartitionRequest(
      "https://other.example.com/v1",
      { kind: "saved_session", session_id: "saved-1" },
      dependencies,
    )).toThrow("后台账号与 Base URL 来源不一致");
  });

  it("rejects a non-browser saved session", () => {
    const { dependencies } = createDependencies({
      savedSession: {
        id: "saved-1",
        label: "PAT",
        base_url: "https://example.com",
        access_token: "token",
        auth_kind: "access_token",
        user_id: "42",
        updated_at: "2026-08-16T00:00:00.000Z",
      },
    });

    expect(() => resolveProfileBrowserPartitionRequest(
      "https://example.com/v1",
      { kind: "saved_session", session_id: "saved-1" },
      dependencies,
    )).toThrow("后台账号与 Base URL 来源不一致");
  });

  it("resolves an existing global slot and rejects a missing slot", () => {
    const { dependencies } = createDependencies();

    expect(resolveProfileBrowserPartitionRequest(
      "https://example.com/v1",
      { kind: "browser_slot", slot: 1 },
      dependencies,
    ).partition).toBe("persist:slot-reference");
    expect(() => resolveProfileBrowserPartitionRequest(
      "https://example.com/v1",
      { kind: "browser_slot", slot: 2 },
      dependencies,
    )).toThrow("浏览器账号2不存在");
  });

  it("prepares pending accounts with the same normalized Base URL used by login", () => {
    const { dependencies, preparePendingPartition } = createDependencies();

    expect(resolveProfileBrowserPartitionRequest(
      "https://example.com/v1",
      { kind: "pending_browser_account" },
      dependencies,
    ).partition).toBe("persist:pending-reference");
    expect(preparePendingPartition).toHaveBeenCalledWith("https://example.com");
  });

  it("rejects malformed targets without falling back to the default partition", () => {
    const { dependencies } = createDependencies();

    expect(() => resolveProfileBrowserPartitionRequest(
      "https://example.com/v1",
      { kind: "browser_slot", slot: 1, fallback: "default" },
      dependencies,
    )).toThrow("Profile 浏览器打开目标无效");
  });
});
