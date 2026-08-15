import { describe, expect, it } from "vitest";
import { resolveBaseUrlBrowserTarget } from "../../electron/open-url.js";

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
