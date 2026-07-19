// 启动服务 — 统一生成命令预览与实际启动计划

import path from "node:path";
import { createHash } from "node:crypto";
import { APP_NAME } from "../branding.js";
import type { CommandPreview, LaunchRequest, PreviewEnvVar } from "../launcher/types.js";
import {
  DEFAULT_CLAUDE_COMMAND,
  DEFAULT_CODEX_COMMAND,
  PROVIDER_CLAUDE,
  normalizeClaudeReasoningEffort,
  normalizeCodexReasoningEffort,
  normalizeRuntimeSettings,
  resolveClaudeModelAliasMode,
  type LaunchMode,
  type Profile,
  type RuntimeSettings,
} from "../profile/types.js";
import {
  requiresFullAccessConfirmation,
  normalizeProfilePermissions,
  resolveEffectivePermissions,
  summarizePermissions,
  toClaudePermissionMode,
  toCodexPermissionConfig,
  type ProfilePermissions,
} from "../profile/permissions.js";
import { itemKey } from "../profile/keys-internal.js";
import { defaultParameterSettings } from "../parameter/types.js";
import { buildClaudeArgs, buildClaudeCommand } from "../provider/claude/command-builder.js";
import { buildCodexArgs, buildCodexCommand } from "../provider/codex/command-builder.js";
import type { ModelMappingsState } from "../model-mapping/config-types.js";
import type { ProfileService } from "./profile-service.js";
import {
  buildCodexSiteApiKeyEnv,
  buildCodexSiteProfileName,
  buildCodexSiteProviderId,
} from "./model-mapping-config-service.js";
import type { CodexTerminalMode } from "../parameter/types.js";

export interface CodexConfigWritePlan {
  profilePath: string;
  configFilePath: string;
  profileName: string;
  content: string;
  rulesContent: string;
  baseUrl: string;
  providerId: string;
  providerName: string;
  apiKeyEnv: string;
  targetModel: string;
}

export interface ClaudeSettingsWritePlan {
  settingsPath: string;
  content: string;
}

export interface LaunchExecutionPlan {
  valid: boolean;
  provider: string;
  launchMode: LaunchMode;
  terminalMode: CodexTerminalMode;
  cwd: string;
  commandBase: string;
  commandExecutable: string;
  commandArgs: string[];
  command: string;
  shell: "powershell";
  env: Record<string, string>;
  previewEnv: PreviewEnvVar[];
  requiredEnvKeys: string[];
  sessionId?: string;
  error?: string;
  claudeSettings?: ClaudeSettingsWritePlan;
  codexConfig?: CodexConfigWritePlan;
  codexAutoContinue?: CodexAutoContinuePlan;
  permissionSummary?: string;
  capabilitySummary?: string;
  terminalSummary?: string;
}

export interface CodexAutoContinuePlan {
  enabled: boolean;
  limit: number;
  prompt: string;
  keywords: string[];
  intervalMs?: number;
}

export interface LaunchServiceOptions {
  getModelMappingsState: () => ModelMappingsState;
  codexProfilesRoot: string;
  codexRuntimeHome?: string;
}

interface ProviderLaunchArtifacts {
  commandExecutable: string;
  commandArgs: string[];
  command: string;
  env: Record<string, string>;
  requiredEnvKeys: string[];
  codexConfig?: CodexConfigWritePlan;
  claudeSettings?: ClaudeSettingsWritePlan;
  permissionSummary: string;
}

type LaunchCapabilityOverlay = NonNullable<LaunchRequest["capability_overlay"]>;

export class LaunchService {
  constructor(
    private profileService: ProfileService,
    private options: LaunchServiceOptions,
  ) {}

  private getParameterSettings() {
    return this.profileService.getState().parameter_settings ?? defaultParameterSettings();
  }

  private getModeTemplateArgs(mode: LaunchMode): string {
    const settings = this.getParameterSettings();
    return settings.launch_mode_args?.[mode]?.trim() ?? "";
  }

  private getCombinedExtraArgs(runtime: RuntimeSettings): string {
    const templateArgs = this.getModeTemplateArgs(runtime.launch_mode);
    const runtimeArgs = runtime.extra_args.trim();
    return [templateArgs, runtimeArgs].filter(Boolean).join(" ").trim();
  }

