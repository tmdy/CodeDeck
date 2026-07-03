export interface TerminalAutoContinueConfig {
  enabled: boolean;
  limit: number;
  prompt: string;
  keywords: string[];
}

export interface TerminalAutoContinueAction {
  input: string;
  keyword: string;
  matchCount: number;
  prompt: string;
}

export type TerminalAutoContinueInputSource = "user" | "auto";

export interface TerminalAutoContinueDiagnostic {
  phase: "matched" | "skipped";
  reason: "keyword_match" | "echoed_input" | "active_failure_region" | "limit_reached" | "retry_progress";
  keyword: string;
  matchCount: number;
  remaining: number;
  visibleExcerpt: string;
}

export interface TerminalAutoContinueControllerOptions {
  onDiagnostic?: (diagnostic: TerminalAutoContinueDiagnostic) => void;
}

export interface TerminalAutoContinueSnapshot {
  enabled: boolean;
  limit: number;
  matchCount: number;
  remaining: number;
  lastMatchedKeyword: string | null;
}

interface KeywordMatchContext {
  keyword: string;
  index: number;
  visibleText: string;
  normalizedText: string;
}

const ANSI_SEQUENCE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const CONTROL_CHAR_PATTERN = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
const RECONNECT_PROGRESS_PATTERN = /\breconnecting\.\.\.\s*\d+\s*\/\s*\d+\b/i;
const RUN_PROGRESS_PATTERN = /\b(?:working|reconnecting\.\.\.\s*\d+\s*\/\s*\d+)\b/i;
const MAX_RECENT_INPUTS = 8;
const MATCH_EXCERPT_RADIUS = 120;

function stripTerminalControlText(value: string): string {
  return value
    .replace(ANSI_SEQUENCE_PATTERN, "")
    .replace(CONTROL_CHAR_PATTERN, "");
}

function normalizeVisibleText(value: string): string {
  return stripTerminalControlText(value).toLowerCase();
}

function isKeywordBoundary(value: string | undefined): boolean {
  return !value || !/[a-z0-9]/i.test(value);
}

function findKeywordMatch(
  candidate: string,
  keywords: string[],
  searchFrom = 0,
): { keyword: string; index: number } | null {
  let bestMatch: { keyword: string; index: number } | null = null;
  for (const keyword of keywords) {
    let keywordSearchFrom = searchFrom;
    while (keywordSearchFrom <= candidate.length) {
      const index = candidate.indexOf(keyword, keywordSearchFrom);
      if (index === -1) {
        break;
      }
      const before = candidate[index - 1];
      const after = candidate[index + keyword.length];
      if (isKeywordBoundary(before) && isKeywordBoundary(after)) {
        if (!bestMatch || index < bestMatch.index) {
          bestMatch = { keyword, index };
        }
        break;
      }
      keywordSearchFrom = index + 1;
    }
  }
  return bestMatch;
}

function createVisibleExcerpt(visibleText: string, matchIndex: number, keywordLength: number): string {
  const start = Math.max(0, matchIndex - MATCH_EXCERPT_RADIUS);
  const end = Math.min(visibleText.length, matchIndex + keywordLength + MATCH_EXCERPT_RADIUS);
  return visibleText.slice(start, end).replace(/\s+/g, " ").trim();
}

export class TerminalAutoContinueController {
  private readonly enabled: boolean;
  private readonly limit: number;
  private readonly prompt: string;
  private readonly keywords: string[];
  private readonly maxKeywordLength: number;
  private readonly onDiagnostic?: (diagnostic: TerminalAutoContinueDiagnostic) => void;
  private pendingTail = "";
  private pendingVisibleTail = "";
  private matchCount = 0;
  private activeKeyword: string | null = null;
  private lastMatchedKeyword: string | null = null;
  private currentInputLine = "";
  private recentSubmittedInputs: string[] = [];
  private waitingForAutoRunProgress = false;
  private autoRunProgressSeen = false;

  constructor(
    config: TerminalAutoContinueConfig,
    options: TerminalAutoContinueControllerOptions = {},
  ) {
    this.enabled = config.enabled;
    this.limit = config.limit === -1 ? -1 : Math.max(1, Math.floor(config.limit || 1));
    this.prompt = config.prompt.trim() || "继续";
    this.keywords = Array.from(new Set(
      config.keywords
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ));
    this.maxKeywordLength = this.keywords.reduce(
      (maxLength, keyword) => Math.max(maxLength, keyword.length),
      1,
    );
    this.onDiagnostic = options.onDiagnostic;
  }

