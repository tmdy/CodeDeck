import path from "node:path";
import { describe, expect, it } from "vitest";
import { LaunchService } from "../../services/launch-service.js";
import { ProfileService, type LocalStateAccessor } from "../../services/profile-service.js";
import { defaultLocalState, type LocalState } from "../../state/local-state.js";
import { cloneLocalState } from "../../state/store.js";
import type { Profile, RuntimeSettings } from "../../profile/types.js";
import { itemKey } from "../../profile/keys-internal.js";
import {
  createDefaultModelMappingsState,
  type ModelMappingsState,
} from "../../model-mapping/config-types.js";

class MemoryStateAccessor implements LocalStateAccessor {
  private state: LocalState;

  constructor(initial?: Partial<LocalState>) {
    this.state = { ...defaultLocalState(), ...initial };
  }

  get(): LocalState {
    return cloneLocalState(this.state);
  }

  async save(state: LocalState): Promise<void> {
    this.state = cloneLocalState(state);
  }
}

function makeRuntime(overrides: Partial<RuntimeSettings> = {}): RuntimeSettings {
  return {
    cwd: "C:/workspace/current-project",
    command_base: "claude",
    model: "",
    settings_file: "",
    launch_mode: "new",
    extra_args: "",
    exclude_user_settings: true,
    ...overrides,
    extra_env: overrides.extra_env ?? {},
  };
}

function makeMappings(): ModelMappingsState {
  return createDefaultModelMappingsState();
}