  buildPreview(
    profile: Profile,
    runtime: RuntimeSettings,
    mappingsState?: ModelMappingsState,
    sessionId?: string,
  ): CommandPreview {
    const plan = this.buildPlan(profile, runtime, mappingsState, sessionId);
    return this.toPreview(plan);
  }

  previewForRequest(request: LaunchRequest): CommandPreview {
    const plan = this.buildExecutionPlan(request);
    return this.toPreview(plan);
  }

  buildExecutionPlan(request: LaunchRequest): LaunchExecutionPlan {
    const profile = this.profileService.getProfiles().find((item) => itemKey(item) === request.profile_key);
    if (!profile) {
      return this.buildInvalidPlan({
        provider: request.provider,
        launchMode: normalizeRuntimeSettings(request.runtime_settings, request.provider).launch_mode,
        cwd: request.runtime_settings.cwd,
        commandBase: request.runtime_settings.command_base,
        error: "Profile 不存在，无法启动。",
      });
    }

    return this.buildPlan(
      profile,
      request.runtime_settings,
      request.model_mappings_state,
      request.session_id,
      request.permission_override,
      request.capability_overlay,
      request.terminal_mode,
    );
  }

  private buildPlan(
    profile: Profile,
    runtime: RuntimeSettings,
    _mappingsState?: ModelMappingsState,
    sessionId?: string,
    permissionOverride?: LaunchRequest["permission_override"],
    capabilityOverlay?: LaunchCapabilityOverlay,
    terminalModeOverride?: LaunchRequest["terminal_mode"],
  ): LaunchExecutionPlan {
    const normalizedRuntime = normalizeRuntimeSettings(runtime, profile.provider);
    const normalizedSessionId = (sessionId ?? "").trim();
    const selectedModelId = resolveSelectedModelId(profile, normalizedRuntime);
    const basePlan = {
      provider: profile.provider,
      launchMode: normalizedRuntime.launch_mode,
      cwd: normalizedRuntime.cwd,
      commandBase: normalizedRuntime.command_base,
      sessionId: normalizedSessionId || undefined,
    } satisfies Pick<LaunchExecutionPlan, "provider" | "launchMode" | "cwd" | "commandBase" | "sessionId">;

    const providerErrors = this.validateProviderConfiguration(profile);
    if (providerErrors.length > 0) {
      return this.buildInvalidPlan({
        ...basePlan,
        error: providerErrors[0],
      });
    }

    if (!normalizedRuntime.cwd) {
      return this.buildInvalidPlan({
        ...basePlan,
        error: "工作目录不存在，请先设置有效的工作目录。",
      });
    }

    if (normalizedRuntime.launch_mode === "resume_selected" && !normalizedSessionId) {
      return this.buildInvalidPlan({
        ...basePlan,
        error: "恢复指定会话时必须提供 sessionId。",
      });
    }

    const permissions = resolveEffectivePermissions({
      provider: profile.provider,
      globalPermissions: this.profileService.getState().global_settings.permissions,
      profilePermissions: profile.permissions ? normalizeProfilePermissions(profile.permissions, profile.provider) : undefined,
      temporaryPreset: permissionOverride,
    });
    const permissionSummary = summarizePermissions(profile.provider, permissions);
    if (requiresFullAccessConfirmation(permissions)) {
      return this.buildInvalidPlan({
        ...basePlan,
        error: "全权限模式需要二次确认后才能保存或启动。",
        permissionSummary,
      });
    }

    const artifacts = profile.provider === PROVIDER_CLAUDE
      ? this.buildClaudeArtifacts(profile, normalizedRuntime, normalizedSessionId, selectedModelId, permissions, capabilityOverlay?.claude)
      : this.buildCodexArtifacts(profile, normalizedRuntime, normalizedSessionId, selectedModelId, permissions, capabilityOverlay?.codex);
    const env = this.mergeInjectedEnv(artifacts.env, normalizedRuntime.extra_env);
    const terminalMode = profile.provider === PROVIDER_CLAUDE
      ? this.buildClaudeTerminalMode(terminalModeOverride ?? normalizedRuntime.terminal_mode)
      : this.buildCodexTerminalMode(terminalModeOverride ?? normalizedRuntime.terminal_mode);

    return {
      valid: true,
      provider: profile.provider,
      launchMode: normalizedRuntime.launch_mode,
      terminalMode,
      cwd: normalizedRuntime.cwd,
      commandBase: normalizedRuntime.command_base,
      commandExecutable: artifacts.commandExecutable,
      commandArgs: artifacts.commandArgs,
      command: artifacts.command,
      shell: "powershell",
      env,
      previewEnv: this.toPreviewEnvList(env),
      requiredEnvKeys: artifacts.requiredEnvKeys,
      sessionId: normalizedSessionId || undefined,
      claudeSettings: artifacts.claudeSettings,
      codexConfig: artifacts.codexConfig,
      codexAutoContinue: profile.provider === PROVIDER_CLAUDE ? undefined : this.buildCodexAutoContinuePlan(),
      permissionSummary: artifacts.permissionSummary,
      capabilitySummary: this.buildCapabilitySummary(capabilityOverlay),
      terminalSummary: this.buildTerminalSummary(profile.provider, terminalMode),
    };
  }