  processChunk(chunk: string): TerminalAutoContinueAction | null {
    if (!this.enabled || !chunk) {
      return null;
    }

    const visibleChunk = stripTerminalControlText(chunk);
    const normalizedChunk = visibleChunk.toLowerCase();
    const visibleCandidate = `${this.pendingVisibleTail}${visibleChunk}`;
    const candidate = `${this.pendingTail}${normalizedChunk}`;
    const chunkMatch = findKeywordMatch(normalizedChunk, this.keywords);
    const candidateMatch: KeywordMatchContext | null = chunkMatch
      ? {
          ...chunkMatch,
          visibleText: visibleChunk,
          normalizedText: normalizedChunk,
        }
      : (() => {
          const match = findKeywordMatch(candidate, this.keywords);
          return match
            ? {
                ...match,
                visibleText: visibleCandidate,
                normalizedText: candidate,
              }
            : null;
        })();

    this.pendingTail = candidate.slice(-(this.maxKeywordLength - 1 || 1));
    this.pendingVisibleTail = visibleCandidate.slice(-(this.maxKeywordLength - 1 || 1));

    if (!candidateMatch) {
      this.noteAutoRunProgress(normalizedChunk);
      return null;
    }

    for (
      let currentMatch: KeywordMatchContext | null = candidateMatch;
      currentMatch;
      currentMatch = this.findNextMatch(currentMatch)
    ) {
      const matchedKeyword = currentMatch.keyword;
      const normalizedMatchText = currentMatch.normalizedText;
      const visibleExcerpt = createVisibleExcerpt(
        currentMatch.visibleText,
        currentMatch.index,
        matchedKeyword.length,
      );

      this.noteAutoRunProgress(normalizedMatchText);

      if (this.consumeEchoedInputMatch(candidate, matchedKeyword)) {
        this.emitDiagnostic("skipped", "echoed_input", matchedKeyword, visibleExcerpt);
        continue;
      }

      if (this.isReconnectProgressMatch(normalizedMatchText, currentMatch.index)) {
        this.emitDiagnostic("skipped", "retry_progress", matchedKeyword, visibleExcerpt);
        continue;
      }

      if (this.hasRunProgressStatus(normalizedMatchText)) {
        this.emitDiagnostic("skipped", "active_failure_region", matchedKeyword, visibleExcerpt);
        continue;
      }

      if (this.activeKeyword) {
        if (this.autoRunProgressSeen) {
          this.activeKeyword = null;
          this.autoRunProgressSeen = false;
        } else {
          this.emitDiagnostic("skipped", "active_failure_region", matchedKeyword, visibleExcerpt);
          continue;
        }
      }

      this.activeKeyword = matchedKeyword;
      if (this.limit !== -1 && this.matchCount >= this.limit) {
        this.emitDiagnostic("skipped", "limit_reached", matchedKeyword, visibleExcerpt);
        return null;
      }

      this.matchCount += 1;
      this.lastMatchedKeyword = matchedKeyword;
      this.emitDiagnostic("matched", "keyword_match", matchedKeyword, visibleExcerpt);
      return {
        input: `${this.prompt}\r`,
        keyword: matchedKeyword,
        matchCount: this.matchCount,
        prompt: this.prompt,
      };
    }

    return null;
  }

  recordInput(
    input: string,
    options: { source?: TerminalAutoContinueInputSource } = {},
  ): void {
    const source = options.source ?? "user";
    for (const char of input) {
      if (char === "\r" || char === "\n") {
        const submittedInput = this.currentInputLine;
        this.rememberSubmittedInput(this.currentInputLine);
        if (source === "user" && submittedInput.trim()) {
          this.activeKeyword = null;
          this.waitingForAutoRunProgress = false;
          this.autoRunProgressSeen = false;
        }
        if (source === "auto" && submittedInput.trim()) {
          this.waitingForAutoRunProgress = true;
          this.autoRunProgressSeen = false;
        }
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
      if (char === "\x1b") {
        continue;
      }
      const normalized = normalizeVisibleText(char);
      if (normalized) {
        this.currentInputLine += normalized;
      }
    }
  }

  snapshot(): TerminalAutoContinueSnapshot {
    return {
      enabled: this.enabled,
      limit: this.limit,
      matchCount: this.matchCount,
      remaining: this.limit === -1 ? -1 : Math.max(0, this.limit - this.matchCount),
      lastMatchedKeyword: this.lastMatchedKeyword,
    };
  }

  private consumeEchoedInputMatch(candidate: string, matchedKeyword: string): boolean {
    const inputCandidates = [
      this.currentInputLine,
      ...this.recentSubmittedInputs,
    ].filter((input) => input.includes(matchedKeyword));

    const echoedInput = inputCandidates.find((input) => input && candidate.includes(input));
    if (!echoedInput) {
      return false;
    }

    this.recentSubmittedInputs = this.recentSubmittedInputs.filter((input) => input !== echoedInput);
    if (this.currentInputLine === echoedInput) {
      this.currentInputLine = "";
    }
    return true;
  }

  private rememberSubmittedInput(input: string): void {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }
    this.recentSubmittedInputs.unshift(trimmed);
    this.recentSubmittedInputs = this.recentSubmittedInputs.slice(0, MAX_RECENT_INPUTS);
  }

  private findNextMatch(currentMatch: KeywordMatchContext): KeywordMatchContext | null {
    const nextMatch = findKeywordMatch(
      currentMatch.normalizedText,
      this.keywords,
      currentMatch.index + Math.max(1, currentMatch.keyword.length),
    );
    return nextMatch
      ? {
          ...nextMatch,
          visibleText: currentMatch.visibleText,
          normalizedText: currentMatch.normalizedText,
        }
      : null;
  }

  private hasRunProgressStatus(normalizedText: string): boolean {
    return RUN_PROGRESS_PATTERN.test(normalizedText);
  }

  private noteAutoRunProgress(normalizedText: string): void {
    if (!this.waitingForAutoRunProgress || !this.hasRunProgressStatus(normalizedText)) {
      return;
    }
    this.waitingForAutoRunProgress = false;
    this.autoRunProgressSeen = true;
  }

  private isReconnectProgressMatch(normalizedText: string, matchIndex: number): boolean {
    const contextBeforeMatch = normalizedText.slice(
      Math.max(0, matchIndex - MATCH_EXCERPT_RADIUS),
      matchIndex,
    );
    return RECONNECT_PROGRESS_PATTERN.test(contextBeforeMatch);
  }

  private emitDiagnostic(
    phase: TerminalAutoContinueDiagnostic["phase"],
    reason: TerminalAutoContinueDiagnostic["reason"],
    keyword: string,
    visibleExcerpt: string,
  ): void {
    this.onDiagnostic?.({
      phase,
      reason,
      keyword,
      matchCount: this.matchCount,
      remaining: this.limit === -1 ? -1 : Math.max(0, this.limit - this.matchCount),
      visibleExcerpt,
    });
  }
}
