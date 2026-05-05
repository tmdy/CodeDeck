// 启动服务 — 统一生成命令预览与实际启动计划

import path from "node:path";
import type { CommandPreview, LaunchRequest, PreviewEnvVar } from "../launcher/types.js";
import {
  DEFAULT_CLAUDE_COMMAND,
  DEFAULT_CODEX_COMMAND,
  PROVIDER_CLAUDE,
  normalizeRuntimeSettings,
  type LaunchMode,
  type Profile,
  type RuntimeSettings,
} from "../profile/types.js";
import { itemKey } from "../profile/keys-internal.js";
import { defaultParameterSettings } from "../parameter/types.js";
import { buildClaudeArgs, buildClaudeCommand } from "../provider/claude/command-builder.js";
import { buildCodexArgs, buildCodexCommand } from "../provider/codex/command-builder.js";
import type { ModelMappingsState } from "../model-mapping/config-types.js";
import type { ProfileService } from "./profile-service.js";

export interface CodexConfigWritePlan {
  profilePath: string;
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
}

export interface LaunchServiceOptions {
  getModelMappingsState: () => ModelMappingsState;
  codexProfilesRoot: string;
}

interface ProviderLaunchArtifacts {
  commandExecutable: string;
  commandArgs: string[];
  command: string;
  env: Record<string, string>;
  requiredEnvKeys: string[];
  codexConfig?: CodexConfigWritePlan;
}

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
    );
  }

  private buildPlan(
    profile: Profile,
    runtime: RuntimeSettings,
    _mappingsState?: ModelMappingsState,
    sessionId?: string,
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

    const artifacts = profile.provider === PROVIDER_CLAUDE
      ? this.buildClaudeArtifacts(profile, normalizedRuntime, normalizedSessionId, selectedModelId)
      : this.buildCodexArtifacts(profile, normalizedRuntime, normalizedSessionId, selectedModelId);
    const env = this.mergeInjectedEnv(artifacts.env);

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
    };
  }

  private buildClaudeArtifacts(
    profile: Profile,
    runtime: RuntimeSettings,
    sessionId: string,
    selectedModelId: string,
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
      settingSources: this.getParameterSettings().cli_settings.claude.setting_sources,
      model: selectedModelId || undefined,
    });
    const command = buildClaudeCommand({
      commandBase,
      launchMode,
      extraArgs: this.getCombinedExtraArgs(runtime),
      sessionId,
      excludeUserSettings: runtime.exclude_user_settings,
      settingsFile: runtime.settings_file,
      settingSources: this.getParameterSettings().cli_settings.claude.setting_sources,
      model: selectedModelId || undefined,
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
      if (advancedClaude?.defaultTarget?.trim()) env.ANTHROPIC_MODEL = advancedClaude.defaultTarget.trim();
      if (advancedClaude?.opusTarget?.trim()) env.ANTHROPIC_DEFAULT_OPUS_MODEL = advancedClaude.opusTarget.trim();
      if (advancedClaude?.sonnetTarget?.trim()) env.ANTHROPIC_DEFAULT_SONNET_MODEL = advancedClaude.sonnetTarget.trim();
      if (advancedClaude?.haikuTarget?.trim()) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = advancedClaude.haikuTarget.trim();
      if (advancedClaude?.subagentTarget?.trim()) env.CLAUDE_CODE_SUBAGENT_MODEL = advancedClaude.subagentTarget.trim();
    }

    return {
      commandExecutable: commandBase,
      commandArgs: args,
      command,
      env,
      requiredEnvKeys: ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN"],
    };
  }

  private buildCodexArtifacts(
    profile: Profile,
    runtime: RuntimeSettings,
    sessionId: string,
    selectedModelId: string,
  ): ProviderLaunchArtifacts {
    const advancedOverride = profile.advancedModelMapping?.enabled
      ? profile.advancedModelMapping.codex?.commandLineModelOverride?.trim() ?? ""
      : "";
    const apiKeyEnv = "CODEX_SITE_API_KEY";
    const providerId = "current_site";
    const providerName = `${profile.name} Site`;
    const profilePath = this.toDisplayPath(
      path.join(this.options.codexProfilesRoot, this.sanitizeProfileKey(itemKey(profile))),
    );
    const extraArgs = advancedOverride
      ? `${this.getCombinedExtraArgs(runtime)} --model ${JSON.stringify(advancedOverride)}`.trim()
      : this.getCombinedExtraArgs(runtime);
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
        content: this.buildCodexConfigContent({
          providerId,
          providerName,
          baseUrl: profile.url,
          apiKeyEnv,
          targetModel: selectedModelId,
        }),
        baseUrl: profile.url,
        providerId,
        providerName,
        apiKeyEnv,
        targetModel: selectedModelId,
      },
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

  private mergeInjectedEnv(providerEnv: Record<string, string>): Record<string, string> {
    const extraEnv = this.getParameterSettings().extra_env ?? {};
    const normalizedExtraEnv = Object.fromEntries(
      Object.entries(extraEnv)
        .map(([key, value]) => [key.trim(), value] as const)
        .filter(([key]) => key.length > 0),
    );
    return {
      ...normalizedExtraEnv,
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
    };
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
    };
  }

  private sanitizeProfileKey(profileKey: string): string {
    return profileKey.replaceAll("::", "__").replace(/[^a-zA-Z0-9_-]+/g, "_");
  }

  private toDisplayPath(targetPath: string): string {
    return targetPath.replace(/\\/g, "/");
  }

  private buildCodexConfigContent(options: {
    providerId: string;
    providerName: string;
    baseUrl: string;
    apiKeyEnv: string;
    targetModel: string;
  }): string {
    const targetModel = options.targetModel.trim();
    const topLevelLines = targetModel
      ? [
          `model = ${JSON.stringify(targetModel)}`,
          `model_provider = ${JSON.stringify(options.providerId)}`,
          "",
        ]
      : [];
    return [
      ...topLevelLines,
      `[model_providers.${options.providerId}]`,
      `name = ${JSON.stringify(options.providerName)}`,
      `base_url = ${JSON.stringify(options.baseUrl)}`,
      `env_key = ${JSON.stringify(options.apiKeyEnv)}`,
      'wire_api = "responses"',
      "",
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