  private buildClaudeArtifacts(
    profile: Profile,
    runtime: RuntimeSettings,
    sessionId: string,
    selectedModelId: string,
    permissions: ProfilePermissions,
    overlay?: LaunchCapabilityOverlay["claude"],
  ): ProviderLaunchArtifacts {
    const launchMode = runtime.launch_mode === "resume_picker_all"
      ? "resume_picker"
      : runtime.launch_mode;
    const commandBase = normalizeCommandExecutable(runtime.command_base, DEFAULT_CLAUDE_COMMAND);
    const managedSettings = this.buildClaudeSettingsWritePlan(itemKey(profile), permissions);
    const effort = normalizeClaudeReasoningEffort(profile.advancedModelMapping?.claude?.reasoningEffort);
    const settingsFiles = [
      ...(overlay?.settingsFile ? [overlay.settingsFile] : []),
      ...(managedSettings ? [managedSettings.settingsPath] : []),
    ];
    const args = buildClaudeArgs({
      commandBase: runtime.command_base,
      launchMode,
      extraArgs: this.getCombinedExtraArgs(runtime),
      sessionId,
      excludeUserSettings: runtime.exclude_user_settings,
      settingsFile: runtime.settings_file,
      settingsFiles,
      settingSources: this.getParameterSettings().cli_settings.claude.setting_sources,
      model: selectedModelId || undefined,
      effort: effort || undefined,
      permissionMode: toClaudePermissionMode(permissions),
      addDirs: overlay?.addDirs,
      pluginDirs: overlay?.pluginDirs,
      mcpConfigPaths: overlay?.mcpConfigPaths,
    });
    const command = buildClaudeCommand({
      commandBase,
      launchMode,
      extraArgs: this.getCombinedExtraArgs(runtime),
      sessionId,
      excludeUserSettings: runtime.exclude_user_settings,
      settingsFile: runtime.settings_file,
      settingsFiles,
      settingSources: this.getParameterSettings().cli_settings.claude.setting_sources,
      model: selectedModelId || undefined,
      effort: effort || undefined,
      permissionMode: toClaudePermissionMode(permissions),
      addDirs: overlay?.addDirs,
      pluginDirs: overlay?.pluginDirs,
      mcpConfigPaths: overlay?.mcpConfigPaths,
    });

    const env: Record<string, string> = {
      ANTHROPIC_BASE_URL: profile.url.trim(),
      ANTHROPIC_AUTH_TOKEN: profile.key.trim(),
    };
    if (selectedModelId) {
      env.ANTHROPIC_MODEL = selectedModelId;
      env.ANTHROPIC_CUSTOM_MODEL_OPTION = selectedModelId;
      env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME = selectedModelId;
    }
    if (profile.advancedModelMapping?.enabled) {
      const advancedClaude = profile.advancedModelMapping.claude;
      const aliasMode = resolveClaudeModelAliasMode(profile.advancedModelMapping);
      if (aliasMode === "single_model_compat" && selectedModelId) {
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = selectedModelId;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = selectedModelId;
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = selectedModelId;
        env.CLAUDE_CODE_SUBAGENT_MODEL = selectedModelId;
      } else if (aliasMode === "custom") {
        if (advancedClaude?.defaultTarget?.trim()) env.ANTHROPIC_MODEL = advancedClaude.defaultTarget.trim();
        if (advancedClaude?.opusTarget?.trim()) env.ANTHROPIC_DEFAULT_OPUS_MODEL = advancedClaude.opusTarget.trim();
        if (advancedClaude?.sonnetTarget?.trim()) env.ANTHROPIC_DEFAULT_SONNET_MODEL = advancedClaude.sonnetTarget.trim();
        if (advancedClaude?.haikuTarget?.trim()) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = advancedClaude.haikuTarget.trim();
        if (advancedClaude?.subagentTarget?.trim()) env.CLAUDE_CODE_SUBAGENT_MODEL = advancedClaude.subagentTarget.trim();
      }
    }
    return {
      commandExecutable: commandBase,
      commandArgs: args,
      command,
      env,
      requiredEnvKeys: ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"],
      claudeSettings: managedSettings,
      permissionSummary: summarizePermissions(profile.provider, permissions),
    };
  }

