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
  const { extra_env: extraEnv, ...rest } = overrides;
  return {
    cwd: "C:/workspace/current-project",
    command_base: "claude",
    model: "",
    settings_file: "",
    launch_mode: "new",
    extra_args: "",
    extra_env: extraEnv ?? {},
    exclude_user_settings: true,
    ...rest,
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
    const modes = [
      ["readonly", "plan"],
      ["safe", "manual"],
      ["auto_edit", "acceptEdits"],
      ["strict_whitelist", "dontAsk"],
      ["full_access", "bypassPermissions"],
    ] as const;

    for (const [name, mode] of modes) {
      const profile: Profile = {
        provider: "claude",
        name: `Claude ${name}`,
        url: "https://api.anthropic.com",
        key: "sk-ant",
        permissions: { mode, fullAccessConfirmed: mode === "bypassPermissions" },
      };
      const plan = makeLaunchService(profile).buildExecutionPlan({
        profile_key: itemKey(profile),
        provider: "claude",
        runtime_settings: makeRuntime(),
      });

      expect(plan.valid).toBe(true);
      expect(plan.commandArgs).toEqual(expect.arrayContaining(["--permission-mode", mode]));
      expect(plan.permissionSummary).toBe(`Claude: --permission-mode ${mode}`);
    }
  });

  it("should reject unconfirmed full_access launches", () => {
    const profile: Profile = {
      provider: "codex",
      name: "Danger",
      url: "https://api.openai.com/v1",
      key: "sk-openai",
      permissions: { sandboxMode: "danger-full-access", approvalPolicy: "never" },
    };

    const plan = makeLaunchService(profile).buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "codex",
      runtime_settings: makeRuntime({ command_base: "codex" }),
    });

    expect(plan.valid).toBe(false);
    expect(plan.error).toContain("全权限");
  });

  it("should apply temporary readonly and full_access overrides for Claude launches", () => {
    const profile: Profile = {
      provider: "claude",
      name: "Claude Temporary",
      url: "https://api.anthropic.com",
      key: "sk-ant",
      permissions: { mode: "acceptEdits" },
    };
    const service = makeLaunchService(profile);

    const readonlyPlan = service.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "claude",
      runtime_settings: makeRuntime(),
      permission_override: "readonly",
    });
    const fullAccessPlan = service.buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "claude",
      runtime_settings: makeRuntime(),
      permission_override: "full_access",
    });

    expect(readonlyPlan.valid).toBe(true);
    expect(readonlyPlan.commandArgs).toEqual(expect.arrayContaining(["--permission-mode", "plan"]));
    expect(readonlyPlan.permissionSummary).toBe("Claude: --permission-mode plan");
    expect(fullAccessPlan.valid).toBe(true);
    expect(fullAccessPlan.commandArgs).toEqual(expect.arrayContaining(["--permission-mode", "bypassPermissions"]));
    expect(fullAccessPlan.permissionSummary).toBe("Claude: --permission-mode bypassPermissions");
  });

  it("should write Codex sandbox, approvals, network, writable roots and web search settings", () => {
    const profile: Profile = {
      provider: "codex",
      name: "Codex Safe",
      url: "https://api.openai.com/v1",
      key: "sk-openai",
      selectedModelId: "gpt-5.4",
      permissions: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
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
    expect(plan.permissionSummary).toBe("Codex: sandbox_mode=workspace-write; approval_policy=on-request");
    expect(plan.codexConfig?.content).toContain('sandbox_mode = "workspace-write"');
    expect(plan.codexConfig?.content).toContain('approval_policy = "on-request"');
    expect(plan.codexConfig?.content).toContain('web_search = "disabled"');
    expect(plan.codexConfig?.content).toContain("[windows]");
    expect(plan.codexConfig?.content).toContain('sandbox = "elevated"');
    expect(plan.codexConfig?.content).toContain("[sandbox_workspace_write]");
    expect(plan.codexConfig?.content).toContain("network_access = false");
    expect(plan.codexConfig?.content).toContain('writable_roots = ["C:/shared"]');
  });

  it("should apply temporary full_access overrides for Codex launches", () => {
    const profile: Profile = {
      provider: "codex",
      name: "Codex Temporary",
      url: "https://api.openai.com/v1",
      key: "sk-openai",
      permissions: { sandboxMode: "workspace-write", approvalPolicy: "untrusted" },
    };

    const plan = makeLaunchService(profile).buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "codex",
      runtime_settings: makeRuntime({ command_base: "codex" }),
      permission_override: "full_access",
    });

    expect(plan.valid).toBe(true);
    expect(plan.permissionSummary).toBe("Codex: sandbox_mode=danger-full-access; approval_policy=never");
    expect(plan.commandArgs).toEqual(expect.arrayContaining([
      "--sandbox",
      "danger-full-access",
      "--ask-for-approval",
      "never",
    ]));
    expect(plan.codexConfig?.content).toContain('sandbox_mode = "danger-full-access"');
    expect(plan.codexConfig?.content).toContain('approval_policy = "never"');
  });

  it("should add managed Claude settings for common protection switches", () => {
    const profile: Profile = {
      provider: "claude",
      name: "Claude Guarded",
      url: "https://api.anthropic.com",
      key: "sk-ant",
      permissions: {
        mode: "manual",
        common: {
          denyEnvFiles: true,
          denyGitPush: true,
          denyDangerousDelete: true,
          allowNetwork: false,
          additionalWritableRoots: ["C:/shared", ""],
        },
      },
    };

    const plan = makeLaunchService(profile).buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "claude",
      runtime_settings: makeRuntime(),
    });
    const settings = JSON.parse(plan.claudeSettings?.content ?? "{}") as {
      permissions?: {
        deny?: string[];
        additionalDirectories?: string[];
      };
      sandbox?: {
        filesystem?: {
          allowWrite?: string[];
        };
        network?: {
          deniedDomains?: string[];
        };
      };
    };

    expect(plan.valid).toBe(true);
    expect(plan.claudeSettings?.settingsPath).toMatch(/claude-runtime\/permissions\/claude-permissions-[a-f0-9]{16}\.json$/);
    expect(plan.commandArgs).toEqual(expect.arrayContaining(["--settings", plan.claudeSettings?.settingsPath]));
    expect(settings.permissions?.deny).toEqual(expect.arrayContaining([
      "Read(./.env)",
      "Read(./.env.*)",
      "Bash(git push *)",
      "PowerShell(git push *)",
      "Bash(rm -rf *)",
      "PowerShell(Remove-Item -Recurse *)",
      "WebFetch",
      "PowerShell(Invoke-WebRequest *)",
    ]));
    expect(settings.permissions?.additionalDirectories).toEqual(["C:/shared"]);
    expect(settings.sandbox?.filesystem?.allowWrite).toEqual(["C:/shared"]);
    expect(settings.sandbox?.network?.deniedDomains).toEqual(["*"]);
  });

  it("should add Codex managed rules and shell environment policy for common protection switches", () => {
    const profile: Profile = {
      provider: "codex",
      name: "Codex Guarded",
      url: "https://api.openai.com/v1",
      key: "sk-openai",
      permissions: {
        sandboxMode: "workspace-write",
        approvalPolicy: "on-request",
        common: {
          denyEnvFiles: true,
          denyGitPush: true,
          denyDangerousDelete: true,
          allowNetwork: true,
          additionalWritableRoots: [],
        },
      },
    };

    const plan = makeLaunchService(profile).buildExecutionPlan({
      profile_key: itemKey(profile),
      provider: "codex",
      runtime_settings: makeRuntime({ command_base: "codex" }),
    });

    expect(plan.valid).toBe(true);
    expect(plan.codexConfig?.rulesContent).toContain('pattern = ["git", "push"]');
    expect(plan.codexConfig?.rulesContent).toContain('decision = "forbidden"');
    expect(plan.codexConfig?.rulesContent).toContain('pattern = ["rm", "-rf"]');
    expect(plan.codexConfig?.rulesContent).toContain('pattern = ["Remove-Item", "-Recurse"]');
    expect(plan.codexConfig?.content).toContain("[shell_environment_policy]");
    expect(plan.codexConfig?.content).toContain('exclude = ["*KEY*", "*TOKEN*", "*SECRET*", "*PASSWORD*", "CODEX_SITE_API_KEY_*"]');
  });

  it("should let a temporary readonly override beat profile and global permissions", () => {
    const profile: Profile = {
      provider: "codex",
      name: "Codex Auto",
      url: "https://api.openai.com/v1",
      key: "sk-openai",
      permissions: { sandboxMode: "workspace-write", approvalPolicy: "untrusted" },
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
    expect(plan.codexConfig?.content).toContain('web_search = "live"');
  });
});
