// 启动服务 — 统一生成命令预览与实际启动计划

import path from "node:path";
import type { CommandPreview, LaunchRequest, PreviewEnvVar } from "../launcher/types.js";
import {
  DEFAULT_CLAUDE_COMMAND,
  DEFAULT_CODEX_COMMAND,
  PROVIDER_CLAUDE,
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

export interface CodexConfigWritePlan {
  profilePath: string;
  profileName: string;
  content: string;
  baseUrl: string;
  providerId: string;
  providerName: string;
  apiKeyEnv: string;
  targetModel: string;
}

export interface LaunchExecutionPlan {
  valid: boolean;
  provider: string;
  launchMode: LaunchMode;
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
  codexConfig?: CodexConfigWritePlan;
  permissionSummary?: string;
  capabilitySummary?: string;
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
    );
  }

  private buildPlan(
    profile: Profile,
    runtime: RuntimeSettings,
    _mappingsState?: ModelMappingsState,
    sessionId?: string,
    permissionOverride?: LaunchRequest["permission_override"],
    capabilityOverlay?: LaunchCapabilityOverlay,
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
      globalPermissions: normalizeProfilePermissions(this.profileService.getState().global_settings.permissions, profile.provider),
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

    return {
      valid: true,
      provider: profile.provider,
      launchMode: normalizedRuntime.launch_mode,
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
      codexConfig: artifacts.codexConfig,
      permissionSummary: artifacts.permissionSummary,
      capabilitySummary: this.buildCapabilitySummary(capabilityOverlay),
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
    const args = buildClaudeArgs({
      commandBase: runtime.command_base,
      launchMode,
      extraArgs: this.getCombinedExtraArgs(runtime),
      sessionId,
      excludeUserSettings: runtime.exclude_user_settings,
      settingsFile: runtime.settings_file,
      settingsFiles: overlay?.settingsFile ? [overlay.settingsFile] : [],
      settingSources: this.getParameterSettings().cli_settings.claude.setting_sources,
      model: selectedModelId || undefined,
      permissionMode: toClaudePermissionMode(permissions.preset),
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
      settingsFiles: overlay?.settingsFile ? [overlay.settingsFile] : [],
      settingSources: this.getParameterSettings().cli_settings.claude.setting_sources,
      model: selectedModelId || undefined,
      permissionMode: toClaudePermissionMode(permissions.preset),
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
    const profileKey = itemKey(profile);
    const siteProfileName = buildCodexSiteProfileName(profileKey);
    const apiKeyEnv = buildCodexSiteApiKeyEnv(profileKey);
    const providerId = buildCodexSiteProviderId(profileKey);
    const providerName = `${profile.name} Site`;
    const profilePath = this.toDisplayPath(this.getCodexRuntimeHome());
    const extraArgs = [
      this.getCombinedExtraArgs(runtime),
      `--profile ${JSON.stringify(siteProfileName)}`,
      ...this.buildCodexPermissionCliArgs(permissions),
      advancedOverride ? `--model ${JSON.stringify(advancedOverride)}` : "",
    ].filter(Boolean).join(" ").trim();
    const commandBase = normalizeCommandExecutable(runtime.command_base, DEFAULT_CODEX_COMMAND);
    const commandArgs = buildCodexArgs({
      commandBase: runtime.command_base,
      launchMode: runtime.launch_mode,
      extraArgs,
      sessionId,
      baseUrl: profile.url,
      model: advancedOverride,
      wireApi: "responses",
    });
    const command = buildCodexCommand({
      commandBase,
      launchMode: runtime.launch_mode,
      extraArgs,
      sessionId,
      baseUrl: profile.url,
      model: advancedOverride,
      wireApi: "responses",
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
        profileName: siteProfileName,
        content: this.buildCodexConfigContent({
          profileName: siteProfileName,
          providerId,
          providerName,
          baseUrl: profile.url,
          apiKeyEnv,
          targetModel: selectedModelId,
          permissions,
          globalMcpToml: overlay?.globalMcpToml ?? "",
        }),
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
    if (permissions.preset !== "full_access") {
      return [];
    }
    const codexPermissions = toCodexPermissionConfig(permissions.preset);
    return [
      `--sandbox ${JSON.stringify(codexPermissions.sandboxMode)}`,
      `--ask-for-approval ${JSON.stringify(codexPermissions.approvalPolicy)}`,
    ];
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
      ...normalizedExtraEnv,
      ...normalizedRuntimeEnv,
      ...providerEnv,
    };
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
    };
  }

  private buildCapabilitySummary(overlay?: LaunchCapabilityOverlay): string {
    if (!overlay) {
      return "继承全局 MCP/Skills：启动时启用";
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
    return "继承全局 MCP/Skills：启动时启用";
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

  private buildCodexConfigContent(options: {
    profileName: string;
    providerId: string;
    providerName: string;
    baseUrl: string;
    apiKeyEnv: string;
    targetModel: string;
    permissions: ProfilePermissions;
    globalMcpToml?: string;
  }): string {
    const targetModel = options.targetModel.trim();
    const codexPermissions = toCodexPermissionConfig(options.permissions.preset);
    const webSearchMode = options.permissions.common.allowNetwork ? "live" : "disabled";
    const workspaceLines = codexPermissions.sandboxMode === "workspace-write"
      ? [
          "[sandbox_workspace_write]",
          `network_access = ${options.permissions.common.allowNetwork ? "true" : "false"}`,
          `writable_roots = [${options.permissions.common.additionalWritableRoots.map((item) => JSON.stringify(item)).join(", ")}]`,
          "",
        ]
      : [];
    const topLevelLines = targetModel
      ? [
          `model = ${JSON.stringify(targetModel)}`,
          `model_provider = ${JSON.stringify(options.providerId)}`,
          `sandbox_mode = ${JSON.stringify(codexPermissions.sandboxMode)}`,
          `approval_policy = ${JSON.stringify(codexPermissions.approvalPolicy)}`,
          `web_search = ${JSON.stringify(webSearchMode)}`,
          "",
        ]
      : [
          `sandbox_mode = ${JSON.stringify(codexPermissions.sandboxMode)}`,
          `approval_policy = ${JSON.stringify(codexPermissions.approvalPolicy)}`,
          `web_search = ${JSON.stringify(webSearchMode)}`,
          "",
        ];
    const globalMcpToml = options.globalMcpToml?.trim() ? `${options.globalMcpToml.trim()}\n` : "";
    return [
      ...topLevelLines,
      ...workspaceLines,
      `[model_providers.${options.providerId}]`,
      `name = ${JSON.stringify(options.providerName)}`,
      `base_url = ${JSON.stringify(options.baseUrl)}`,
      `env_key = ${JSON.stringify(options.apiKeyEnv)}`,
      'wire_api = "responses"',
      "",
      "[windows]",
      'sandbox = "elevated"',
      "",
      globalMcpToml,
    ].join("\n");
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