  private buildCodexArtifacts(
    profile: Profile,
    runtime: RuntimeSettings,
    sessionId: string,
    selectedModelId: string,
    permissions: ProfilePermissions,
    overlay?: LaunchCapabilityOverlay["codex"],
  ): ProviderLaunchArtifacts {
    const advancedOverride = profile.advancedModelMapping?.enabled
      ? profile.advancedModelMapping.codex?.commandLineModelOverride?.trim() ?? ""
      : "";
    const reasoningEffort = normalizeCodexReasoningEffort(profile.advancedModelMapping?.codex?.reasoningEffort);
    const profileKey = itemKey(profile);
    const siteProfileName = buildCodexSiteProfileName(profileKey);
    const apiKeyEnv = buildCodexSiteApiKeyEnv(profileKey);
    const providerId = buildCodexSiteProviderId(profileKey);
    const providerName = `${profile.name} Site`;
    const codexRuntimeHome = this.getCodexRuntimeHome();
    const profilePath = this.toDisplayPath(codexRuntimeHome);
    const configFilePath = this.toDisplayPath(this.getCodexConfigFilePath(codexRuntimeHome));
    const extraArgs = [
      this.getCombinedExtraArgs(runtime),
      `--profile ${JSON.stringify(siteProfileName)}`,
      ...this.buildCodexPermissionCliArgs(permissions),
      advancedOverride ? `--model ${JSON.stringify(advancedOverride)}` : "",
      reasoningEffort ? `-c model_reasoning_effort=${reasoningEffort}` : "",
    ].filter(Boolean).join(" ").trim();
    const commandBase = normalizeCommandExecutable(runtime.command_base, DEFAULT_CODEX_COMMAND);
    const codexSettings = this.getParameterSettings().cli_settings.codex;
    const wireApi = codexSettings.wire_api.trim() || "responses";
    const commandArgs = buildCodexArgs({
      commandBase: runtime.command_base,
      launchMode: runtime.launch_mode,
      extraArgs,
      sessionId,
      baseUrl: profile.url,
      model: advancedOverride,
      wireApi,
    });
    const command = buildCodexCommand({
      commandBase,
      launchMode: runtime.launch_mode,
      extraArgs,
      sessionId,
      baseUrl: profile.url,
      model: advancedOverride,
      wireApi,
    });

    return {
      commandExecutable: commandBase,
      commandArgs,
      command,
      env: {
        CODEX_HOME: profilePath,
        [apiKeyEnv]: profile.key.trim(),
      },
      requiredEnvKeys: ["CODEX_HOME", apiKeyEnv],
      codexConfig: {
        profilePath,
        configFilePath,
        profileName: siteProfileName,
        content: this.buildCodexConfigContent({
          profileName: siteProfileName,
          providerId,
          providerName,
          baseUrl: profile.url,
          apiKeyEnv,
          targetModel: selectedModelId,
          wireApi,
          skipGitRepoCheck: codexSettings.skip_git_repo_check,
          permissions,
          globalMcpToml: overlay?.globalMcpToml ?? "",
        }),
        rulesContent: this.buildCodexRulesContent(permissions),
        baseUrl: profile.url,
        providerId,
        providerName,
        apiKeyEnv,
        targetModel: selectedModelId,
      },
      permissionSummary: summarizePermissions(profile.provider, permissions),
    };
  }

  private buildCodexPermissionCliArgs(permissions: ProfilePermissions): string[] {
    const codexPermissions = toCodexPermissionConfig(permissions);
    if (codexPermissions.sandboxMode !== "danger-full-access") {
      return [];
    }
    return [
      `--sandbox ${JSON.stringify(codexPermissions.sandboxMode)}`,
      `--ask-for-approval ${JSON.stringify(codexPermissions.approvalPolicy)}`,
    ];
  }

