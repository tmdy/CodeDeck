// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProfileEditForm } from "../../../components/profiles/ProfileEditForm.jsx";
import { defaultProfilePermissions } from "../../profile/permissions.js";
import type { AdvancedModelMapping } from "../../profile/types.js";

const renderCounts = vi.hoisted(() => ({
  glassCardByTitle: new Map<string, number>(),
  permissionSettingsCard: 0,
}));

vi.mock("../../../components/common/GlassCard.jsx", () => ({
  GlassCard: ({ title, children }: { title: string; children: React.ReactNode }) => {
    renderCounts.glassCardByTitle.set(title, (renderCounts.glassCardByTitle.get(title) ?? 0) + 1);
    return <section data-testid={`glass-card-${title}`}>{children}</section>;
  },
}));

vi.mock("../../../components/permissions/PermissionSettingsCard.jsx", () => ({
  PermissionSettingsCard: () => {
    renderCounts.permissionSettingsCard += 1;
    return <section data-testid="permission-settings-card" />;
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ProfileEditForm rendering", () => {
  function makeAdvancedMapping(): AdvancedModelMapping {
    return {
      enabled: false,
      claude: {
        aliasMode: "none",
        defaultTarget: "",
        opusTarget: "",
        sonnetTarget: "",
        haikuTarget: "",
        subagentTarget: "",
      },
      codex: {
        commandLineModelOverride: "",
      },
    };
  }

  const stableProps = {
    draft: {
      name: "Claude",
      url: "https://api.example.com",
      key: "sk-test",
      selectedModelId: "claude-sonnet-4-5",
      advancedModelMapping: makeAdvancedMapping(),
      permissions: null,
    },
    globalPermissions: defaultProfilePermissions("claude"),
    runtime: {
      cwd: "C:/repo",
      command_base: "claude",
      settings_file: "",
      extra_args: "",
      launch_mode: "new" as const,
      exclude_user_settings: true,
    },
    provider: "claude" as const,
    modelOptions: ["claude-sonnet-4-5"],
    onChange: vi.fn(),
    onPermissionsChange: vi.fn(),
    onDraftCommit: vi.fn(),
    onAdvancedModelMappingChange: vi.fn(),
    onRuntimeChange: vi.fn(),
    onRuntimeCommit: vi.fn(),
    onFetchModels: vi.fn(),
    onOpenBaseUrl: vi.fn(),
    onPickCwd: vi.fn(),
    onSave: vi.fn(),
    onCancel: vi.fn(),
    disabled: false,
  };

  beforeEach(() => {
    renderCounts.glassCardByTitle.clear();
    renderCounts.permissionSettingsCard = 0;
  });

  it("skips rendering the form body when parent state changes without prop changes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let rerenderParent = () => {};

    function Parent() {
      const [, setTick] = useState(0);
      rerenderParent = () => setTick((tick) => tick + 1);
      return <ProfileEditForm {...stableProps} />;
    }

    await act(async () => {
      root.render(<Parent />);
    });

    expect(renderCounts.glassCardByTitle.get("Profile 信息")).toBe(1);
    expect(renderCounts.permissionSettingsCard).toBe(1);

    await act(async () => {
      rerenderParent();
    });

    expect(renderCounts.glassCardByTitle.get("Profile 信息")).toBe(1);
    expect(renderCounts.permissionSettingsCard).toBe(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
