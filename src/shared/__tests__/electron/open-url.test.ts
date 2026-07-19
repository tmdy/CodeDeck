import { describe, expect, it } from "vitest";
import { resolveBaseUrlExternalTarget } from "../../electron/open-url.js";

describe("resolveBaseUrlExternalTarget", () => {
  it("should resolve an API Base URL to the site root", () => {
    expect(resolveBaseUrlExternalTarget("https://ai.centos.hk/v1")).toBe("https://ai.centos.hk");
  });

  it("should reject blank URLs", () => {
    expect(() => resolveBaseUrlExternalTarget("  ")).toThrow("Base URL 不能为空");
  });

  it("should reject non-http URLs", () => {
    expect(() => resolveBaseUrlExternalTarget("file:///C:/tmp/test.txt")).toThrow(
      "仅支持打开 http 或 https 地址",
    );
  });
});
