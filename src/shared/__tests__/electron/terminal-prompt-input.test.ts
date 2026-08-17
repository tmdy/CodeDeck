import { describe, expect, it } from "vitest";
import {
  hasTerminalCliReadyPrompt,
  normalizeTerminalPromptInput,
} from "../../electron/terminal-prompt-input.js";

describe("terminal prompt input", () => {
  it("wraps multiline prompts in bracketed paste markers", () => {
    expect(normalizeTerminalPromptInput("第一行\n第二行")).toEqual({
      data: "\x1b[200~第一行\n第二行\x1b[201~",
      submitSeparately: true,
    });
  });

  it("normalizes CRLF, lone carriage returns, and NUL bytes", () => {
    expect(normalizeTerminalPromptInput("第一行\r\n第\0二行\r第三行")).toEqual({
      data: "\x1b[200~第一行\n第二行\n第三行\x1b[201~",
      submitSeparately: true,
    });
  });

  it("detects the Claude ready prompt", () => {
    expect(hasTerminalCliReadyPrompt("Claude Code\r\n❯ ")).toBe(true);
    expect(hasTerminalCliReadyPrompt("Claude Code 正在启动")).toBe(false);
  });
});
