import { describe, expect, it } from "vitest";
import { hasSavedArgText, toggleSavedArgText } from "./cli-args.js";

describe("saved CLI argument text", () => {
  it("adds and removes a saved snippet without rewriting handwritten arguments", () => {
    const handwritten = '--manual \'keep this\'  --path C:\\workspace\\demo';
    const withSaved = toggleSavedArgText(handwritten, "--review fast");

    expect(withSaved).toBe(`${handwritten} --review fast`);
    expect(hasSavedArgText(withSaved, "--review fast")).toBe(true);
    expect(toggleSavedArgText(withSaved, "--review fast")).toBe(handwritten);
  });

  it("removes a token-equivalent snippet while preserving unrelated quoting", () => {
    expect(toggleSavedArgText(
      '--manual "keep this" --review "fast mode" --tail',
      "--review 'fast mode'",
    )).toBe('--manual "keep this" --tail');
  });
});
