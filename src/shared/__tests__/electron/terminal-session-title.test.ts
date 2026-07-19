import { describe, expect, it } from "vitest";
import {
  buildTerminalHeaderTitle,
  buildTerminalWindowTitle,
  normalizeTerminalDisplayTitle,
} from "../../electron/terminal-session-title.js";

describe("terminal-session-title", () => {
  it("uses provider terminal text until a session title is known", () => {
    expect(buildTerminalWindowTitle("codex")).toBe("Codex 终端");
    expect(buildTerminalHeaderTitle("claude")).toBe("Claude 终端");
  });

  it("formats session titles for window chrome and terminal header", () => {
    expect(buildTerminalWindowTitle("codex", "监控窗口标题")).toBe("监控窗口标题 - Codex");
    expect(buildTerminalHeaderTitle("claude", "Claude 监控标题")).toBe("Claude 监控标题");
  });

  it("normalizes whitespace and truncates very long session titles", () => {
    const longTitle = `  第一行\n第二行  ${"x".repeat(120)}  `;

    const normalized = normalizeTerminalDisplayTitle(longTitle);

    expect(normalized).toHaveLength(80);
    expect(normalized).toBe(`第一行 第二行 ${"x".repeat(72)}`);
  });
});
