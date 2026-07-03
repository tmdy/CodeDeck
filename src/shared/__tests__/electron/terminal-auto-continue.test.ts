import { describe, expect, it } from "vitest";
import { TerminalAutoContinueController } from "../../electron/terminal-auto-continue.js";

describe("TerminalAutoContinueController", () => {
  it("triggers auto continue when a keyword spans across chunks", () => {
    const controller = new TerminalAutoContinueController({
      enabled: true,
      limit: 1,
      prompt: "继续",
      keywords: ["high demand"],
    });

    expect(controller.processChunk("service is under high ")).toBeNull();

    expect(controller.processChunk("demand right now")).toEqual({
      input: "继续\r",
      keyword: "high demand",
      matchCount: 1,
      prompt: "继续",
    });
  });

  it("does not synthesize a keyword from a word suffix across chunks", () => {
    const controller = new TerminalAutoContinueController({
      enabled: true,
      limit: 1,
      prompt: "继续",
      keywords: ["high demand"],
    });

    expect(controller.processChunk("model: gpt-5.5 xhigh ")).toBeNull();
    expect(controller.processChunk("demand is normal text later")).toBeNull();
    expect(controller.snapshot().matchCount).toBe(0);
  });

  it("does not trigger again for the same visible match", () => {
    const controller = new TerminalAutoContinueController({
      enabled: true,
      limit: 2,
      prompt: "继续",
      keywords: ["high demand"],
    });

    expect(controller.processChunk("high demand")).toEqual({
      input: "继续\r",
      keyword: "high demand",
      matchCount: 1,
      prompt: "继续",
    });
    expect(controller.processChunk("high demand")).toBeNull();
  });

  it("keeps a failure region active across redraw chunks until a user submits new input", () => {
    const controller = new TerminalAutoContinueController({
      enabled: true,
      limit: -1,
      prompt: "继续",
      keywords: ["high demand"],
    });

    expect(controller.processChunk("We're currently experiencing high demand, which may cause temporary errors.")).not.toBeNull();
    expect(controller.processChunk("\u001b[2KWorking (45s)")).toBeNull();
    expect(controller.processChunk("We're currently experiencing high demand, which may cause temporary errors.")).toBeNull();
    expect(controller.snapshot().matchCount).toBe(1);

    controller.recordInput("新的用户请求\r");

    expect(controller.processChunk("We're currently experiencing high demand, which may cause temporary errors.")).not.toBeNull();
    expect(controller.snapshot().matchCount).toBe(2);
  });

  it("skips reconnect progress and retries after an auto-submitted prompt reaches a new final failure", () => {
    const controller = new TerminalAutoContinueController({
      enabled: true,
      limit: -1,
      prompt: "继续",
      keywords: ["high demand"],
    });

    expect(controller.processChunk(
      "◦ Reconnecting... 1/5 (18s • esc to interrupt) └ We're currently experiencing high demand, which may cause temporary errors.",
    )).toBeNull();
    expect(controller.snapshot().matchCount).toBe(0);

    expect(controller.processChunk("■ We're currently experiencing high demand, which may cause temporary errors.")).toEqual({
      input: "继续\r",
      keyword: "high demand",
      matchCount: 1,
      prompt: "继续",
    });

    controller.recordInput("继续\r", { source: "auto" });

    expect(controller.processChunk(
      "■ We're currently experiencing high demand, which may cause temporary errors.\r\n› 继续 • Working (0s • esc to interrupt)",
    )).toBeNull();
    expect(controller.processChunk(
      "◦ Reconnecting... 1/5 (18s • esc to interrupt) └ We're currently experiencing high demand, which may cause temporary errors.",
    )).toBeNull();

    expect(controller.processChunk("■ We're currently experiencing high demand, which may cause temporary errors.")).toEqual({
      input: "继续\r",
      keyword: "high demand",
      matchCount: 2,
      prompt: "继续",
    });
  });

  it("does not treat an echoed auto prompt alone as a new failure boundary", () => {
    const controller = new TerminalAutoContinueController({
      enabled: true,
      limit: -1,
      prompt: "继续",
      keywords: ["high demand"],
    });

    expect(controller.processChunk("■ We're currently experiencing high demand, which may cause temporary errors.")).not.toBeNull();
    controller.recordInput("继续\r", { source: "auto" });

    expect(controller.processChunk(
      "■ We're currently experiencing high demand, which may cause temporary errors.\r\n› 继续\r\n■ We're currently experiencing high demand, which may cause temporary errors.",
    )).toBeNull();
    expect(controller.snapshot().matchCount).toBe(1);
  });

  it("continues after auto-run progress clears and a new final failure appears", () => {
    const controller = new TerminalAutoContinueController({
      enabled: true,
      limit: -1,
      prompt: "继续",
      keywords: ["high demand"],
    });

    expect(controller.processChunk("■ We're currently experiencing high demand, which may cause temporary errors.")).not.toBeNull();
    controller.recordInput("继续\r", { source: "auto" });

    expect(controller.processChunk(
      "■ We're currently experiencing high demand, which may cause temporary errors.\r\n› 继续 • Working (0s • esc to interrupt)\r\n■ We're currently experiencing high demand, which may cause temporary errors.",
    )).toBeNull();

    expect(controller.processChunk(
      "■ We're currently experiencing high demand, which may cause temporary errors.",
    )).toEqual({
      input: "继续\r",
      keyword: "high demand",
      matchCount: 2,
      prompt: "继续",
    });
  });

  it("respects the configured trigger limit", () => {
    const controller = new TerminalAutoContinueController({
      enabled: true,
      limit: 1,
      prompt: "继续",
      keywords: ["high demand", "temporarily unavailable"],
    });

    expect(controller.processChunk("high demand")).not.toBeNull();
    expect(controller.processChunk("temporarily unavailable")).toBeNull();
    expect(controller.snapshot().matchCount).toBe(1);
    expect(controller.snapshot().remaining).toBe(0);
  });

  it("supports unlimited mode across user submissions", () => {
    const controller = new TerminalAutoContinueController({
      enabled: true,
      limit: -1,
      prompt: "继续",
      keywords: ["high demand"],
    });

    expect(controller.processChunk("high demand")).not.toBeNull();
    expect(controller.processChunk("recovered")).toBeNull();
    controller.recordInput("下一次请求\r");
    expect(controller.processChunk("high demand")).not.toBeNull();
    expect(controller.snapshot().remaining).toBe(-1);
    expect(controller.snapshot().matchCount).toBe(2);
  });

  it("does not trigger multiple prompts for adjacent failure keywords in one user submission", () => {
    const controller = new TerminalAutoContinueController({
      enabled: true,
      limit: -1,
      prompt: "继续",
      keywords: ["high demand", "temporarily unavailable"],
    });

    expect(controller.processChunk("service is in high demand")).not.toBeNull();
    expect(controller.processChunk("temporarily unavailable, retry later")).toBeNull();
    expect(controller.snapshot().matchCount).toBe(1);

    expect(controller.processChunk("ready for input")).toBeNull();
    expect(controller.processChunk("temporarily unavailable")).toBeNull();
    expect(controller.snapshot().matchCount).toBe(1);

    controller.recordInput("下一轮请求\r");
    expect(controller.processChunk("temporarily unavailable")).not.toBeNull();
    expect(controller.snapshot().matchCount).toBe(2);
  });

  it("does not trigger from a keyword echoed from user input", () => {
    const controller = new TerminalAutoContinueController({
      enabled: true,
      limit: 1,
      prompt: "继续",
      keywords: ["high demand"],
    });

    controller.recordInput("high demand\r");

    expect(controller.processChunk("\u001b[?2004h> high demand\r\n")).toBeNull();
    expect(controller.snapshot().matchCount).toBe(0);

    expect(controller.processChunk("service is in high demand")).toEqual({
      input: "继续\r",
      keyword: "high demand",
      matchCount: 1,
      prompt: "继续",
    });
  });
});
