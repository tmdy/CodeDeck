import { describe, expect, it } from "vitest";
import {
  containsInteractiveTerminalPrompt,
  TerminalActivityDetector,
} from "../../electron/terminal-activity.js";

describe("TerminalActivityDetector", () => {
  it("marks a non-empty submitted input as busy", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.recordInput("修复这个问题")).toBeNull();
    expect(detector.recordInput("\r")).toEqual({
      activity: "busy",
      reason: "submitted_input",
    });
  });

  it("waits for Enter after a multiline bracketed paste before marking busy", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.recordInput("\u001b[200~first line\nsecond line\u001b[201~")).toBeNull();
    expect(detector.recordInput("\r")).toEqual({
      activity: "busy",
      reason: "submitted_input",
    });
  });

  it("recognizes Codex and Claude idle prompts", () => {
    const codex = new TerminalActivityDetector();
    const claude = new TerminalActivityDetector();

    expect(codex.observeOutput("最终答复\r\n\u001b[2K› ")).toEqual({
      activity: "idle",
      reason: "idle_prompt",
    });
    expect(claude.observeOutput("完成\r\n❯ ")).toEqual({
      activity: "idle",
      reason: "idle_prompt",
    });
  });

  it.each([
    "Explain this codebase",
    "Implement {feature}",
    "Find and fix a bug in @filename",
    "Write tests for @filename",
    "Improve documentation in @filename",
    "Run /review on my current changes",
    "Summarize recent commits",
  ])("recognizes the Codex idle placeholder: %s", (placeholder) => {
    const detector = new TerminalActivityDetector();

    expect(detector.observeOutput(`完成\r\n› ${placeholder}\r\n`)).toEqual({
      activity: "idle",
      reason: "idle_prompt",
    });
  });

  it("recognizes an idle placeholder followed by a cursor-painted status bar", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.observeOutput(
      "完成\r\n› Improve documentation in @filename   gpt-5.6-terra low · D:\\CodeDeck",
    )).toEqual({
      activity: "idle",
      reason: "idle_prompt",
    });
  });

  it("ignores a busy indicator erased before an idle prompt in the same chunk", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.observeOutput(
      "Working (1s • esc to interrupt)\r\u001b[2K› Improve documentation in @filename",
    )).toEqual({
      activity: "idle",
      reason: "idle_prompt",
    });
  });

  it("prefers the latest idle prompt over older busy output in scrollback", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.observeOutput(
      "Working (1s • esc to interrupt)\r\n完成\r\n› Find and fix a bug in @filename",
    )).toEqual({
      activity: "idle",
      reason: "idle_prompt",
    });
  });

  it("keeps the current turn busy when Working appears between its prompt and the idle placeholder", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.observeOutput([
      "› inspect the repository",
      "Working (8s • esc to interrupt)",
      "› Improve documentation in @filename",
    ].join("\r\n"))).toEqual({
      activity: "busy",
      reason: "busy_output",
    });
  });

  it.each(["  Worked for 1h 23m 3s • 02:34", "─ Worked for 1h 23m 3s • 02:34 ─────────────────"])("recognizes the screenshot's current Codex idle placeholder after its completed-work separator: %s", (separator) => {
    const detector = new TerminalActivityDetector();
    detector.recordInput("inspect repository\r");
    detector.observeOutput("› inspect repository\r\nWorking (83m • esc to interrupt)\r\n");
    expect(detector.observeOutput([
      "• completed result",
      separator,
      "› Ask Codex to do anything",
    ].join("\r\n"))).toEqual({ activity: "idle", reason: "idle_prompt" });
  });

  it("does not settle an active turn from a previous completion row or a prose mention", () => {
    for (const completion of ["Worked for a long time", "Worked for 1h 23m 3s • 02:34"]) {
      const detector = new TerminalActivityDetector();
      expect(detector.observeOutput([
        "› inspect repository", completion,
        "Working (8s • esc to interrupt)", "› Ask Codex to do anything",
      ].join("\r\n"))).toEqual({ activity: "busy", reason: "busy_output" });
    }
  });

  it.each([
    ["```", "Worked for 8s • 02:34", "```"],
    ["~~~text", "Worked for 8s • 02:34", "~~~"],
    ["```text", "Worked for 8s • 02:34"],
    ["Worked for 8s • 02:34", "This is an example of a completion row."],
  ].map((answer) => ({ answer })))("does not settle from a quoted completion row in current answer text: %j", ({ answer }) => {
    const detector = new TerminalActivityDetector();
    expect(detector.observeOutput([
      "› inspect repository", "Working (8s • esc to interrupt)",
      ...answer, "› Ask Codex to do anything",
    ].join("\r\n"))).toEqual({ activity: "busy", reason: "busy_output" });
  });

  it("accepts the real final separator after a closed code example and old interactive text", () => {
    const detector = new TerminalActivityDetector();
    expect(detector.observeOutput([
      "› inspect repository", "Working (8s • esc to interrupt)",
      "Earlier the tool asked: Do you want to proceed? (y/n)",
      "```", "Worked for 3s • 02:30", "```", "Completed answer.",
      "─ Worked for 8s • 02:34 ───────────", "› Ask Codex to do anything",
    ].join("\r\n"))).toEqual({ activity: "idle", reason: "idle_prompt" });
  });

  it("ignores Working from an older submitted turn after a newer turn has completed", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.observeOutput([
      "› old task",
      "Working (1s • esc to interrupt)",
      "› latest task",
      "• completed result",
      "› Improve documentation in @filename",
    ].join("\r\n"))).toEqual({
      activity: "idle",
      reason: "idle_prompt",
    });
  });

  it("keeps a prompt with a Working suffix busy", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.observeOutput("\r\n› 继续 • Working (0s • esc to interrupt)")).toEqual({
      activity: "busy",
      reason: "busy_output",
    });
  });

  it("does not treat a repainted prompt containing submitted text as idle", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.observeOutput("\r\n› inspect the repository")).toBeNull();
  });

  it("does not treat an interactive confirmation prompt as idle", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.observeOutput("Do you want to proceed? (y/n)\r\n› ")).toBeNull();
  });

  it("recognizes the Codex hooks review TUI as interactive input", () => {
    const detector = new TerminalActivityDetector();
    const hooksTable = Array.from(
      { length: 12 },
      (_, index) => `| hook-${index} | C:\\workspace\\hooks\\hook-${index}.ps1 | requires review |`,
    ).join("\r\n");
    const output = [
      "Hooks need review",
      hooksTable,
      "Press t to trust all; enter to review hooks; esc to close",
      "› ",
    ].join("\r\n");

    expect(hooksTable.length).toBeGreaterThan(240);
    expect(containsInteractiveTerminalPrompt(output)).toBe(true);
    expect(detector.observeOutput(output)).toBeNull();
  });

  it("does not treat explanatory hooks review text as an interactive prompt", () => {
    expect(containsInteractiveTerminalPrompt(
      "The configured hooks need review before this change can merge.",
    )).toBe(false);
  });

  it("forgets an interactive prompt after the TUI clears and repaints the screen", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.observeOutput("Do you want to proceed? (y/n)\r\n› ")).toBeNull();
    expect(detector.observeOutput("\u001b[2J\u001b[H完成\r\n› Explain this codebase")).toEqual({
      activity: "idle",
      reason: "idle_prompt",
    });
  });

  it("does not treat explanatory text containing Working as busy", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.observeOutput(
      "Working with untrusted contents comes with higher risk.\r\n› 1. Yes, continue",
    )).toBeNull();
  });

  it("recognizes a prompt split across output chunks", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.observeOutput("完成\r\n")).toBeNull();
    expect(detector.observeOutput("› ")).toEqual({
      activity: "idle",
      reason: "idle_prompt",
    });
  });

  it("clears the previous idle prompt when a new task is submitted", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.observeOutput("完成\r\n› ")).not.toBeNull();
    expect(detector.recordInput("新任务\r")).toEqual({
      activity: "busy",
      reason: "submitted_input",
    });
    expect(detector.observeOutput("正在读取文件")).toBeNull();
  });

  it("does not treat xterm focus reports as submitted text", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.recordInput("\u001b[O")).toBeNull();
    expect(detector.recordInput("\u001b[I")).toBeNull();
    expect(detector.recordInput("\r")).toBeNull();
  });
});
