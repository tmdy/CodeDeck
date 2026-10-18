import { cleanTerminalText } from "../agent-bridge/protocol.js";

export type TerminalActivity = "idle" | "busy";

export type TerminalActivityReason =
  | "submitted_input"
  | "busy_output"
  | "idle_prompt"
  | "turn_started"
  | "turn_completed"
  | "turn_failed"
  | "process_exit"
  | "session_closed"
  | "session_changed";

export interface TerminalActivityObservation {
  activity: TerminalActivity;
  reason: TerminalActivityReason;
}

const ANSI_SEQUENCE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const ANSI_SEQUENCE_PREFIX_PATTERN = /^\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/;
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const BUSY_OUTPUT_PATTERN =
  /\b(?:working|reconnecting|thinking|processing)\s*(?:\([^\r\n)]*\)|\.{3}|…)|(?:esc|ctrl\+c)\s+to\s+interrupt/i;
const INTERACTIVE_PROMPT_PATTERN =
  /(?:do you trust the contents of this directory|do you want to proceed|would you like to|allow (?:this|once|always)|approve (?:this|once|always)|enter to confirm|press enter|continue\?|proceed\?|\(y\/n\)|\[y\/n\]|是否(?:允许|继续|确认)|需要(?:授权|确认)|请选择)/i;
const HOOKS_REVIEW_TITLE_PATTERN = /hooks?\s+needs?\s+review/i;
const HOOKS_REVIEW_ACTION_PATTERN =
  /(?:press\s+t\s+to\s+trust\s+all|enter\s+to\s+review\s+hooks|esc\s+to\s+close)/i;
const PROMPT_LINE_PATTERN = /(?:^|[\r\n])\s*[›❯]\s*/g;
const IDLE_PROMPT_PLACEHOLDER_PATTERN = /^(?:ask codex to do anything|explain this codebase|implement \{feature\}|find and fix a bug in @filename|write tests for @filename|improve documentation in @filename|run \/review on my current changes|summarize recent commits)(?:\s|$)/i;
// Codex FinalMessageSeparator is painted after a finished response. Require the
// complete duration + completion clock row, not an incidental "Worked for" quote.
const COMPLETED_WORK_LINE_PATTERN = /^[ \t]*(?:─+[ \t]*)?Worked for (?:\d+h \d+m \d+s|\d+m \d+s|\d+s|<1s) • (?:(?:[A-Z][a-z]{2} \d{1,2}(?:, \d{4})? at )?\d{1,2}:\d{2}(?: ?[ap]m)?)(?: • [^\r\n]*)?[ \t]*(?:─+)?[ \t]*$/gim;
const MAX_RAW_TERMINAL_TAIL = 256_000;

function stripTerminalControlText(value: string): string {
  return value
    .replace(ANSI_SEQUENCE_PATTERN, "")
    .replace(CONTROL_CHAR_PATTERN, "");
}

function hasOpenCodeFence(value: string): boolean {
  let fence: string | undefined;
  for (const line of value.split(/\r?\n/)) {
    const marker = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
    if (!marker) {
      continue;
    }
    if (!fence) {
      fence = marker[1];
    } else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
      fence = undefined;
    }
  }
  return fence !== undefined;
}

export function containsInteractiveTerminalPrompt(value: string): boolean {
  const visible = stripTerminalControlText(value);
  return INTERACTIVE_PROMPT_PATTERN.test(visible)
    || (
      HOOKS_REVIEW_TITLE_PATTERN.test(visible)
      && HOOKS_REVIEW_ACTION_PATTERN.test(visible)
    );
}

export function containsBusyTerminalOutput(value: string): boolean {
  return BUSY_OUTPUT_PATTERN.test(stripTerminalControlText(value));
}

export class TerminalActivityDetector {
  private bracketedPaste = false;
  private currentInputLine = "";
  private rawTerminalTail = "";

  resetOutput(): void {
    this.rawTerminalTail = "";
  }

