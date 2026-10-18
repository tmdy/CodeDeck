import { describe, expect, it } from "vitest";
import {
  shouldHandleTerminalTextPasteData,
  shouldCopyTerminalSelection,
  shouldReadTerminalClipboardFromShortcut,
  toTerminalPasteInput,
  TerminalInputClassifier,
} from "../../electron/terminal-input.js";

describe("terminal input helpers", () => {
  it.each([
    "\x1b[I", "\x1b[O", "\x1b[<0;12;34M", "\x1b[<0;12;34m", "\x1b[M !!",
    "\x1b[32;12;34M", "\x1b[?1;2c", "\x1b[>0;276;0c", "\x1b[0n", "\x1b[?12;34R",
    "\x1b[4;1080;1920t", "\x1b[6;18;9t", "\x1b[8;60;140t", "\x1b[?1004;1$y",
    "\x1b]10;rgb:ffff/aaaa/1111\x1b\\", "\x1b]4;2;rgb:ff/aa/11\x07", "\x1bP1$r0m\x1b\\",
  ])("excludes explicit xterm protocol response %j from user input", (packet) => {
    expect(new TerminalInputClassifier().classify(packet)).toEqual({ userInput: "", cancelAutoContinue: false });
  });

  it.each(["\x1b[A", "\x1b[1;5D", "\x1bOP", "\x1b[15~", "\x03", "\r", "text", "\x1b[999x"])("keeps actual keys and unknown input %j as cancelling input", (input) => {
    expect(new TerminalInputClassifier().classify(input)).toEqual({ userInput: input, cancelAutoContinue: true });
  });

  it("cancels standalone/incomplete Escape immediately, retaining bounded context for fragmented responses", () => {
    const classifier = new TerminalInputClassifier();
    expect(classifier.classify("\x1b")).toEqual({ userInput: "", cancelAutoContinue: true });
    expect(classifier.classify("[I")).toEqual({ userInput: "", cancelAutoContinue: false });
    expect(classifier.classify("\x1b[<0;").cancelAutoContinue).toBe(true);
    expect(classifier.classify("12;34M").userInput).toBe("");
    expect(classifier.classify("\r").userInput).toBe("\r");
  });

  it("requires and consumes a recent DSR query for an otherwise ambiguous modified F3/CPR", () => {
    const classifier = new TerminalInputClassifier();
    expect(classifier.classify("\x1b[1;2R").cancelAutoContinue).toBe(true);
    classifier.observeOutput("query\x1b[");
    classifier.observeOutput("6n");
    expect(classifier.classify("\x1b[1;2R").cancelAutoContinue).toBe(false);
    expect(classifier.classify("\x1b[1;2R").cancelAutoContinue).toBe(true);
  });

  it("clears query authority at a turn boundary without losing active paste context", () => {
    const classifier = new TerminalInputClassifier();
    classifier.observeOutput("\x1b[6n");
    classifier.resetQueries();
    expect(classifier.classify("\x1b[1;2R").cancelAutoContinue).toBe(true);
    classifier.classify("\x1b[200~");
    classifier.resetQueries();
    expect(classifier.classify("\x1b[I").userInput).toBe("\x1b[I");
  });

  it("does not let an unterminated unknown escape frame consume a later submitted line", () => {
    const classifier = new TerminalInputClassifier();
    classifier.classify("\x1b]unknown");
    expect(classifier.classify("real text\r")).toEqual({ userInput: "\x1b]unknownreal text\r", cancelAutoContinue: true });
  });

  it("filters mixed reports without dropping text and treats literal escape sequences inside paste as user input", () => {
    const classifier = new TerminalInputClassifier();
    expect(classifier.classify("\x1b[Ihello\x1b[O\r")).toEqual({ userInput: "hello\r", cancelAutoContinue: true });
    expect(classifier.classify("\x1b[20").cancelAutoContinue).toBe(true);
    expect(classifier.classify("0~\x1b[I")).toEqual({ userInput: "\x1b[200~\x1b[I", cancelAutoContinue: true });
    expect(classifier.classify("literal\x1b[201")).toEqual({ userInput: "literal", cancelAutoContinue: true });
    expect(classifier.classify("~\x1b[O")).toEqual({ userInput: "\x1b[201~", cancelAutoContinue: true });
    expect(classifier.classify("\x1b[I")).toEqual({ userInput: "", cancelAutoContinue: false });
  });
  it("normalizes pasted text line endings to terminal carriage returns", () => {
    expect(toTerminalPasteInput("第一行\n第二行\r\n第三行")).toBe("第一行\r第二行\r第三行");
  });

  it("uses Ctrl+C as copy only when terminal text is selected", () => {
    expect(shouldCopyTerminalSelection({
      type: "keydown",
      key: "c",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    }, true)).toBe(true);

    expect(shouldCopyTerminalSelection({
      type: "keydown",
      key: "c",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    }, false)).toBe(false);
  });

  it("supports Ctrl+Shift+C and ignores keyup events for copy", () => {
    expect(shouldCopyTerminalSelection({
      type: "keydown",
      key: "C",
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
    }, true)).toBe(true);

    expect(shouldCopyTerminalSelection({
      type: "keyup",
      key: "c",
      ctrlKey: true,
      metaKey: false,
      shiftKey: true,
    }, true)).toBe(false);
  });

  it("handles Ctrl+V as text paste but lets Alt+V image paste pass through", () => {
    expect(shouldHandleTerminalTextPasteData("\x16")).toBe(true);
    expect(shouldHandleTerminalTextPasteData("\x1bv")).toBe(false);
  });

  it("lets Ctrl+V use the browser paste event and keeps Shift+Insert as a clipboard fallback", () => {
    expect(shouldReadTerminalClipboardFromShortcut({
      type: "keydown",
      key: "v",
      ctrlKey: true,
      metaKey: false,
      shiftKey: false,
    })).toBe(false);

    expect(shouldReadTerminalClipboardFromShortcut({
      type: "keydown",
      key: "Insert",
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
    })).toBe(true);
  });
});
