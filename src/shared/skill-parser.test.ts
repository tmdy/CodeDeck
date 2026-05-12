import { describe, expect, it } from "vitest";

import { parseSkillMarkdown } from "./skill-parser.js";

describe("parseSkillMarkdown", () => {
  it("parses block scalar descriptions from skill frontmatter", () => {
    const parsed = parseSkillMarkdown(
      "brainstorm",
      `---
name: brainstorm
description: |
  Dual-mode brainstorming pipeline. Auto mode: framework generation.
  CSV-driven parallel coordination with NDJSON discovery board.
tags:
  - workflow
---

# Brainstorm

Body text.
`,
    );

    expect(parsed.displayName).toBe("brainstorm");
    expect(parsed.description).toBe(
      "Dual-mode brainstorming pipeline. Auto mode: framework generation.\nCSV-driven parallel coordination with NDJSON discovery board.",
    );
    expect(parsed.description).not.toBe("|");
    expect(parsed.summary).toContain("Dual-mode brainstorming pipeline");
    expect(parsed.tags).toEqual(["workflow"]);
  });
});
