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
  /** 连接测试超时（毫秒） */
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

export function defaultParameterSettings(): ParameterSettings {
  return {
    launch_timeout_ms: 30000,
    connectivity_test_timeout_ms: 60000,
    provider_defaults: {},
    launch_mode_args: {
      direct: "",
      continue: "",
      resume_selected: "",
    },
    extra_env: {},
    cli_settings: {
      claude: {
        setting_sources: "'project,local'",
        permission_mode: "'acceptEdits'",
      },
      codex: {
        wire_api: "'responses'",
        skip_git_repo_check: false,
      },
    },
  };
}