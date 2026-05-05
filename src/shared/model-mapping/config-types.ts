export const MODEL_MAPPING_CLIENTS = ["claude", "codex"] as const;
export const CLAUDE_ALIASES = ["default", "opus", "sonnet", "haiku", "subagent"] as const;
export const CODEX_ALIASES = ["default", "strong", "fast", "custom"] as const;
export const DEFAULT_CODEX_PROXY_PORT = 4141;

export type MappingClient = (typeof MODEL_MAPPING_CLIENTS)[number];
export type ClaudeAlias = (typeof CLAUDE_ALIASES)[number];
export type CodexAlias = (typeof CODEX_ALIASES)[number];
export type MappingAlias = ClaudeAlias | CodexAlias;

export interface ModelMappingConfig {
  client: MappingClient;
  alias: MappingAlias;
  targetModel: string;
  enabled: boolean;
  fallbackToDefault: boolean;
}

export interface ModelMappingsState {
  providers: [];
  mappings: ModelMappingConfig[];
  selectedClient: MappingClient;
  selectedClaudeAlias: ClaudeAlias;
  selectedCodexAlias: CodexAlias;
  codexProxyPort: number;
  fetchedModelsByClient: Partial<Record<MappingClient, string[]>>;
  lastFetchedAtByClient: Partial<Record<MappingClient, string>>;
}

export const CLAUDE_ALIAS_LABELS: Record<ClaudeAlias, string> = {
  default: "Default",
  opus: "Opus",
  sonnet: "Sonnet",
  haiku: "Haiku",
  subagent: "Subagent",
};

export const CODEX_ALIAS_LABELS: Record<CodexAlias, string> = {
  default: "Default",
  strong: "Strong",
  fast: "Fast",
  custom: "Custom",
};

export function createDefaultMappings(): ModelMappingConfig[] {
  return [
    ...CLAUDE_ALIASES.map<ModelMappingConfig>((alias) => ({
      client: "claude",
      alias,
      targetModel: "",
      enabled: true,
      fallbackToDefault: alias !== "default",
    })),
    ...CODEX_ALIASES.map<ModelMappingConfig>((alias) => ({
      client: "codex",
      alias,
      targetModel: "",
      enabled: true,
      fallbackToDefault: alias !== "default",
    })),
  ];
}

export function createDefaultModelMappingsState(): ModelMappingsState {
  return {
    providers: [],
    mappings: createDefaultMappings(),
    selectedClient: "claude",
    selectedClaudeAlias: "default",
    selectedCodexAlias: "default",
    codexProxyPort: DEFAULT_CODEX_PROXY_PORT,
    fetchedModelsByClient: {},
    lastFetchedAtByClient: {},
  };
}

function normalizeClient(value: string | undefined): MappingClient {
  return value === "codex" ? "codex" : "claude";
}

export function normalizeClaudeAlias(value: string | undefined): ClaudeAlias {
  return (CLAUDE_ALIASES as readonly string[]).includes(value ?? "") ? (value as ClaudeAlias) : "default";
}

export function normalizeCodexAlias(value: string | undefined): CodexAlias {
  return (CODEX_ALIASES as readonly string[]).includes(value ?? "") ? (value as CodexAlias) : "default";
}

function normalizeAlias(value: string | undefined, client: MappingClient): MappingAlias {
  return client === "claude" ? normalizeClaudeAlias(value) : normalizeCodexAlias(value);
}

export function normalizeMappingConfig(value: Partial<ModelMappingConfig>): ModelMappingConfig {
  const client = normalizeClient(value.client);
  return {
    client,
    alias: normalizeAlias(value.alias, client),
    targetModel: value.targetModel?.trim() ?? "",
    enabled: value.enabled ?? true,
    fallbackToDefault: value.fallbackToDefault ?? (value.alias !== "default"),
  };
}

export function normalizeModelMappingsState(raw?: Partial<ModelMappingsState> | null): ModelMappingsState {
  const defaults = createDefaultModelMappingsState();
  const normalizedMappings = (raw?.mappings ?? []).map((item) => normalizeMappingConfig(item));
  const mappingByKey = new Map(
    normalizedMappings.map((item) => [`${item.client}:${item.alias}`, item] as const),
  );

  return {
    providers: [],
    mappings: defaults.mappings.map((item) => mappingByKey.get(`${item.client}:${item.alias}`) ?? item),
    selectedClient: normalizeClient(raw?.selectedClient),
    selectedClaudeAlias: normalizeClaudeAlias(raw?.selectedClaudeAlias),
    selectedCodexAlias: normalizeCodexAlias(raw?.selectedCodexAlias),
    codexProxyPort: Number.isFinite(raw?.codexProxyPort)
      ? Math.max(1, Number(raw?.codexProxyPort))
      : defaults.codexProxyPort,
    fetchedModelsByClient: {
      claude: Array.from(new Set((raw?.fetchedModelsByClient?.claude ?? []).map((item) => item.trim()).filter(Boolean))),
      codex: Array.from(new Set((raw?.fetchedModelsByClient?.codex ?? []).map((item) => item.trim()).filter(Boolean))),
    },
    lastFetchedAtByClient: {
      claude: raw?.lastFetchedAtByClient?.claude?.trim() || undefined,
      codex: raw?.lastFetchedAtByClient?.codex?.trim() || undefined,
    },
  };
}

export function cloneModelMappingsState(raw?: Partial<ModelMappingsState> | null): ModelMappingsState {
  return normalizeModelMappingsState(raw);
}

export function validateModelMappingsState(state: ModelMappingsState): string[] {
  const errors: string[] = [];
  for (const mapping of state.mappings) {
    if (mapping.enabled && mapping.alias === "default" && mapping.targetModel && !mapping.targetModel.trim()) {
      errors.push(`mapping.targetModel 非法: ${mapping.client}/${mapping.alias}`);
    }
  }

  if (!Number.isFinite(state.codexProxyPort) || state.codexProxyPort <= 0) {
    errors.push("codexProxyPort 必须为正整数");
  }

  return errors;
}
