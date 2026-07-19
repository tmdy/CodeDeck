// Codex URL 规范化测试 — 翻译自 Go internal/provider/codex/command_builder_test.go

import { describe, it, expect } from "vitest";
import { normalizeCodexUrl, buildCodexBrowserUrl } from "../../../provider/codex/url-normalizer.js";

describe("normalizeCodexUrl", () => {
  it("should strip /responses suffix", () => {
    const result = normalizeCodexUrl("https://proxy.example.com/v1/responses");
    expect(result).toBe("https://proxy.example.com/v1");
  });

  it("should strip /chat/completions suffix", () => {
    const result = normalizeCodexUrl("https://proxy.example.com/chat/completions");
    expect(result).toBe("https://proxy.example.com/v1");
  });

  it("should strip /completions suffix", () => {
    const result = normalizeCodexUrl("https://proxy.example.com/v1/completions");
    expect(result).toBe("https://proxy.example.com/v1");
  });

  it("should append /v1 when missing", () => {
    const result = normalizeCodexUrl("https://proxy.example.com");
    expect(result).toBe("https://proxy.example.com/v1");
  });

  it("should keep existing /v1", () => {
    const result = normalizeCodexUrl("https://proxy.example.com/v1");
    expect(result).toBe("https://proxy.example.com/v1");
  });

  it("should throw on invalid URL scheme", () => {
    expect(() => normalizeCodexUrl("ftp://example.com")).toThrow("http:// 或 https://");
  });

  it("should throw on empty URL", () => {
    expect(() => normalizeCodexUrl("")).toThrow("不能为空");
  });
});

describe("buildCodexBrowserUrl", () => {
  it("should strip /v1 and /responses for console URL", () => {
    const result = buildCodexBrowserUrl("https://console.example.com/v1/responses");
    expect(result).toBe("https://console.example.com");
  });

  it("should strip /v1 only", () => {
    const result = buildCodexBrowserUrl("https://console.example.com/v1");
    expect(result).toBe("https://console.example.com");
  });

  it("should strip /chat/completions", () => {
    const result = buildCodexBrowserUrl("https://api.openai.com/v1/chat/completions");
    expect(result).toBe("https://api.openai.com");
  });

  it("should strip /completions", () => {
    const result = buildCodexBrowserUrl("https://api.openai.com/v1/completions");
    expect(result).toBe("https://api.openai.com");
  });
});