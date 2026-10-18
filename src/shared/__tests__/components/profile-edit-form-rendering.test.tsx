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
        subagentTarget: "",
        subagentReasoningEffort: "",
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

  it("hides managed provider and model controls for native CLI startup", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ProfileEditForm
          {...stableProps}
          draft={{ ...stableProps.draft, name: "官方 Claude", url: "", key: "", selectedModelId: "" }}
          runtime={{ ...stableProps.runtime, startup_mode: "native" }}
        />,
      );
    });

    expect(renderCounts.permissionSettingsCard).toBe(0);
    expect(renderCounts.glassCardByTitle.get("模型配置")).toBeUndefined();
    expect(container.querySelector('input[placeholder="https://api.example.com"]')).toBeNull();
    expect((container.querySelector('input[placeholder="输入 Profile 名称"]') as HTMLInputElement).value).toBe("官方 Claude");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("renders editable Codex worker model mapping controls in the shared Home mode", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAdvancedModelMappingChange = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          {...stableProps}
          provider="codex"
          draft={{
            ...stableProps.draft,
            name: "Codex Site",
            selectedModelId: "gpt-5.6",
            advancedModelMapping: {
              ...makeAdvancedMapping(),
              enabled: true,
              codex: { subagentTarget: "worker-model", subagentReasoningEffort: "high" },
            },
          }}
          runtime={{ ...stableProps.runtime, command_base: "codex" }}
          onAdvancedModelMappingChange={onAdvancedModelMappingChange}
        />,
      );
    });

    expect(container.textContent).not.toContain("当前版本不提供 Codex Worker 子代理模型覆盖");
    expect(container.textContent).toContain("为当前 Codex Profile 的子代理请求设置模型和思考等级");
    const mappingCard = container.querySelector('[data-testid="glass-card-Codex 子代理模型映射"]');
    const mappingCheckbox = mappingCard?.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
    expect(mappingCheckbox?.checked).toBe(true);
    expect(mappingCheckbox?.disabled).toBe(false);
    const mappingInput = mappingCard?.querySelector('input[value="worker-model"]') as HTMLInputElement | null;
    expect(mappingInput?.disabled).toBe(false);
    const effortSelect = mappingCard?.querySelector('select') as HTMLSelectElement | null;
    expect(effortSelect?.value).toBe("high");
    expect(effortSelect?.disabled).toBe(false);
    expect(onAdvancedModelMappingChange).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
