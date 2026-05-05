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
    expect(preview.command).toBe('claude --setting-sources "project,local" --model deepseek-v4-pro');
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
      'claude-dev --setting-sources "project,local" --settings "C:/Users/test/My Claude/settings.json" --resume "session-123" --model kimi-k2',
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
    expect(preview.command).toBe("cc");
    expect(preview.cwd).toBe("C:/workspace/current-project");
    expect(preview.command).not.toContain("--model");
    expect(preview.env).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "CODEX_HOME",
          displayValue: "C:/workspace/app-data/codex-profiles/codex__GLM",
        }),
        expect.objectContaining({
          name: "CODEX_SITE_API_KEY",
          displayValue: "[已设置]",
          sensitive: true,
        }),
      ]),
    );
    expect(plan.codexConfig?.content).toContain('base_url = "https://open.bigmodel.cn/api/paas/v4"');
    expect(plan.codexConfig?.content).toContain('model = "glm-4.6"');
    expect(plan.env.CODEX_HOME).toBe("C:/workspace/app-data/codex-profiles/codex__GLM");
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
    expect(plan.command).toBe("codex --model gpt-5.5");
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
    expect(plan.command).toBe('claude --setting-sources "project,local"');
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
    expect(plan.command).toBe("codex");
    expect(plan.commandArgs).not.toContain("--model");
    expect(plan.codexConfig?.content).toContain('base_url = "https://api.openai.com/v1"');
    expect(plan.codexConfig?.content).not.toContain("model =");
    expect(plan.codexConfig?.content).not.toContain("model_provider =");
    expect(plan.codexConfig?.targetModel).toBe("");
  });
});
