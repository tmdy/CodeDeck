// 参数设置类型 — 新增功能
// 提供比 RuntimeSettings 更细粒度的系统级默认参数配置

export interface ProviderParameterDefaults {
  default_model: string;
  default_extra_args: string;
  default_proxy: string;
}

export interface ClaudeCLISettings {
  setting_sources: string;
  permission_mode: string;
  max_turns?: number;
}

export interface CodexCLISettings {
  wire_api: string;
  sandbox_mode?: string;
  skip_git_repo_check: boolean;
}

export interface CLISpecificSettings {
  claude: ClaudeCLISettings;
  codex: CodexCLISettings;
}

export interface ParameterSettings {
  /** 启动超时（毫秒） */
  launch_timeout_ms: number;
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
    launch_timeout_ms: settings?.launch_timeout_ms ?? defaults.launch_timeout_ms,
    inherit_global_capabilities:
      settings?.inherit_global_capabilities ?? defaults.inherit_global_capabilities,
    connectivity_test_timeout_ms:
      settings?.connectivity_test_timeout_ms ?? defaults.connectivity_test_timeout_ms,
    provider_defaults: settings?.provider_defaults ?? defaults.provider_defaults,
    launch_mode_args: launchModeArgs,
    extra_env: settings?.extra_env ?? defaults.extra_env,
    cli_settings: {
      claude: {
        ...defaults.cli_settings.claude,
        ...(settings?.cli_settings?.claude ?? {}),
      },
      codex: {
        ...defaults.cli_settings.codex,
        ...(settings?.cli_settings?.codex ?? {}),
      },
    },
  };

  normalized.cli_settings.claude.setting_sources = stripWrappingSingleQuotes(
    normalized.cli_settings.claude.setting_sources,
  );
  normalized.cli_settings.claude.permission_mode = stripWrappingSingleQuotes(
    normalized.cli_settings.claude.permission_mode,
  );
  normalized.cli_settings.codex.wire_api = stripWrappingSingleQuotes(
    normalized.cli_settings.codex.wire_api,
  );

  return normalized;
}

export function defaultParameterSettings(): ParameterSettings {
  return {
    launch_timeout_ms: 30000,
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
        permission_mode: "acceptEdits",
      },
      codex: {
        wire_api: "responses",
        skip_git_repo_check: false,
      },
    },
  };
}