describe("LaunchService", () => {
  it("should launch Claude with the raw selectedModelId and custom model env vars by default", () => {
    const profile: Profile = {
      provider: "claude",
      name: "Official",
      url: "https://api.anthropic.com",
      key: "sk-ant",
      selectedModelId: "deepseek-v4-pro",
    };
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/tmp/codex-profiles",
    });

    const preview = launchService.buildPreview(profile, makeRuntime());

    expect(preview.valid).toBe(true);
    expect(preview.cwd).toBe("C:/workspace/current-project");
    expect(preview.command).toBe('claude --setting-sources "project,local" --model deepseek-v4-pro --permission-mode default');
    expect(preview.env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "ANTHROPIC_BASE_URL", displayValue: "https://api.anthropic.com" }),
        expect.objectContaining({ name: "ANTHROPIC_AUTH_TOKEN", displayValue: "[已设置]", sensitive: true }),
        expect.objectContaining({ name: "ANTHROPIC_MODEL", displayValue: "deepseek-v4-pro" }),
        expect.objectContaining({ name: "ANTHROPIC_CUSTOM_MODEL_OPTION", displayValue: "deepseek-v4-pro" }),
        expect.objectContaining({ name: "ANTHROPIC_CUSTOM_MODEL_OPTION_NAME", displayValue: "deepseek-v4-pro" }),
      ]),
    );
    expect(preview.env.some((item) => item.name === "ANTHROPIC_DEFAULT_SONNET_MODEL")).toBe(false);
    expect(preview.env.some((item) => item.name === "ANTHROPIC_DEFAULT_OPUS_MODEL")).toBe(false);
    expect(preview.env.some((item) => item.name === "ANTHROPIC_DEFAULT_HAIKU_MODEL")).toBe(false);
    expect(preview.env.some((item) => item.name === "CLAUDE_CODE_SUBAGENT_MODEL")).toBe(false);
    expect(preview.env.some((item) => item.name === "CLAUDE_CODE_EFFORT_LEVEL")).toBe(false);
  });

  it("should merge global and profile runtime env for Claude while keeping provider env authoritative", () => {
    const profile: Profile = {
      provider: "claude",
      name: "Official",
      url: "https://api.anthropic.com",
      key: "sk-ant",
      selectedModelId: "claude-sonnet-4-5",
    };
    const service = new ProfileService([profile], new MemoryStateAccessor({
      parameter_settings: {
        ...defaultLocalState().parameter_settings,
        extra_env: {
          GLOBAL_ONLY: "global",
          SHARED_ENV: "global-value",
          ANTHROPIC_MODEL: "global-model",
        },
      },
    }));
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/tmp/codex-profiles",
    });

    const plan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "claude",
      runtime_settings: makeRuntime({
        extra_env: {
          PROFILE_ONLY: "profile",
          SHARED_ENV: "profile-value",
          ANTHROPIC_MODEL: "profile-model",
          ANTHROPIC_AUTH_TOKEN: "profile-token",
        },
      }),
    });

    expect(plan.valid).toBe(true);
    expect(plan.env.GLOBAL_ONLY).toBe("global");
    expect(plan.env.PROFILE_ONLY).toBe("profile");
    expect(plan.env.SHARED_ENV).toBe("profile-value");
    expect(plan.env.ANTHROPIC_MODEL).toBe("claude-sonnet-4-5");
    expect(plan.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-ant");
  });

  it("should allow Claude effort level through profile runtime env", () => {
    const profile: Profile = {
      provider: "claude",
      name: "DeepSeek Pro",
      url: "https://api.deepseek.com/anthropic",
      key: "sk-ds",
      selectedModelId: "deepseek-v4-pro[1m]",
    };
    const service = new ProfileService([profile], new MemoryStateAccessor({
      parameter_settings: {
        ...defaultLocalState().parameter_settings,
        extra_env: {
          CLAUDE_CODE_EFFORT_LEVEL: "high",
        },
      },
    }));
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/tmp/codex-profiles",
    });

    const plan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "claude",
      runtime_settings: makeRuntime({
        extra_env: {
          CLAUDE_CODE_EFFORT_LEVEL: "max",
        },
      }),
    });

    expect(plan.valid).toBe(true);
    expect(plan.env.CLAUDE_CODE_EFFORT_LEVEL).toBe("max");
    expect(plan.env.ANTHROPIC_MODEL).toBe("deepseek-v4-pro[1m]");
  });

  it("should ignore legacy DeepSeek reasoning effort fields instead of injecting effort env", () => {
    const profile = {
      provider: "claude",
      name: "DeepSeek Pro",
      url: "https://api.deepseek.com/anthropic",
      key: "sk-ds",
      selectedModelId: "deepseek-v4-pro",
      advancedModelMapping: {
        enabled: false,
        claude: {
          deepseekReasoningEffort: "high",
        },
      },
    } as unknown as Profile;
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/tmp/codex-profiles",
    });

    const plan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "claude",
      runtime_settings: makeRuntime(),
    });

    expect(plan.valid).toBe(true);
    expect(plan.env.CLAUDE_CODE_EFFORT_LEVEL).toBeUndefined();
    expect(plan.env.ANTHROPIC_MODEL).toBe("deepseek-v4-pro");
  });

  it("should only inject Claude family alias mapping when the profile explicitly enables it", () => {
    const profile: Profile = {
      provider: "claude",
      name: "Moonshot",
      url: "https://api.moonshot.cn/anthropic",
      key: "sk-kimi",
      selectedModelId: "kimi-k2",
      advancedModelMapping: {
        enabled: true,
        claude: {
          defaultTarget: "kimi-k2",
          sonnetTarget: "kimi-k2-turbo-preview",
          opusTarget: "kimi-k2-opus",
          haikuTarget: "kimi-k2-haiku",
          subagentTarget: "kimi-k2-sub",
        },
      },
    };
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/tmp/codex-profiles",
    });

    const request = {
      profile_key: itemKey(profile),
      provider: "claude",
      runtime_settings: makeRuntime({
        command_base: "claude-dev",
        launch_mode: "resume_selected",
        settings_file: "C:/Users/test/My Claude/settings.json",
      }),
      session_id: "session-123",
      model_mappings_state: makeMappings(),
    } as const;
    const preview = launchService.buildPreview(
      profile,
      request.runtime_settings,
      request.model_mappings_state,
      request.session_id,
    );
    const plan = launchService.buildExecutionPlan(request);

    expect(preview.valid).toBe(true);
    expect(preview.command).toBe(
      'claude-dev --setting-sources "project,local" --settings "C:/Users/test/My Claude/settings.json" --resume "session-123" --model kimi-k2 --permission-mode default',
    );
    expect(preview.command).toBe(plan.command);
    expect(plan.valid).toBe(true);
    expect(plan.env.ANTHROPIC_BASE_URL).toBe("https://api.moonshot.cn/anthropic");
    expect(plan.env.ANTHROPIC_MODEL).toBe("kimi-k2");
    expect(plan.env.ANTHROPIC_CUSTOM_MODEL_OPTION).toBe("kimi-k2");
    expect(plan.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME).toBe("kimi-k2");
    expect(plan.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("kimi-k2-opus");
    expect(plan.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("kimi-k2-turbo-preview");
    expect(plan.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("kimi-k2-haiku");
    expect(plan.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("kimi-k2-sub");
    expect(plan.launchMode).toBe("resume_selected");
  });

  it("should inject all Claude aliases when single-model compatibility mode is enabled", () => {
    const profile: Profile = {
      provider: "claude",
      name: "GLM",
      url: "https://api.aicod.com",
      key: "sk-glm",
      selectedModelId: "glm-5.1",
      advancedModelMapping: {
        enabled: true,
        claude: {
          aliasMode: "single_model_compat",
        },
      },
    };
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/tmp/codex-profiles",
    });

    const plan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "claude",
      runtime_settings: makeRuntime({ command_base: "claude" }),
    });

    expect(plan.valid).toBe(true);
    expect(plan.command).toBe('claude --setting-sources "project,local" --model glm-5.1 --permission-mode default');
    expect(plan.commandArgs).toEqual([
      "--setting-sources",
      "project,local",
      "--model",
      "glm-5.1",
      "--permission-mode",
      "default",
    ]);
    expect(plan.env.ANTHROPIC_MODEL).toBe("glm-5.1");
    expect(plan.env.ANTHROPIC_CUSTOM_MODEL_OPTION).toBe("glm-5.1");
    expect(plan.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME).toBe("glm-5.1");
    expect(plan.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("glm-5.1");
    expect(plan.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("glm-5.1");
    expect(plan.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("glm-5.1");
    expect(plan.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("glm-5.1");
  });

  it("should include prepared Claude capability overlay arguments while excluding user settings", () => {
    const profile: Profile = {
      provider: "claude",
      name: "Overlay",
      url: "https://api.anthropic.com",
      key: "sk-ant",
      selectedModelId: "claude-sonnet-4-6",
    };
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/tmp/codex-profiles",
    });

    const plan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "claude",
      runtime_settings: makeRuntime({ settings_file: "C:/custom/settings.json" }),
      capability_overlay: {
        claude: {
          settingsFile: "C:/overlay/settings.global-capabilities.json",
          addDirs: ["C:/overlay/add-dir"],
          pluginDirs: ["C:/Users/test/.claude/plugins/cache/document-skills"],
          mcpConfigPaths: ["C:/overlay/mcp-config.json"],
        },
      },
    } as Parameters<LaunchService["buildExecutionPlan"]>[0]);

    expect(plan.valid).toBe(true);
    expect(plan.commandArgs.slice(0, 6)).toEqual([
      "--setting-sources",
      "project,local",
      "--settings",
      "C:/custom/settings.json",
      "--settings",
      "C:/overlay/settings.global-capabilities.json",
    ]);
    expect(plan.commandArgs).toEqual(expect.arrayContaining(["--add-dir", "C:/overlay/add-dir"]));
    expect(plan.commandArgs).toEqual(expect.arrayContaining(["--plugin-dir", "C:/Users/test/.claude/plugins/cache/document-skills"]));
    expect(plan.commandArgs.slice(-2)).toEqual(["--mcp-config", "C:/overlay/mcp-config.json"]);
    expect(plan.capabilitySummary).toBe("继承全局能力：MCP / Skills / Plugins");
  });

  it("should not inject Claude family aliases when alias mode is none", () => {
    const profile: Profile = {
      provider: "claude",
      name: "GLM",
      url: "https://api.aicod.com",
      key: "sk-glm",
      selectedModelId: "glm-5.1",
      advancedModelMapping: {
        enabled: true,
        claude: {
          aliasMode: "none",
        },
      },
    };
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/tmp/codex-profiles",
    });

    const plan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "claude",
      runtime_settings: makeRuntime({ command_base: "claude" }),
    });

    expect(plan.valid).toBe(true);
    expect(plan.env.ANTHROPIC_MODEL).toBe("glm-5.1");
    expect(plan.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
    expect(plan.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBeUndefined();
    expect(plan.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBeUndefined();
    expect(plan.env.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined();
  });

  it("should inject separately configured Claude aliases in custom mode", () => {
    const profile: Profile = {
      provider: "claude",
      name: "GLM",
      url: "https://api.aicod.com",
      key: "sk-glm",
      selectedModelId: "glm-5.1",
      advancedModelMapping: {
        enabled: true,
        claude: {
          aliasMode: "custom",
          opusTarget: "glm-5.1-opus",
          sonnetTarget: "glm-5.1-sonnet",
          haikuTarget: "glm-5.1-fast",
          subagentTarget: "glm-5.1-subagent",
        },
      },
    };
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/tmp/codex-profiles",
    });

    const plan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "claude",
      runtime_settings: makeRuntime({ command_base: "claude" }),
    });

    expect(plan.valid).toBe(true);
    expect(plan.env.ANTHROPIC_MODEL).toBe("glm-5.1");
    expect(plan.env.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe("glm-5.1-opus");
    expect(plan.env.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe("glm-5.1-sonnet");
    expect(plan.env.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("glm-5.1-fast");
    expect(plan.env.CLAUDE_CODE_SUBAGENT_MODEL).toBe("glm-5.1-subagent");
  });

  it("should build Codex config.toml from the raw selectedModelId without adding a model flag to the command", () => {
    const profile: Profile = {
      provider: "codex",
      name: "GLM",
      url: "https://open.bigmodel.cn/api/paas/v4",
      key: "sk-glm",
      selectedModelId: "glm-4.6",
    };
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/workspace/app-data/codex-profiles",
    });

    const preview = launchService.buildPreview(profile, makeRuntime({ command_base: "cc" }));
    const plan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "codex",
      runtime_settings: makeRuntime({ command_base: "cc" }),
    });

    expect(preview.valid).toBe(true);
    expect(preview.command).toBe("cc --profile site-a632b8ac583c81de");
    expect(preview.cwd).toBe("C:/workspace/current-project");
    expect(preview.command).not.toContain("--model");
    expect(preview.env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "CODEX_HOME",
          displayValue: "C:/workspace/app-data/codex-runtime/home",
        }),
        expect.objectContaining({
          name: "CODEX_SITE_API_KEY_A632B8AC583C81DE",
          displayValue: "[已设置]",
          sensitive: true,
        }),
      ]),
    );
    expect(plan.commandArgs).toEqual(["--profile", "site-a632b8ac583c81de"]);
    expect(plan.codexConfig?.content).toContain('model = "glm-4.6"');
    expect(plan.codexConfig?.content).toContain('base_url = "https://open.bigmodel.cn/api/paas/v4"');
    expect(plan.codexConfig?.content).toContain("[model_providers.site_provider_a632b8ac583c81de]");
    expect(plan.codexConfig?.content).not.toContain("[profiles.");
    expect(plan.codexConfig?.profileName).toBe("site-a632b8ac583c81de");
    expect(plan.env.CODEX_HOME).toBe("C:/workspace/app-data/codex-runtime/home");
    expect(plan.env.CODEX_SITE_API_KEY_A632B8AC583C81DE).toBe("sk-glm");
  });

  it("should pass explicit Codex CLI permission flags for full access profiles", () => {
    const profile: Profile = {
      provider: "codex",
      name: "Danger",
      url: "https://api.openai.com/v1",
      key: "sk-openai",
      selectedModelId: "gpt-5.5",
      permissions: {
        preset: "full_access",
        fullAccessConfirmed: true,
      },
    };
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/workspace/app-data/codex-profiles",
    });

    const plan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "codex",
      runtime_settings: makeRuntime({ command_base: "codex" }),
    });

    expect(plan.valid).toBe(true);
    expect(plan.commandArgs).toEqual([
      "--profile",
      "site-0fa7d5b4930bc063",
      "--sandbox",
      "danger-full-access",
      "--ask-for-approval",
      "never",
    ]);
    expect(plan.command).toBe("codex --profile site-0fa7d5b4930bc063 --sandbox danger-full-access --ask-for-approval never");
  });

  it("should merge profile runtime env for Codex without overriding generated Codex env", () => {
    const profile: Profile = {
      provider: "codex",
      name: "GLM",
      url: "https://open.bigmodel.cn/api/paas/v4",
      key: "sk-glm",
      selectedModelId: "glm-4.6",
    };
    const service = new ProfileService([profile], new MemoryStateAccessor({
      parameter_settings: {
        ...defaultLocalState().parameter_settings,
        extra_env: {
          SHARED_ENV: "global-value",
          CODEX_HOME: "C:/global-codex-home",
        },
      },
    }));
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/workspace/app-data/codex-profiles",
    });
    const apiKeyEnv = "CODEX_SITE_API_KEY_A632B8AC583C81DE";

    const plan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "codex",
      runtime_settings: makeRuntime({
        command_base: "codex",
        extra_env: {
          PROFILE_ONLY: "profile",
          SHARED_ENV: "profile-value",
          CODEX_HOME: "C:/profile-codex-home",
          [apiKeyEnv]: "profile-key",
        },
      }),
    });

    expect(plan.valid).toBe(true);
    expect(plan.env.PROFILE_ONLY).toBe("profile");
    expect(plan.env.SHARED_ENV).toBe("profile-value");
    expect(plan.env.CODEX_HOME).toBe("C:/workspace/app-data/codex-runtime/home");
    expect(plan.env[apiKeyEnv]).toBe("sk-glm");
  });

  it("should allow an explicit Codex command-line model override only in advanced mapping mode", () => {
    const profile: Profile = {
      provider: "codex",
      name: "Kimi",
      url: "https://api.moonshot.cn/v1",
      key: "sk-kimi",
      selectedModelId: "kimi-k2-0711-preview",
      advancedModelMapping: {
        enabled: true,
        codex: {
          commandLineModelOverride: "gpt-5.5",
        },
      },
    };
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: path.join("C:/workspace", "app-data", "codex-profiles"),
    });

    const plan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "codex",
      runtime_settings: makeRuntime({ command_base: "codex" }),
    });

    expect(plan.valid).toBe(true);
    expect(plan.codexConfig?.content).toContain('model = "kimi-k2-0711-preview"');
    expect(plan.command).toBe("codex --profile site-39b645351a70122a --model gpt-5.5");
  });

  it("should keep Codex resume modes while applying the site profile", () => {
    const profile: Profile = {
      provider: "codex",
      name: "GLM",
      url: "https://open.bigmodel.cn/api/paas/v4",
      key: "sk-glm",
      selectedModelId: "glm-4.6",
    };
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/workspace/app-data/codex-profiles",
    });

    const continuePlan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "codex",
      runtime_settings: makeRuntime({ command_base: "codex", launch_mode: "continue_last" }),
    });
    const selectedPlan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "codex",
      runtime_settings: makeRuntime({ command_base: "codex", launch_mode: "resume_selected" }),
      session_id: "019df0ff-0001",
    });

    expect(continuePlan.command).toBe("codex resume --last --profile site-a632b8ac583c81de");
    expect(selectedPlan.command).toBe('codex resume "019df0ff-0001" --profile site-a632b8ac583c81de');
  });

  it("should mark preview invalid when cwd is missing", () => {
    const profile: Profile = {
      provider: "claude",
      name: "Official",
      url: "https://api.anthropic.com",
      key: "sk-ant",
      selectedModelId: "claude-sonnet-4-5",
    };
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/tmp/codex-profiles",
    });

    const preview = launchService.buildPreview(profile, makeRuntime({ cwd: "" }));

    expect(preview.valid).toBe(false);
    expect(preview.error).toBe("工作目录不存在，请先设置有效的工作目录。");
  });

  it("should reject resume_selected when session_id is missing", () => {
    const profile: Profile = {
      provider: "claude",
      name: "Official",
      url: "https://api.anthropic.com",
      key: "sk-ant",
      selectedModelId: "claude-sonnet-4-5",
    };
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/tmp/codex-profiles",
    });

    const plan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "claude",
      runtime_settings: makeRuntime({ launch_mode: "resume_selected" }),
    });

    expect(plan.valid).toBe(false);
    expect(plan.error).toBe("恢复指定会话时必须提供 sessionId。");
  });

  it("should launch Claude without model arguments when selected model id is empty", () => {
    const profile: Profile = {
      provider: "claude",
      name: "Official",
      url: "https://api.anthropic.com",
      key: "sk-ant",
      selectedModelId: "",
    };
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/tmp/codex-profiles",
    });

    const plan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "claude",
      runtime_settings: makeRuntime(),
    });

    expect(plan.valid).toBe(true);
    expect(plan.command).toBe('claude --setting-sources "project,local" --permission-mode default');
    expect(plan.commandArgs).not.toContain("--model");
    expect(plan.env.ANTHROPIC_BASE_URL).toBe("https://api.anthropic.com");
    expect(plan.env.ANTHROPIC_AUTH_TOKEN).toBe("sk-ant");
    expect(plan.env.ANTHROPIC_MODEL).toBeUndefined();
    expect(plan.env.ANTHROPIC_CUSTOM_MODEL_OPTION).toBeUndefined();
    expect(plan.env.ANTHROPIC_CUSTOM_MODEL_OPTION_NAME).toBeUndefined();
  });

  it("should launch Codex without model config when selected model id is empty", () => {
    const profile: Profile = {
      provider: "codex",
      name: "Official",
      url: "https://api.openai.com/v1",
      key: "sk-openai",
      selectedModelId: "",
    };
    const service = new ProfileService([profile], new MemoryStateAccessor());
    const launchService = new LaunchService(service, {
      getModelMappingsState: () => makeMappings(),
      codexProfilesRoot: "C:/tmp/codex-profiles",
    });

    const plan = launchService.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "codex",
      runtime_settings: makeRuntime({ command_base: "codex" }),
    });

    expect(plan.valid).toBe(true);
    expect(plan.command).toBe("codex --profile site-2badb974b243c949");
    expect(plan.commandArgs).not.toContain("--model");
    expect(plan.codexConfig?.content).toContain('base_url = "https://api.openai.com/v1"');
    expect(plan.codexConfig?.content).not.toContain("model =");
    expect(plan.codexConfig?.content).not.toContain("model_provider =");
    expect(plan.codexConfig?.content).not.toContain("[profiles.");
    expect(plan.codexConfig?.targetModel).toBe("");
  });
});
