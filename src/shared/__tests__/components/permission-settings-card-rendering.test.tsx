// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PermissionSettingsCard } from "../../../components/permissions/PermissionSettingsCard.jsx";
import { defaultProfilePermissions } from "../../profile/permissions.js";

const renderCounts = vi.hoisted(() => ({
  glassCardByTitle: new Map<string, number>(),
}));

vi.mock("../../../components/common/GlassCard.jsx", () => ({
  GlassCard: ({ title, children }: { title: string; children: React.ReactNode }) => {
    renderCounts.glassCardByTitle.set(title, (renderCounts.glassCardByTitle.get(title) ?? 0) + 1);
    return <section data-testid={`glass-card-${title}`}>{children}</section>;
  },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("PermissionSettingsCard rendering", () => {
  const stableProps = {
    title: "权限",
    provider: "claude" as const,
    permissions: defaultProfilePermissions("claude"),
    onChange: vi.fn(),
    inheritedSummary: "当前 Profile 继承全局默认权限",
    inherit: true,
    onInheritChange: vi.fn(),
    disabled: false,
  };

  beforeEach(() => {
    renderCounts.glassCardByTitle.clear();
  });

  it("skips rendering when parent state changes without prop changes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let rerenderParent = () => {};

    function Parent() {
      const [, setTick] = useState(0);
      rerenderParent = () => setTick((tick) => tick + 1);
      return <PermissionSettingsCard {...stableProps} />;
    }

    await act(async () => {
      root.render(<Parent />);
    });

    expect(renderCounts.glassCardByTitle.get("权限")).toBe(1);

    await act(async () => {
      rerenderParent();
    });

    expect(renderCounts.glassCardByTitle.get("权限")).toBe(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not claim global git push or dangerous delete enforcement for Codex", () => {
    const html = renderToStaticMarkup(
      <PermissionSettingsCard
        title="Codex 权限"
        provider="codex"
        permissions={defaultProfilePermissions("codex")}
        onChange={vi.fn()}
      />,
    );

    expect(html).not.toContain("禁止 git push");
    expect(html).not.toContain("禁止危险删除");
    expect(html).toContain("禁读 env/key 文件");
    expect(html).toContain("允许联网");
  });
});
