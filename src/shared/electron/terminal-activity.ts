export type TerminalActivity = "idle" | "busy";

export type TerminalActivityReason =
  | "submitted_input"
  | "busy_output"
  | "idle_prompt"
  | "turn_started"
  | "turn_completed"
  | "process_exit"
  | "session_closed";

export interface TerminalActivityObservation {
  activity: TerminalActivity;
  reason: TerminalActivityReason;
}

const ANSI_SEQUENCE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const BUSY_OUTPUT_PATTERN = /\b(?:working|reconnecting|thinking|processing)\b|(?:esc|ctrl\+c)\s+to\s+interrupt/i;
const PROMPT_LINE_PATTERN = /(?:^|[\r\n])\s*[›❯]\s*/g;
const MAX_VISIBLE_TAIL = 512;

function stripTerminalControlText(value: string): string {
  return value
    .replace(ANSI_SEQUENCE_PATTERN, "")
    .replace(CONTROL_CHAR_PATTERN, "");
}

export class TerminalActivityDetector {
  private currentInputLine = "";
  private visibleTail = "";

  recordInput(input: string): TerminalActivityObservation | null {
    let submittedNonEmptyInput = false;
    // xterm sends CSI I / CSI O when focus reporting is enabled. Treat all
    // complete terminal control sequences as controls instead of allowing
    // their printable suffixes (for example "[O") to become submitted text.
    const normalizedInput = input.replace(ANSI_SEQUENCE_PATTERN, "");
    for (const char of normalizedInput) {
      if (char === "\r" || char === "\n") {
        submittedNonEmptyInput ||= this.currentInputLine.trim().length > 0;
        this.currentInputLine = "";
        continue;
      }
      if (char === "\x7f" || char === "\b") {
        this.currentInputLine = this.currentInputLine.slice(0, -1);
        continue;
      }
      if (char === "\x03") {
        this.currentInputLine = "";
        continue;
      }
      const visible = stripTerminalControlText(char);
      if (visible) {
        this.currentInputLine += visible;
      }
    }
    if (!submittedNonEmptyInput) {
      return null;
    }
    this.visibleTail = "";
    return { activity: "busy", reason: "submitted_input" };
  }

  observeOutput(chunk: string): TerminalActivityObservation | null {
    if (!chunk) {
      return null;
    }
    const visible = stripTerminalControlText(chunk);
    const candidate = `${this.visibleTail}${visible}`;
    this.visibleTail = candidate.slice(-MAX_VISIBLE_TAIL);

    if (BUSY_OUTPUT_PATTERN.test(visible)) {
      return { activity: "busy", reason: "busy_output" };
    }

    let lastPromptEnd = -1;
    for (const match of candidate.matchAll(PROMPT_LINE_PATTERN)) {
      lastPromptEnd = (match.index ?? 0) + match[0].length;
    }
    if (lastPromptEnd === -1) {
      return null;
    }
    const afterPrompt = candidate.slice(lastPromptEnd);
    if (BUSY_OUTPUT_PATTERN.test(afterPrompt)) {
      return { activity: "busy", reason: "busy_output" };
    }
    return { activity: "idle", reason: "idle_prompt" };
  }
}
