// 模型映射服务测试

import { describe, it, expect } from "vitest";
import { resolveModel } from "../../model-mapping/types.js";
import type { ModelMappingEntry } from "../../model-mapping/types.js";

describe("resolveModel", () => {
  const mappings: ModelMappingEntry[] = [
    {
      id: "1",
      provider: "claude",
      pattern: "sonnet",
      target_model: "claude-sonnet-4-20250514",
      display_name: "Sonnet 4",
      enabled: true,
      priority: 1,
    },
    {
      id: "2",
      provider: "claude",
      pattern: "opus",
      target_model: "claude-opus-4-20250514",
      display_name: "Opus 4",
      enabled: true,
      priority: 2,
    },
    {
      id: "3",
      provider: "claude",
      pattern: "claude-*",
      target_model: "claude-haiku-4-20250514",
      display_name: "Default Claude",
      enabled: true,
      priority: 100,
    },
    {
      id: "4",
      provider: "codex",
      pattern: "gpt-*",
      target_model: "gpt-5.4",
      display_name: "GPT Latest",
      enabled: true,
      priority: 1,
    },
    {
      id: "5",
      provider: "claude",
      pattern: "disabled-map",
      target_model: "some-model",
      display_name: "Disabled",
      enabled: false,
      priority: 1,
    },
  ];

  it("should match exact pattern", () => {
    expect(resolveModel("sonnet", mappings, "claude")).toBe("claude-sonnet-4-20250514");
    expect(resolveModel("opus", mappings, "claude")).toBe("claude-opus-4-20250514");
  });

  it("should match wildcard pattern", () => {
    expect(resolveModel("claude-anything", mappings, "claude")).toBe("claude-haiku-4-20250514");
  });

  it("should respect priority order", () => {
    // opus 匹配 priority 2，但如果有另一个更高优先级的模式...
    expect(resolveModel("opus", mappings, "claude")).toBe("claude-opus-4-20250514");
    // claude-xxx 匹配到通配符 priority 100 的规则
    expect(resolveModel("claude-unknown", mappings, "claude")).toBe("claude-haiku-4-20250514");
  });

  it("should return original model if no match", () => {
    expect(resolveModel("unknown-model", mappings, "claude")).toBe("unknown-model");
  });

  it("should skip disabled mappings", () => {
    expect(resolveModel("disabled-map", mappings, "claude")).toBe("disabled-map");
  });

  it("should filter by provider", () => {
    expect(resolveModel("gpt-4", mappings, "codex")).toBe("gpt-5.4");
    expect(resolveModel("gpt-4", mappings, "claude")).toBe("gpt-4"); // 没有 claude 的 gpt 映射
  });

  it("should handle empty mappings", () => {
    expect(resolveModel("any-model", [], "claude")).toBe("any-model");
  });

  it("should handle single-character matching with ?", () => {
    const m: ModelMappingEntry[] = [
      {
        id: "1",
        provider: "claude",
        pattern: "gpt-?.?-turbo",
        target_model: "gpt-4-turbo-fixed",
        display_name: "GPT Turbo",
        enabled: true,
        priority: 1,
      },
    ];
    expect(resolveModel("gpt-3.5-turbo", m, "claude")).toBe("gpt-4-turbo-fixed");
    expect(resolveModel("gpt-4-turbo-not", m, "claude")).toBe("gpt-4-turbo-not");
  });

  it("should case-insensitive match", () => {
    const m: ModelMappingEntry[] = [
      {
        id: "1",
        provider: "claude",
        pattern: "SONNET",
        target_model: "claude-sonnet-4",
        display_name: "Sonnet",
        enabled: true,
        priority: 1,
      },
    ];
    expect(resolveModel("Sonnet", m, "claude")).toBe("claude-sonnet-4");
    expect(resolveModel("SONNET", m, "claude")).toBe("claude-sonnet-4");
  });
});