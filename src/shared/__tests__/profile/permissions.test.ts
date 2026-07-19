import { describe, expect, it } from "vitest";
import {
  defaultProfilePermissions,
  normalizeGlobalPermissions,
  normalizeProfilePermissions,
  resolveEffectivePermissions,
  toClaudePermissionMode,
  toCodexPermissionConfig,
} from "../../profile/permissions.js";
import { defaultGlobalSettings, normalizeGlobalSettings } from "../../profile/types.js";

describe("profile permissions", () => {
  it("should reset legacy Chinese global permission presets to provider-specific safe defaults", () => {
    const normalized = normalizeGlobalSettings({
      ...defaultGlobalSettings(),
      permissions_preset: "全部允许（推荐）",
      permissions: undefined,
    });

    expect(normalized.permissions?.claude.mode).toBe("manual");
    expect(normalized.permissions?.codex).toMatchObject({
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
    });
    expect("permissions_preset" in normalized).toBe(false);
  });

  it("should normalize missing profile permissions to provider-specific safe defaults", () => {
    const claude = normalizeProfilePermissions(undefined, "claude");
    const codex = normalizeProfilePermissions(undefined, "codex");

    expect(claude).toEqual(defaultProfilePermissions("claude"));
    expect(claude).toMatchObject({ provider: "claude", mode: "manual" });
    expect(codex).toEqual(defaultProfilePermissions("codex"));
    expect(codex).toMatchObject({
      provider: "codex",
      sandboxMode: "workspace-write",
      approvalPolicy: "on-request",
    });
    expect(codex.common.denyEnvFiles).toBe(true);
    expect(codex.common.denyGitPush).toBe(true);
    expect(codex.common.denyDangerousDelete).toBe(true);
    expect(codex.common.allowNetwork).toBe(true);
  });

  it("should resolve permissions using temporary override before profile and provider-specific global settings", () => {
    const globalPermissions = normalizeGlobalPermissions({
      claude: { mode: "plan" },
      codex: { sandboxMode: "workspace-write", approvalPolicy: "never" },
    });
    const profilePermissions = normalizeProfilePermissions({ mode: "acceptEdits" }, "claude");

    expect(resolveEffectivePermissions({ provider: "claude", globalPermissions })).toMatchObject({ mode: "plan" });
    expect(resolveEffectivePermissions({ provider: "claude", globalPermissions, profilePermissions })).toMatchObject({ mode: "acceptEdits" });
    expect(resolveEffectivePermissions({
      provider: "claude",
      globalPermissions,
      profilePermissions,
      temporaryPreset: "readonly",
    })).toMatchObject({ mode: "plan" });
  });

  it("should map provider-specific Claude permissions to CLI permission modes", () => {
    expect(toClaudePermissionMode(normalizeProfilePermissions({ mode: "plan" }, "claude"))).toBe("plan");
    expect(toClaudePermissionMode(normalizeProfilePermissions({ mode: "manual" }, "claude"))).toBe("manual");
    expect(toClaudePermissionMode(normalizeProfilePermissions({ mode: "acceptEdits" }, "claude"))).toBe("acceptEdits");
    expect(toClaudePermissionMode(normalizeProfilePermissions({ mode: "dontAsk" }, "claude"))).toBe("dontAsk");
    expect(toClaudePermissionMode(normalizeProfilePermissions({ mode: "bypassPermissions" }, "claude"))).toBe("bypassPermissions");
  });

  it("should preserve provider-specific Codex sandbox and approval policies", () => {
    expect(toCodexPermissionConfig(normalizeProfilePermissions({ sandboxMode: "read-only", approvalPolicy: "on-request" }, "codex"))).toMatchObject({ sandboxMode: "read-only", approvalPolicy: "on-request" });
    expect(toCodexPermissionConfig(normalizeProfilePermissions({ sandboxMode: "workspace-write", approvalPolicy: "on-request" }, "codex"))).toMatchObject({ sandboxMode: "workspace-write", approvalPolicy: "on-request" });
    expect(toCodexPermissionConfig(normalizeProfilePermissions({ sandboxMode: "workspace-write", approvalPolicy: "untrusted" }, "codex"))).toMatchObject({ sandboxMode: "workspace-write", approvalPolicy: "untrusted" });
    expect(toCodexPermissionConfig(normalizeProfilePermissions({ sandboxMode: "workspace-write", approvalPolicy: "never" }, "codex"))).toMatchObject({ sandboxMode: "workspace-write", approvalPolicy: "never" });
    expect(toCodexPermissionConfig(normalizeProfilePermissions({ sandboxMode: "danger-full-access", approvalPolicy: "never" }, "codex"))).toMatchObject({ sandboxMode: "danger-full-access", approvalPolicy: "never" });
  });
});