  private buildClaudeSettingsWritePlan(profileKey: string, permissions: ProfilePermissions): ClaudeSettingsWritePlan | undefined {
    const settings = buildClaudeManagedSettings(permissions);
    if (!settings) {
      return undefined;
    }
    const settingsPath = path.join(
      path.dirname(this.options.codexProfilesRoot),
      "claude-runtime",
      "permissions",
      `claude-permissions-${hashProfileKey(profileKey)}.json`,
    );
    return {
      settingsPath: this.toDisplayPath(settingsPath),
      content: `${JSON.stringify(settings, null, 2)}\n`,
    };
  }

  private validateProviderConfiguration(profile: Profile): string[] {
    const errors: string[] = [];
    if (!profile.name.trim()) {
      errors.push("Provider 配置缺少名称。");
    }
    if (!profile.url.trim()) {
      errors.push("Provider 配置缺少 Base URL。");
    }
    if (!profile.key.trim()) {
      errors.push("Provider 配置缺少 API Key / Token。");
    }
    return errors;
  }

  private mergeInjectedEnv(
    providerEnv: Record<string, string>,
    runtimeEnv: Record<string, string>,
  ): Record<string, string> {
    const globalEnv = this.buildGlobalInjectedEnv();
    const extraEnv = this.getParameterSettings().extra_env ?? {};
    const normalizedExtraEnv = Object.fromEntries(
      Object.entries(extraEnv)
        .map(([key, value]) => [key.trim(), value] as const)
        .filter(([key]) => key.length > 0),
    );
    const normalizedRuntimeEnv = Object.fromEntries(
      Object.entries(runtimeEnv)
        .map(([key, value]) => [key.trim(), value] as const)
        .filter(([key]) => key.length > 0),
    );
    return {
      ...globalEnv,
      ...normalizedExtraEnv,
      ...normalizedRuntimeEnv,
      ...providerEnv,
    };
  }

  private buildGlobalInjectedEnv(): Record<string, string> {
    const settings = this.profileService.getState().global_settings;
    const env: Record<string, string> = {};
    const proxy = settings.proxy?.trim();
    if (proxy) {
      env.HTTP_PROXY = proxy;
      env.HTTPS_PROXY = proxy;
      env.ALL_PROXY = proxy;
    }
    return env;
  }

  private toPreview(plan: LaunchExecutionPlan): CommandPreview {
    return {
      command: plan.command,
      cwd: plan.cwd,
      env: plan.previewEnv,
      valid: plan.valid,
      error: plan.error,
      permissionSummary: plan.permissionSummary,
      capabilitySummary: plan.capabilitySummary,
      terminalSummary: plan.terminalSummary,
    };
  }

  private buildCapabilitySummary(overlay?: LaunchCapabilityOverlay): string {
    return this.buildCapabilityOverlaySummary(overlay);
  }

  private buildCapabilityOverlaySummary(overlay?: LaunchCapabilityOverlay): string {
    if (!overlay) {
      return this.getParameterSettings().inherit_global_capabilities
        ? "继承全局 MCP/Skills：启动时启用"
        : "继承全局 MCP/Skills：已关闭";
    }
    if (overlay.claude) {
      const parts = [
        overlay.claude.mcpConfigPaths.length > 0 ? "MCP" : "",
        overlay.claude.addDirs.length > 0 ? "Skills" : "",
        overlay.claude.pluginDirs.length > 0 ? "Plugins" : "",
      ].filter(Boolean);
      return parts.length > 0
        ? `继承全局能力：${parts.join(" / ")}`
        : "继承全局能力：无可用项";
    }
    if (overlay.codex) {
      const parts = [
        overlay.codex.globalMcpToml.trim() ? "MCP" : "",
        overlay.codex.skillLinks.length > 0 ? "Skills" : "",
      ].filter(Boolean);
      return parts.length > 0
        ? `继承全局能力：${parts.join(" / ")}`
        : "继承全局能力：无可用项";
    }
    return "继承全局能力：无可用项";
  }

  private buildCodexAutoContinuePlan(): CodexAutoContinuePlan {
    const terminalSettings = this.getParameterSettings().terminal;
    return {
      enabled: terminalSettings.auto_continue_on_failure,
      limit: terminalSettings.auto_continue_limit,
      prompt: terminalSettings.auto_continue_prompt,
      keywords: terminalSettings.auto_continue_keywords,
      intervalMs: terminalSettings.auto_continue_interval_ms,
    };
  }

