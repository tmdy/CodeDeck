// 参数设置类型 — 新增功能
// 提供比 RuntimeSettings 更细粒度的系统级默认参数配置

export interface ProviderParameterDefaults {
  default_model: string;
  default_extra_args: string;
  default_proxy: string;
}

export interface ClaudeCLISettings {
  setting_sources: string;
  max_turns?: number;
}

export type CodexTerminalMode = "direct" | "monitored";

export interface CodexCLISettings {
  wire_api: string;
  sandbox_mode?: string;
  skip_git_repo_check: boolean;
  terminal_mode: CodexTerminalMode;
  auto_continue_on_failure: boolean;
  auto_continue_limit: number;
  auto_continue_prompt: string;
  auto_continue_keywords: string[];
}

export interface CLISpecificSettings {
  claude: ClaudeCLISettings;
  codex: CodexCLISettings;
}

export const DEFAULT_CODEX_AUTO_CONTINUE_KEYWORDS = [
  "high demand",
  "temporary errors",
  "temporarily unavailable",
  "rate limit",
  "overloaded",
];

export interface ParameterSettings {
  /** 启动时继承全局 MCP 和 Skills，但不继承普通全局设置 */
  inherit_global_capabilities: boolean;
  /** 余额检测超时（毫秒）。字段名沿用旧配置以避免迁移。 */
  connectivity_test_timeout_ms: number;
  /** 每个 Provider 的默认参数 */
  provider_defaults: Record<string, ProviderParameterDefaults>;
  /** 每个启动模式的额外参数模板 */
  launch_mode_args: Record<string, string>;
  /** 环境变量注入 */
  extra_env: Record<string, string>;
  /** CLI 特定设置 */
  cli_settings: CLISpecificSettings;
}

function stripWrappingSingleQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

export function normalizeParameterSettings(settings?: Partial<ParameterSettings> | null): ParameterSettings {
  const defaults = defaultParameterSettings();
  const rawClaude = settings?.cli_settings?.claude;
  const rawCodex = settings?.cli_settings?.codex;
  const launchModeArgs = {
    ...defaults.launch_mode_args,
    ...(settings?.launch_mode_args ?? {}),
  };
  if (settings?.launch_mode_args?.direct !== undefined) {
    launchModeArgs.new = settings.launch_mode_args.direct;
  }
  if (settings?.launch_mode_args?.continue !== undefined) {
    launchModeArgs.continue_last = settings.launch_mode_args.continue;
  }
  const normalized: ParameterSettings = {
    inherit_global_capabilities:
      settings?.inherit_global_capabilities ?? defaults.inherit_global_capabilities,
    connectivity_test_timeout_ms:
      settings?.connectivity_test_timeout_ms ?? defaults.connectivity_test_timeout_ms,
    provider_defaults: settings?.provider_defaults ?? defaults.provider_defaults,
    launch_mode_args: launchModeArgs,
    extra_env: settings?.extra_env ?? defaults.extra_env,
    cli_settings: {
      claude: {
        setting_sources: rawClaude?.setting_sources ?? defaults.cli_settings.claude.setting_sources,
        ...(rawClaude?.max_turns !== undefined ? { max_turns: rawClaude.max_turns } : {}),
      },
      codex: {
        ...defaults.cli_settings.codex,
        ...(rawCodex ?? {}),
      },
    },
  };

  normalized.cli_settings.claude.setting_sources = stripWrappingSingleQuotes(
    normalized.cli_settings.claude.setting_sources,
  );
  normalized.cli_settings.codex.wire_api = stripWrappingSingleQuotes(
    normalized.cli_settings.codex.wire_api,
  );
  normalized.cli_settings.codex.terminal_mode = normalizeCodexTerminalMode(
    normalized.cli_settings.codex.terminal_mode,
  );
  const rawAutoContinueLimit = Math.floor(Number(normalized.cli_settings.codex.auto_continue_limit) || 1);
  normalized.cli_settings.codex.auto_continue_limit = rawAutoContinueLimit === -1
    ? -1
    : Math.max(1, rawAutoContinueLimit);
  normalized.cli_settings.codex.auto_continue_prompt =
    normalized.cli_settings.codex.auto_continue_prompt?.trim() || "继续";
  normalized.cli_settings.codex.auto_continue_keywords = normalizeAutoContinueKeywords(
    normalized.cli_settings.codex.auto_continue_keywords,
  );

  return normalized;
}

function normalizeAutoContinueKeywords(value?: string[]): string[] {
  const keywords = Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map((item) => item.trim())
      .filter(Boolean),
  ));
  return keywords.length > 0 ? keywords : [...DEFAULT_CODEX_AUTO_CONTINUE_KEYWORDS];
}

function normalizeCodexTerminalMode(value: string | undefined): CodexTerminalMode {
  return value === "direct" ? "direct" : "monitored";
}

export function defaultParameterSettings(): ParameterSettings {
  return {
    inherit_global_capabilities: true,
    connectivity_test_timeout_ms: 60000,
    provider_defaults: {},
    launch_mode_args: {
      new: "",
      continue_last: "",
      resume_selected: "",
      resume_picker: "",
      resume_picker_all: "",
    },
    extra_env: {},
    cli_settings: {
      claude: {
        setting_sources: "project,local",
      },
      codex: {
        wire_api: "responses",
        skip_git_repo_check: false,
        terminal_mode: "monitored",
        auto_continue_on_failure: true,
        auto_continue_limit: 1,
        auto_continue_prompt: "继续",
        auto_continue_keywords: [...DEFAULT_CODEX_AUTO_CONTINUE_KEYWORDS],
      },
    },
  };
}
