import { describe, expect, it } from "vitest";
import {
  shouldHandleTerminalTextPasteData,
  shouldCopyTerminalSelection,
  shouldReadTerminalClipboardFromShortcut,
  toTerminalPasteInput,
} from "../../electron/terminal-input.js";

describe("terminal input helpers", () => {
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
