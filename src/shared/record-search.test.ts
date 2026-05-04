import { describe, expect, it } from "vitest";
import { matchesSkillSearch, normalizeUserTags, sortRecordsByUserTagsFirst } from "./record-search.js";
import type { SkillRecord } from "./types.js";

function createRecord(overrides: Partial<SkillRecord>): SkillRecord {
  return {
    host: "codex",
    skillId: "codex:test",
    directoryName: "test",
    displayName: "Test Skill",
    description: "",
    summary: "summary",
    tags: [],
    userTags: [],
    hasUserTags: false,
    hasSkillMd: true,
    isSpecialDir: false,
    status: "active",
    location: "active-root",
    sourcePath: "C:/skills/test",
    expectedActivePath: "C:/skills/test",
    expectedLibraryPath: "C:/library/test",
    sizeSkillMdBytes: 0,
    sizeBodyBytes: 0,
    sizeTotalBytes: 0,
    lastScannedAt: "2026-05-03T00:00:00.000Z",
    notes: [],
    ...overrides,
  };
}

describe("record search helpers", () => {
  it("normalizes user tags by trimming and deduplicating", () => {
    expect(normalizeUserTags([" 科研写作 ", "", "科研写作", "音视频", "音视频 "])).toEqual(["科研写作", "音视频"]);
  });

  it("matches only user tags in search", () => {
    const record = createRecord({
      tags: ["builtin"],
      userTags: ["科研写作"],
      hasUserTags: true,
    });

    expect(matchesSkillSearch(record, "科研")).toBe(true);
    expect(matchesSkillSearch(record, "builtin")).toBe(false);
    expect(matchesSkillSearch(record, "missing")).toBe(false);
  });

  it("sorts tagged skills ahead of untagged skills while keeping group order stable", () => {
    const first = createRecord({ skillId: "codex:first", directoryName: "first", hasUserTags: false });
    const second = createRecord({ skillId: "codex:second", directoryName: "second", hasUserTags: true, userTags: ["科研写作"] });
    const third = createRecord({ skillId: "codex:third", directoryName: "third", hasUserTags: false });
    const fourth = createRecord({ skillId: "codex:fourth", directoryName: "fourth", hasUserTags: true, userTags: ["音视频"] });

    const sorted = sortRecordsByUserTagsFirst([first, second, third, fourth]);

    expect(sorted.map((item) => item.skillId)).toEqual([
      "codex:second",
      "codex:fourth",
      "codex:first",
      "codex:third",
    ]);
  });
});