  recordInput(input: string): TerminalActivityObservation | null {
    let submittedNonEmptyInput = false;
    for (let index = 0; index < input.length;) {
      const remaining = input.slice(index);
      if (remaining.startsWith("\x1b[200~")) {
        this.bracketedPaste = true;
        index += 6;
        continue;
      }
      if (remaining.startsWith("\x1b[201~")) {
        this.bracketedPaste = false;
        index += 6;
        continue;
      }
      const controlSequence = remaining.match(ANSI_SEQUENCE_PREFIX_PATTERN)?.[0];
      if (controlSequence) {
        index += controlSequence.length;
        continue;
      }
      const char = input[index];
      if (char === "\r" || char === "\n") {
        if (this.bracketedPaste) {
          this.currentInputLine += "\n";
        } else {
          submittedNonEmptyInput ||= this.currentInputLine.trim().length > 0;
          this.currentInputLine = "";
        }
        index += 1;
        continue;
      }
      if (char === "\x7f" || char === "\b") {
        this.currentInputLine = this.currentInputLine.slice(0, -1);
        index += 1;
        continue;
      }
      if (char === "\x03") {
        this.currentInputLine = "";
        index += 1;
        continue;
      }
      const visible = stripTerminalControlText(char);
      if (visible) {
        this.currentInputLine += visible;
      }
      index += 1;
    }
    if (!submittedNonEmptyInput) {
      return null;
    }
    this.rawTerminalTail = "";
    return { activity: "busy", reason: "submitted_input" };
  }

  observeOutput(chunk: string): TerminalActivityObservation | null {
    if (!chunk) {
      return null;
    }
    this.rawTerminalTail = `${this.rawTerminalTail}${chunk}`.slice(-MAX_RAW_TERMINAL_TAIL);
    const candidate = cleanTerminalText(this.rawTerminalTail);

    const promptEnds: number[] = [];
    for (const match of candidate.matchAll(PROMPT_LINE_PATTERN)) {
      promptEnds.push((match.index ?? 0) + match[0].length);
    }
    const lastPromptEnd = promptEnds.at(-1) ?? -1;
    if (lastPromptEnd === -1) {
      return containsBusyTerminalOutput(candidate)
        ? { activity: "busy", reason: "busy_output" }
        : null;
    }
    const previousPromptEnd = promptEnds.at(-2);
    const currentTurnStart = previousPromptEnd ?? 0;
    const beforePrompt = candidate.slice(currentTurnStart, lastPromptEnd);
    const completion = [...beforePrompt.matchAll(COMPLETED_WORK_LINE_PATTERN)].at(-1);
    const completionOffset = completion
      ? (completion.index ?? 0) + completion[0].length
      : undefined;
    // The TUI separator is the final row before the new idle prompt. A quoted
    // example followed by code/answer text must not discard current busy evidence.
    const completionEnd = completion && completionOffset !== undefined
      && /^[\s›❯]*$/.test(beforePrompt.slice(completionOffset))
      && !hasOpenCodeFence(beforePrompt.slice(0, completion.index))
      ? currentTurnStart + (completion.index ?? 0) + completion[0].length
      : undefined;
    if (containsInteractiveTerminalPrompt(candidate.slice(completionEnd ?? 0))) {
      return null;
    }
    const afterPrompt = candidate.slice(lastPromptEnd);
    if (containsBusyTerminalOutput(afterPrompt)) {
      return { activity: "busy", reason: "busy_output" };
    }
    const promptLine = afterPrompt.split(/[\r\n]/, 1)[0];
    if (
      promptLine.trim()
      && !IDLE_PROMPT_PLACEHOLDER_PATTERN.test(promptLine.trim())
    ) {
      return containsBusyTerminalOutput(candidate)
        ? { activity: "busy", reason: "busy_output" }
        : null;
    }
    if (
      previousPromptEnd !== undefined
      && containsBusyTerminalOutput(candidate.slice(completionEnd ?? previousPromptEnd))
    ) {
      return { activity: "busy", reason: "busy_output" };
    }
    return { activity: "idle", reason: "idle_prompt" };
  }
}