  private buildCodexTerminalMode(override?: LaunchRequest["terminal_mode"]): CodexTerminalMode {
    if (override === "direct" || override === "monitored") {
      return override;
    }
    return this.getParameterSettings().terminal.terminal_mode;
  }

  private buildClaudeTerminalMode(override?: LaunchRequest["terminal_mode"]): CodexTerminalMode {
    if (override === "direct" || override === "monitored") {
      return override;
    }
    return this.getParameterSettings().terminal.terminal_mode;
  }

  private buildTerminalSummary(provider: string, terminalMode: CodexTerminalMode): string {
    if (provider === PROVIDER_CLAUDE) {
      return terminalMode === "monitored"
        ? "Claude 终端：受监控独立窗口"
        : "Claude 终端：系统直连";
    }
    if (terminalMode === "direct") {
      return "Codex 终端：系统直连（不接管交互）";
    }
    return this.buildCodexMonitoredTerminalSummary();
  }

  private buildCodexMonitoredTerminalSummary(): string {
    const terminalSettings = this.getParameterSettings().terminal;
    if (!terminalSettings.auto_continue_on_failure) {
      return "Codex 终端：受监控独立窗口（自动继续关闭）";
    }
    if (terminalSettings.auto_continue_limit === -1) {
      return "Codex 终端：受监控独立窗口（自动继续已启用，不限次数）";
    }
    return `Codex 终端：受监控独立窗口（自动继续已启用，最多 ${terminalSettings.auto_continue_limit} 次）`;
  }

  private toPreviewEnvList(env: Record<string, string>): PreviewEnvVar[] {
    return Object.entries(env).map(([name, value]) => {
      const present = value.trim().length > 0;
      const sensitive = /key|token|secret|password/i.test(name);
      return {
        name,
        present,
        displayValue: sensitive
          ? (present ? "[已设置]" : "[未设置]")
          : (present ? value : "[未设置]"),
        sensitive,
      };
    });
  }

  private buildInvalidPlan(options: {
    provider: string;
    launchMode: LaunchMode;
    cwd: string;
    commandBase: string;
    error: string;
    sessionId?: string;
    permissionSummary?: string;
  }): LaunchExecutionPlan {
    return {
      valid: false,
      provider: options.provider,
      launchMode: options.launchMode,
      terminalMode: "direct",
      cwd: options.cwd.trim(),
      commandBase: options.commandBase.trim(),
      commandExecutable: normalizeCommandExecutable(
        options.commandBase,
        options.provider === PROVIDER_CLAUDE ? DEFAULT_CLAUDE_COMMAND : DEFAULT_CODEX_COMMAND,
      ),
      commandArgs: [],
      command: "",
      shell: "powershell",
      env: {},
      previewEnv: [],
      requiredEnvKeys: [],
      sessionId: options.sessionId,
      error: options.error,
      permissionSummary: options.permissionSummary,
    };
  }

  private toDisplayPath(targetPath: string): string {
    return targetPath.replace(/\\/g, "/");
  }

  private getCodexRuntimeHome(): string {
    if (this.options.codexRuntimeHome?.trim()) {
      return this.options.codexRuntimeHome;
    }
    return path.join(path.dirname(this.options.codexProfilesRoot), "codex-runtime", "home");
  }

  private getCodexConfigFilePath(codexRuntimeHome: string): string {
    return path.join(codexRuntimeHome, "config.toml");
  }

