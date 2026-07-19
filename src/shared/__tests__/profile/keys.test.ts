// Profile keys 测试 — 翻译自 Go internal/domain/profile/keys_test.go

import { describe, it, expect } from "vitest";
import { buildKey, splitKey, normalizeKeyWithFallback } from "../../profile/keys-internal.js";
import { DEFAULT_PROVIDER } from "../../profile/types.js";

describe("buildKey", () => {
  it("should build key with provider::name format", () => {
    expect(buildKey("claude", "Official")).toBe("claude::Official");
  });

  it("should normalize provider to lowercase", () => {
    expect(buildKey("CLAUDE", "MyProfile")).toBe("claude::MyProfile");
  });

  it("should normalize codex provider", () => {
    expect(buildKey("codex", "OpenAI")).toBe("codex::OpenAI");
    expect(buildKey("CODEX", "OpenAI")).toBe("codex::OpenAI");
  });

  it("should default unknown provider to claude", () => {
    expect(buildKey("unknown", "Profile")).toBe("claude::Profile");
  });

  it("should return empty string for empty name", () => {
    expect(buildKey("claude", "")).toBe("");
    expect(buildKey("claude", "  ")).toBe("");
  });

  it("should trim whitespace from name", () => {
    expect(buildKey("claude", "  MyProfile  ")).toBe("claude::MyProfile");
  });
});

describe("splitKey", () => {
  it("should split valid key into provider and name", () => {
    const [provider, name] = splitKey("claude::Official");
    expect(provider).toBe("claude");
    expect(name).toBe("Official");
  });

  it("should split codex key", () => {
    const [provider, name] = splitKey("codex::OpenAI");
    expect(provider).toBe("codex");
    expect(name).toBe("OpenAI");
  });

  it("should handle key without separator as claude default", () => {
    const [provider, name] = splitKey("SomeProfile");
    expect(provider).toBe(DEFAULT_PROVIDER);
    expect(name).toBe("SomeProfile");
  });

  it("should handle empty key", () => {
    const [provider, name] = splitKey("");
    expect(provider).toBe(DEFAULT_PROVIDER);
    expect(name).toBe("");
  });

  it("should normalize provider in split result", () => {
    const [provider, name] = splitKey("CODEX::MyProfile");
    expect(provider).toBe("codex");
    expect(name).toBe("MyProfile");
  });
});

describe("normalizeKeyWithFallback", () => {
  it("should normalize key with separator", () => {
    expect(normalizeKeyWithFallback("codex::OpenAI", "claude")).toBe("codex::OpenAI");
  });

  it("should use fallback provider when no separator", () => {
    expect(normalizeKeyWithFallback("MyProfile", "codex")).toBe("codex::MyProfile");
  });

  it("should return empty for empty input", () => {
    expect(normalizeKeyWithFallback("", "claude")).toBe("");
  });

  it("should preserve provider namespace when given full key", () => {
    // 确保已有 provider 前缀的 key 不会被 fallback 覆盖
    const result = normalizeKeyWithFallback("claude::Official", "codex");
    expect(result).toBe("claude::Official");
  });
});