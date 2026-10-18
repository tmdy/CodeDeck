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

export interface ClassifiedTerminalInput {
  userInput: string;
  cancelAutoContinue: boolean;
}

// xterm sends protocol replies through onData too. Only explicit response shapes
// are exempt; keyboard CSI sequences and ambiguous/incomplete packets cancel.
export class TerminalInputClassifier {
  private pending = "";
  private bracketedPaste = false;
  private outputTail = "";
  private cursorRequests: number[] = [];

  resetQueries(): void {
    this.cursorRequests = [];
    this.outputTail = "";
  }

  observeOutput(chunk: string): void {
    const candidate = this.outputTail + chunk;
    let end = 0;
    for (const match of candidate.matchAll(/\x1b\[6n/g)) {
      this.cursorRequests.push(Date.now());
      end = (match.index ?? 0) + match[0].length;
    }
    this.cursorRequests = this.cursorRequests.filter((time) => Date.now() - time <= 1_000).slice(-8);
    this.outputTail = candidate.slice(end).slice(-3);
  }

  classify(data: string): ClassifiedTerminalInput {
    let input = this.pending + data;
    this.pending = "";
    let userInput = "";
    let cancelAutoContinue = false;
    while (input) {
      const pasteMarker = this.bracketedPaste ? "\x1b[201~" : "\x1b[200~";
      if (input.startsWith(pasteMarker)) {
        this.bracketedPaste = !this.bracketedPaste;
        userInput += pasteMarker;
        cancelAutoContinue = true;
        input = input.slice(pasteMarker.length);
        continue;
      }
      if (pasteMarker.startsWith(input)) {
        this.pending = input;
        cancelAutoContinue = true;
        break;
      }
      if (this.bracketedPaste || input[0] !== "\x1b") {
        userInput += input[0];
        cancelAutoContinue = true;
        input = input.slice(1);
        continue;
      }
      let packet: string | undefined;
      if (input.startsWith("\x1b[M")) {
        packet = input.length >= 6 ? input.slice(0, 6) : undefined;
      } else if (input.startsWith("\x1b[")) {
        packet = input.match(/^\x1b\[[0-?]*[ -/]*[@-~]/)?.[0];
      } else if (input.startsWith("\x1b]") || input.startsWith("\x1bP")) {
        packet = input.match(/^\x1b[\]P][\s\S]*?(?:\x07|\x1b\\)/)?.[0];
      } else if (input.length > 1) {
        packet = input.slice(0, 2);
      }
      if (!packet) {
        // No grace timer: even a standalone Escape cancels immediately. Retain
        // only parsing context so split replies cannot pollute the input line.
        cancelAutoContinue = true;
        if (input.length <= 4_096 && !/[\r\n\x03]/.test(input)) this.pending = input;
        else userInput += input;
        break;
      }
      if (!this.isProtocolResponse(packet)) {
        cancelAutoContinue = true;
        userInput += packet;
      }
      input = input.slice(packet.length);
    }
    return { userInput, cancelAutoContinue };
  }

  private isProtocolResponse(packet: string): boolean {
    if (/^\x1b\[(?:[IO]|<\d+;\d+;\d+[Mm]|\d+;\d+;\d+M|\?[\d;]+c|>[\d;]+c|0n|\?\d+;\d+R|[468];\d+;\d+t|\??\d+;\d+\$y)$/.test(packet)
      || /^\x1b\[M[\x20-\uffff]{3}$/.test(packet)
      || /^\x1b\](?:(?:10|11|12);|4;\d+;)rgb:[\da-f]{1,4}\/[\da-f]{1,4}\/[\da-f]{1,4}(?:\x07|\x1b\\)$/i.test(packet)
      || /^\x1bP[01]\$r[\x20-\x7e]*\x1b\\$/.test(packet)) {
      return true;
    }
    // Plain CPR overlaps modified F3. Require a recent output-side DSR query.
    this.cursorRequests = this.cursorRequests.filter((time) => Date.now() - time <= 1_000);
    if (/^\x1b\[\d+;\d+R$/.test(packet) && this.cursorRequests.length > 0) {
      this.cursorRequests.shift();
      return true;
    }
    return false;
  }
}
