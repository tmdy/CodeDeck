import { describe, expect, it } from "vitest";
import { TerminalActivityDetector } from "../../electron/terminal-activity.js";

describe("TerminalActivityDetector", () => {
  it("marks a non-empty submitted input as busy", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.recordInput("修复这个问题")).toBeNull();
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

  it("keeps a prompt with a Working suffix busy", () => {
    const detector = new TerminalActivityDetector();

    expect(detector.observeOutput("\r\n› 继续 • Working (0s • esc to interrupt)")).toEqual({
      activity: "busy",
      reason: "busy_output",
    });
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
