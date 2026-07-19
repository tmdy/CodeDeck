// Provider 元数据 — 翻译自 Go internal/domain/provider/metadata.go

import { PROVIDER_CLAUDE, PROVIDER_CODEX, normalizeProvider } from "../profile/types.js";

export interface ProviderMetadata {
  id: string;
  displayName: string;
  defaultCommandBase: string;
}

export function getProviderMetadata(providerID: string): ProviderMetadata {
  switch (normalizeProvider(providerID)) {
    case PROVIDER_CODEX:
      return {
        id: PROVIDER_CODEX,
        displayName: "Codex",
        defaultCommandBase: "codex",
      };
    default:
      return {
        id: PROVIDER_CLAUDE,
        displayName: "Claude",
        defaultCommandBase: "claude",
      };
  }
}