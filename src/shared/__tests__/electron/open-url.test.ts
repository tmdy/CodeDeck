import { describe, expect, it } from "vitest";
import {
  parseProfileBrowserTarget,
  resolveBaseUrlBrowserTarget,
} from "../../electron/open-url.js";

describe("resolveBaseUrlBrowserTarget", () => {
  it("should resolve an API Base URL to the site root", () => {
    expect(resolveBaseUrlBrowserTarget("https://ai.centos.hk/v1")).toBe("https://ai.centos.hk");
    expect(resolveBaseUrlBrowserTarget(" https://ai.centos.hk:443/v1?token=ignored "))
      .toBe("https://ai.centos.hk");
  });

  it("should reject blank URLs", () => {
    expect(() => resolveBaseUrlBrowserTarget("  ")).toThrow("Base URL 不能为空");
  });

  it("should reject non-http URLs", () => {
    expect(() => resolveBaseUrlBrowserTarget("file:///C:/tmp/test.txt")).toThrow(
      "仅支持打开 http 或 https 地址",
    );
  });
});

describe("parseProfileBrowserTarget", () => {
  it("accepts each explicit browser target", () => {
    expect(parseProfileBrowserTarget({ kind: "default" })).toEqual({ kind: "default" });
    expect(parseProfileBrowserTarget({ kind: "saved_session", session_id: " session-1 " }))
      .toEqual({ kind: "saved_session", session_id: "session-1" });
    expect(parseProfileBrowserTarget({ kind: "browser_slot", slot: 3 }))
      .toEqual({ kind: "browser_slot", slot: 3 });
    expect(parseProfileBrowserTarget({ kind: "pending_browser_account" }))
      .toEqual({ kind: "pending_browser_account" });
  });

  it("rejects malformed targets instead of changing partition intent", () => {
    expect(parseProfileBrowserTarget(undefined)).toBeNull();
    expect(parseProfileBrowserTarget(null)).toBeNull();
    expect(parseProfileBrowserTarget({ kind: "saved_session", session_id: "" })).toBeNull();
    expect(parseProfileBrowserTarget({ kind: "browser_slot", slot: 0 })).toBeNull();
    expect(parseProfileBrowserTarget({ kind: "browser_slot", slot: 1, fallback: "default" }))
      .toBeNull();
    expect(parseProfileBrowserTarget({ kind: "default", slot: 1 })).toBeNull();
    expect(parseProfileBrowserTarget({ kind: "unknown" })).toBeNull();
  });
});