  private buildCodexConfigContent(options: {
    profileName: string;
    providerId: string;
    providerName: string;
    baseUrl: string;
    apiKeyEnv: string;
    targetModel: string;
    wireApi: string;
    skipGitRepoCheck: boolean;
    permissions: ProfilePermissions;
    globalMcpToml?: string;
  }): string {
    const targetModel = options.targetModel.trim();
    const codexPermissions = toCodexPermissionConfig(options.permissions);
    const webSearchMode = options.permissions.common.allowNetwork ? "live" : "disabled";
    const wireApi = options.wireApi.trim() || "responses";
    const skipGitRepoCheckLines = options.skipGitRepoCheck
      ? ["skip_git_repo_check = true"]
      : [];
    const workspaceLines = codexPermissions.sandboxMode === "workspace-write"
      ? [
          "[sandbox_workspace_write]",
          `network_access = ${options.permissions.common.allowNetwork ? "true" : "false"}`,
          `writable_roots = [${options.permissions.common.additionalWritableRoots.map((item) => JSON.stringify(item)).join(", ")}]`,
          "",
        ]
      : [];
    const shellEnvironmentLines = options.permissions.common.denyEnvFiles
      ? [
          "[shell_environment_policy]",
          'exclude = ["*KEY*", "*TOKEN*", "*SECRET*", "*PASSWORD*", "CODEX_SITE_API_KEY_*"]',
          "",
        ]
      : [];
    const topLevelLines = targetModel
      ? [
          `model = ${JSON.stringify(targetModel)}`,
          `model_provider = ${JSON.stringify(options.providerId)}`,
          ...skipGitRepoCheckLines,
          `sandbox_mode = ${JSON.stringify(codexPermissions.sandboxMode)}`,
          `approval_policy = ${JSON.stringify(codexPermissions.approvalPolicy)}`,
          `web_search = ${JSON.stringify(webSearchMode)}`,
          "",
        ]
      : [
          ...skipGitRepoCheckLines,
          `sandbox_mode = ${JSON.stringify(codexPermissions.sandboxMode)}`,
          `approval_policy = ${JSON.stringify(codexPermissions.approvalPolicy)}`,
          `web_search = ${JSON.stringify(webSearchMode)}`,
          "",
        ];
    const globalMcpToml = options.globalMcpToml?.trim() ? `${options.globalMcpToml.trim()}\n` : "";
    return [
      ...topLevelLines,
      ...workspaceLines,
      ...shellEnvironmentLines,
      `[model_providers.${options.providerId}]`,
      `name = ${JSON.stringify(options.providerName)}`,
      `base_url = ${JSON.stringify(options.baseUrl)}`,
      `env_key = ${JSON.stringify(options.apiKeyEnv)}`,
      `wire_api = ${JSON.stringify(wireApi)}`,
      "",
      "[windows]",
      'sandbox = "elevated"',
      "",
      globalMcpToml,
    ].join("\n");
  }

  private buildCodexRulesContent(permissions: ProfilePermissions): string {
    const rules: string[] = [];
    if (permissions.common.denyGitPush) {
      rules.push(renderCodexPrefixRule(
        ["git", "push"],
        "git push is disabled by profile permissions.",
      ));
    }
    if (permissions.common.denyDangerousDelete) {
      for (const pattern of CODEX_DANGEROUS_DELETE_PATTERNS) {
        rules.push(renderCodexPrefixRule(
          pattern,
          "Dangerous deletion is disabled by profile permissions.",
        ));
      }
    }
    return [
      `# Managed by ${APP_NAME}. Do not edit by hand.`,
      "# This file is regenerated from the selected profile's permission switches.",
      "",
      ...rules,
    ].join("\n").trimEnd() + "\n";
  }
}

function resolveSelectedModelId(profile: Profile, runtime: RuntimeSettings): string {
  return profile.selectedModelId?.trim() || runtime.model?.trim() || "";
}

function normalizeCommandExecutable(commandBase: string, fallback: string): string {
  const trimmed = commandBase.trim();
  if (!trimmed) {
    return fallback;
  }
  if ((trimmed.startsWith("\"") && trimmed.endsWith("\"")) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim() || fallback;
  }
  return trimmed;
}

interface ClaudeManagedSettings {
  $schema: string;
  permissions?: {
    deny?: string[];
    additionalDirectories?: string[];
  };
  sandbox?: {
    enabled: boolean;
    filesystem?: {
      allowWrite?: string[];
      denyRead?: string[];
    };
    network?: {
      deniedDomains?: string[];
    };
  };
}

const CLAUDE_SENSITIVE_READ_RULES = [
  "Read(./.env)",
  "Read(./.env.*)",
  "Read(./**/.env)",
  "Read(./**/.env.*)",
  "Read(./secrets/**)",
  "Read(./config/credentials.json)",
  "Read(./**/*.key)",
  "Read(./**/*.pem)",
  "Read(./**/id_rsa)",
  "Read(./**/id_ed25519)",
];

const CLAUDE_SENSITIVE_SANDBOX_DENY_READ = [
  "./.env",
  "./.env.*",
  "./secrets",
  "./config/credentials.json",
  "~/.ssh",
  "~/.aws/credentials",
];

const CLAUDE_GIT_PUSH_DENY_RULES = [
  "Bash(git push)",
  "Bash(git push *)",
  "PowerShell(git push)",
  "PowerShell(git push *)",
];

