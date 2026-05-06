import { describe, expect, it } from "vitest";
import {
  defaultProfilePermissions,
  normalizeProfilePermissions,
  resolveEffectivePermissions,
  toClaudePermissionMode,
  toCodexPermissionConfig,
} from "../../profile/permissions.js";
import { defaultGlobalSettings, normalizeGlobalSettings, type GlobalSettings } from "../../profile/types.js";

describe("profile permissions", () => {
  it("should migrate legacy Chinese global permission presets to the new structure", () => {
    const normalized = normalizeGlobalSettings({
      ...defaultGlobalSettings(),
      permissions_preset: "全部允许（推荐）",
      permissions: undefined,
    } as GlobalSettings & { permissions_preset: string });

    expect(normalized.permissions?.preset).toBe("safe");
    expect("permissions_preset" in normalized).toBe(false);
  });

  it("should normalize missing profile permissions to provider defaults", () => {
    const normalized = normalizeProfilePermissions(undefined, "codex");

    expect(normalized).toEqual(defaultProfilePermissions("codex"));
    expect(normalized.common.denyEnvFiles).toBe(true);
    expect(normalized.common.allowNetwork).toBe(true);
  });

  it("should resolve permissions using temporary override before profile and global settings", () => {
    const globalPermissions = normalizeProfilePermissions({ preset: "safe" }, "claude");
    const profilePermissions = normalizeProfilePermissions({ preset: "auto_edit" }, "claude");

    expect(resolveEffectivePermissions({ provider: "claude", globalPermissions }).preset).toBe("safe");
    expect(resolveEffectivePermissions({ provider: "claude", globalPermissions, profilePermissions }).preset).toBe("auto_edit");
    expect(resolveEffectivePermissions({
      provider: "claude",
      globalPermissions,
      profilePermissions,
      temporaryPreset: "readonly",
    }).preset).toBe("readonly");
  });

  it("should map all presets to Claude permission modes", () => {
    expect(toClaudePermissionMode("readonly")).toBe("plan");
    expect(toClaudePermissionMode("safe")).toBe("default");
    expect(toClaudePermissionMode("auto_edit")).toBe("acceptEdits");
    expect(toClaudePermissionMode("strict_whitelist")).toBe("dontAsk");
    expect(toClaudePermissionMode("full_access")).toBe("bypassPermissions");
  });

  it("should map all presets to Codex sandbox and approval policies", () => {
    expect(toCodexPermissionConfig("readonly")).toMatchObject({ sandboxMode: "read-only", approvalPolicy: "on-request" });
    expect(toCodexPermissionConfig("safe")).toMatchObject({ sandboxMode: "workspace-write", approvalPolicy: "on-request" });
    expect(toCodexPermissionConfig("auto_edit")).toMatchObject({ sandboxMode: "workspace-write", approvalPolicy: "untrusted" });
    expect(toCodexPermissionConfig("strict_whitelist")).toMatchObject({ sandboxMode: "read-only", approvalPolicy: "never" });
    expect(toCodexPermissionConfig("full_access")).toMatchObject({ sandboxMode: "danger-full-access", approvalPolicy: "never" });
  });
});
