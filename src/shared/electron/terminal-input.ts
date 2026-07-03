export interface TerminalKeyboardShortcut {
  type: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export function toTerminalPasteInput(text: string): string {
  return text
    .replace(/\0/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n/g, "\r");
}

export function shouldCopyTerminalSelection(
  event: TerminalKeyboardShortcut,
  hasSelection: boolean,
): boolean {
  if (!hasSelection || event.type !== "keydown") {
    return false;
  }
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c";
}

export function shouldReadTerminalClipboardFromShortcut(event: TerminalKeyboardShortcut): boolean {
  if (event.type !== "keydown") {
    return false;
  }
  return event.shiftKey && event.key.toLowerCase() === "insert";
}

export function shouldHandleTerminalTextPasteData(data: string): boolean {
  return data === "\x16";
}
