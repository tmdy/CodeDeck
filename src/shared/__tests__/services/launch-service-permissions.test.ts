import { describe, expect, it } from "vitest";
import { LaunchService } from "../../services/launch-service.js";
import { ProfileService, type LocalStateAccessor } from "../../services/profile-service.js";
import { defaultLocalState, type LocalState } from "../../state/local-state.js";
import { cloneLocalState } from "../../state/store.js";
import type { Profile, RuntimeSettings } from "../../profile/types.js";
import { itemKey } from "../../profile/keys-internal.js";
import { createDefaultModelMappingsState } from "../../model-mapping/config-types.js";

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

function makeLaunchService(profile: Profile, state?: Partial<LocalState>): LaunchService {
  const service = new ProfileService([profile], new MemoryStateAccessor(state));
  return new LaunchService(service, {
    getModelMappingsState: () => createDefaultModelMappingsState(),
    codexProfilesRoot: "C:/tmp/codex-profiles",
  });
}

describe("LaunchService permissions", () => {
  it("should add Claude permission modes for every preset", () => {
    const presets = [
      ["readonly", "plan"],
      ["safe", "default"],
      ["auto_edit", "acceptEdits"],
      ["strict_whitelist", "dontAsk"],
      ["full_access", "bypassPermissions"],
    ] as const;

    for (const [preset, mode] of presets) {
      const profile: Profile = {
        provider: "claude",
        name: `Claude ${preset}`,
        url: "https://api.anthropic.com",
        key: "sk-ant",
        permissions: { preset, fullAccessConfirmed: preset === "full_access" },
      };
      const plan = makeLaunchService(profile).buildExecutionPlan({
        profile_key: itemKey(profile),
        provider: "claude",
        runtime_settings: makeRuntime(),
      });

      expect(plan.valid).toBe(true);
      expect(plan.commandArgs).toEqual(expect.arrayContaining(["--permission-mode", mode]));
      expect(plan.permissionSummary).toBe(`Claude: ${mode}`);
    }
  });

  it("should reject unconfirmed full_access launches", () => {
    const profile: Profile = {
      provider: "codex",
      name: "Danger",
      url: "https://api.openai.com/v1",
      key: "sk-openai",
      permissions: { preset: "full_access" },
    };

    const plan = makeLaunchService(profile).buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "codex",
      runtime_settings: makeRuntime({ command_base: "codex" }),
    });

    expect(plan.valid).toBe(false);
    expect(plan.error).toContain("全权限");
  });

  it("should write Codex sandbox, approvals, network, writable roots and web search settings", () => {
    const profile: Profile = {
      provider: "codex",
      name: "Codex Safe",
      url: "https://api.openai.com/v1",
      key: "sk-openai",
      selectedModelId: "gpt-5.4",
      permissions: {
        preset: "safe",
        common: {
          allowNetwork: false,
          additionalWritableRoots: ["C:/shared", ""],
        },
      },
    };

    const plan = makeLaunchService(profile).buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "codex",
      runtime_settings: makeRuntime({ command_base: "codex" }),
    });

    expect(plan.valid).toBe(true);
    expect(plan.permissionSummary).toBe("Codex: workspace-write + on-request");
    expect(plan.codexConfig?.content).toContain('sandbox_mode = "workspace-write"');
    expect(plan.codexConfig?.content).toContain('approval_policy = "on-request"');
    expect(plan.codexConfig?.content).toContain("web_search = false");
    expect(plan.codexConfig?.content).toContain("[sandbox_workspace_write]");
    expect(plan.codexConfig?.content).toContain("network_access = false");
    expect(plan.codexConfig?.content).toContain('writable_roots = ["C:/shared"]');
  });

  it("should let a temporary readonly override beat profile and global permissions", () => {
    const profile: Profile = {
      provider: "codex",
      name: "Codex Auto",
      url: "https://api.openai.com/v1",
      key: "sk-openai",
      permissions: { preset: "auto_edit" },
    };

    const plan = makeLaunchService(profile).buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "codex",
      runtime_settings: makeRuntime({ command_base: "codex" }),
      permission_override: "readonly",
    });

    expect(plan.valid).toBe(true);
    expect(plan.codexConfig?.content).toContain('sandbox_mode = "read-only"');
    expect(plan.codexConfig?.content).toContain('approval_policy = "on-request"');
  });
});