const CLAUDE_DANGEROUS_DELETE_DENY_RULES = [
  "Bash(rm -rf *)",
  "Bash(rm -fr *)",
  "Bash(rm -r *)",
  "Bash(rm --recursive *)",
  "Bash(del /s *)",
  "Bash(erase /s *)",
  "Bash(rmdir /s *)",
  "Bash(rd /s *)",
  "Bash(Remove-Item -Recurse *)",
  "Bash(Remove-Item -r *)",
  "Bash(remove-item -Recurse *)",
  "Bash(remove-item -r *)",
  "PowerShell(Remove-Item -Recurse *)",
  "PowerShell(Remove-Item -r *)",
  "PowerShell(remove-item -Recurse *)",
  "PowerShell(remove-item -r *)",
];

const CLAUDE_NETWORK_DENY_RULES = [
  "WebFetch",
  "Bash(curl *)",
  "Bash(wget *)",
  "Bash(Invoke-WebRequest *)",
  "Bash(iwr *)",
  "PowerShell(Invoke-WebRequest *)",
  "PowerShell(iwr *)",
];

const CODEX_DANGEROUS_DELETE_PATTERNS = [
  ["rm", "-rf"],
  ["rm", "-fr"],
  ["rm", "-r"],
  ["rm", "--recursive"],
  ["del", "/s"],
  ["erase", "/s"],
  ["rmdir", "/s"],
  ["rd", "/s"],
  ["Remove-Item", "-Recurse"],
  ["Remove-Item", "-r"],
  ["remove-item", "-Recurse"],
  ["remove-item", "-r"],
];

function buildClaudeManagedSettings(
  permissions: ProfilePermissions,
): ClaudeManagedSettings | undefined {
  const denyRules = uniqueStrings([
    ...(permissions.common.denyEnvFiles ? CLAUDE_SENSITIVE_READ_RULES : []),
    ...(permissions.common.denyGitPush ? CLAUDE_GIT_PUSH_DENY_RULES : []),
    ...(permissions.common.denyDangerousDelete ? CLAUDE_DANGEROUS_DELETE_DENY_RULES : []),
    ...(!permissions.common.allowNetwork ? CLAUDE_NETWORK_DENY_RULES : []),
  ]);
  const additionalDirectories = uniqueStrings(permissions.common.additionalWritableRoots);
  const sandboxFilesystem: NonNullable<NonNullable<ClaudeManagedSettings["sandbox"]>["filesystem"]> = {};
  if (additionalDirectories.length > 0) {
    sandboxFilesystem.allowWrite = additionalDirectories;
  }
  if (permissions.common.denyEnvFiles) {
    sandboxFilesystem.denyRead = CLAUDE_SENSITIVE_SANDBOX_DENY_READ;
  }
  const sandboxNetwork = !permissions.common.allowNetwork ? { deniedDomains: ["*"] } : undefined;
  const hasPermissions = denyRules.length > 0 || additionalDirectories.length > 0;
  const hasSandbox = Object.keys(sandboxFilesystem).length > 0 || Boolean(sandboxNetwork);
  const settings: ClaudeManagedSettings = {
    $schema: "https://json.schemastore.org/claude-code-settings.json",
  };
  if (hasPermissions) {
    settings.permissions = {
      ...(denyRules.length > 0 ? { deny: denyRules } : {}),
      ...(additionalDirectories.length > 0 ? { additionalDirectories } : {}),
    };
  }
  if (hasSandbox) {
    settings.sandbox = {
      enabled: true,
      ...(Object.keys(sandboxFilesystem).length > 0 ? { filesystem: sandboxFilesystem } : {}),
      ...(sandboxNetwork ? { network: sandboxNetwork } : {}),
    };
  }
  return settings;
}

function renderCodexPrefixRule(pattern: string[], justification: string): string {
  return [
    "prefix_rule(",
    `    pattern = [${pattern.map((item) => JSON.stringify(item)).join(", ")}],`,
    '    decision = "forbidden",',
    `    justification = ${JSON.stringify(justification)},`,
    ")",
  ].join("\n");
}

function hashProfileKey(profileKey: string): string {
  return createHash("sha256").update(profileKey.trim(), "utf8").digest("hex").slice(0, 16);
}

function uniqueStrings(values: string[]): string[] {
  return values
    .map((value) => value.trim())
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
}
