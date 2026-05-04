import { describe, expect, it } from "vitest";
import { buildAiResearchTagPlan, normalizeSkillMatchName } from "./user-tag-bulk-match.js";
import type { SkillRecord } from "./types.js";

function createRecord(host: SkillRecord["host"], directoryName: string, displayName = directoryName): SkillRecord {
  return {
    host,
    skillId: `${host}:${directoryName}`,
    directoryName,
    displayName,
    description: "",
    summary: "",
    tags: [],
    userTags: [],
    hasUserTags: false,
    hasSkillMd: true,
    isSpecialDir: false,
    status: "active",
    location: "active-root",
    sourcePath: `C:/skills/${host}/${directoryName}`,
    expectedActivePath: `C:/skills/${host}/${directoryName}`,
    expectedLibraryPath: `C:/library/${host}/${directoryName}`,
    sizeSkillMdBytes: 0,
    sizeBodyBytes: 0,
    sizeTotalBytes: 0,
    lastScannedAt: "2026-05-04T00:00:00.000Z",
    notes: [],
  };
}

describe("user tag bulk match", () => {
  it("normalizes names with separators, case, camel case, and parenthetical qualifiers", () => {
    expect(normalizeSkillMatchName(" GRPO-RL-Training (TRL) ")).toBe("grpo rl training trl");
    expect(normalizeSkillMatchName("Model_Architecture")).toBe("model architecture");
    expect(normalizeSkillMatchName("TransformerLens")).toBe("transformer lens");
  });

  it("matches by exact normalized name, token signature, and unique token subsets without guessing unmatched items", () => {
    const records = [
      createRecord("codex", "litgpt", "implementing-llms-litgpt"),
      createRecord("codex", "brainstorming-research-ideas", "brainstorming-research-ideas"),
      createRecord("codex", "transformer-lens", "transformer-lens-interpretability"),
      createRecord("codex", "trl", "trl"),
    ];

    const plan = buildAiResearchTagPlan(records, [
      "LitGPT - Lightning AI's 20+ clean LLM implementations",
      "Research Brainstorming - Structured ideation frameworks",
      "TransformerLens - activation caching and hook points",
      "Unknown Skill - should stay unmatched",
      "GRPO-RL-Training (TRL) - Group Relative Policy Optimization",
    ]);

    expect(plan.matchedSkillIds).toEqual([
      "codex:brainstorming-research-ideas",
      "codex:litgpt",
      "codex:transformer-lens",
    ]);
    expect(plan.unmatchedItems).toEqual([
      "Unknown Skill - should stay unmatched",
      "GRPO-RL-Training (TRL) - Group Relative Policy Optimization",
    ]);
    expect(plan.ambiguousItems).toEqual([]);
  });

  it("reports ambiguous lines instead of guessing", () => {
    const records = [
      createRecord("claude", "ml-paper-writing", "ml-paper-writing"),
      createRecord("claude", "writing-ml-papers", "writing-ml-papers"),
    ];

    const plan = buildAiResearchTagPlan(records, [
      "ML Paper Writing - Write publication-ready papers",
    ]);

    expect(plan.matchedSkillIds).toEqual([]);
    expect(plan.ambiguousItems).toHaveLength(1);
    expect(plan.ambiguousItems[0]?.line).toContain("ML Paper Writing");
    expect(plan.ambiguousItems[0]?.candidateSkillIds).toEqual([
      "claude:ml-paper-writing",
      "claude:writing-ml-papers",
    ]);
  });

  it("skips pure category header lines", () => {
    const records = [
      createRecord("codex", "litgpt", "litgpt"),
    ];

    const plan = buildAiResearchTagPlan(records, [
      "🏗️ Model Architecture (5 skills)",
      "LitGPT - clean model implementations",
    ]);

    expect(plan.matchedSkillIds).toEqual(["codex:litgpt"]);
    expect(plan.unmatchedItems).toEqual([]);
    expect(plan.ambiguousItems).toEqual([]);
  });
});
