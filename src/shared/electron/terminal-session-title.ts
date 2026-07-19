import { normalizeProvider, PROVIDER_CODEX } from "../profile/types.js";

const MAX_TERMINAL_DISPLAY_TITLE_LENGTH = 80;

function providerDisplayName(provider: string): string {
  return normalizeProvider(provider) === PROVIDER_CODEX ? "Codex" : "Claude";
}

export function normalizeTerminalDisplayTitle(value?: string): string {
  const normalized = (value ?? "").trim().replace(/\s+/g, " ");
  return normalized.slice(0, MAX_TERMINAL_DISPLAY_TITLE_LENGTH);
}

export function buildTerminalHeaderTitle(provider: string, displayTitle?: string): string {
  const normalizedTitle = normalizeTerminalDisplayTitle(displayTitle);
  return normalizedTitle || `${providerDisplayName(provider)} 终端`;
}

export function buildTerminalWindowTitle(provider: string, displayTitle?: string): string {
  const normalizedTitle = normalizeTerminalDisplayTitle(displayTitle);
  const providerName = providerDisplayName(provider);
  return normalizedTitle ? `${normalizedTitle} - ${providerName}` : `${providerName} 终端`;
}
