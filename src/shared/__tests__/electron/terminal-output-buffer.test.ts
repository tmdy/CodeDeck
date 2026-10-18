import { describe, expect, it } from "vitest";
import { TerminalOutputBuffer } from "../../electron/terminal-output-buffer.js";

describe("TerminalOutputBuffer", () => {
  it("preserves the previous suffix for varied chunks, Unicode and split control sequences", () => {
    const buffer = new TerminalOutputBuffer(64);
    let expected = "";
    const chunks = ["\x1b[", "32m中", "\ud83d", "\ude42\x1b[0m", "", "长".repeat(500)];
    for (let index = 0; index < 500; index += 1) {
      const chunk = chunks[index % chunks.length];
      expected = (expected + chunk).slice(-64);
      buffer.append(chunk);
      expect(buffer.length).toBe(expected.length);
      expect(buffer.toString()).toBe(expected);
    }
    buffer.clear();
    expect(buffer.length).toBe(0);
    expect(buffer.toString()).toBe("");
    buffer.append("重新开始");
    expect(buffer.toString()).toBe("重新开始");
  });

  it("handles many tiny chunks without retaining dropped prefixes", () => {
    const buffer = new TerminalOutputBuffer(1_000);
    let expected = "";
    for (let index = 0; index < 10_000; index += 1) {
      const chunk = String(index % 10);
      buffer.append(chunk);
      expected = (expected + chunk).slice(-1_000);
    }
    expect(buffer.toString()).toBe(expected);
    expect(buffer.length).toBe(1_000);
  });
});
