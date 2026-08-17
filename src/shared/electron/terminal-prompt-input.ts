export const CLI_READY_PROMPT_PATTERN = /(?:^|\n)\s*[›❯]\s+[^\n]*(?:\n|$)/;

export interface TerminalPromptInput {
  data: string;
  submitSeparately: boolean;
}

export function normalizeTerminalPromptInput(prompt: string): TerminalPromptInput {
  const normalized = prompt
    .replace(/\0/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  return normalized.includes("\n")
    ? { data: `\x1b[200~${normalized}\x1b[201~`, submitSeparately: true }
    : { data: normalized, submitSeparately: true };
}

export function hasTerminalCliReadyPrompt(visibleText: string): boolean {
  return CLI_READY_PROMPT_PATTERN.test(visibleText);
}
