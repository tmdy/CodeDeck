// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { GlobalSettingsPanel } from "../../../components/settings/GlobalSettingsPanel.jsx";
import { defaultGlobalSettings } from "../../profile/types.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("GlobalSettingsPanel", () => {
  it("should render a fixed permission preset selector and common protection switches", () => {
    const html = renderToStaticMarkup(
      <GlobalSettingsPanel
        settings={defaultGlobalSettings()}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain("默认权限");
    expect(html).toContain("<select");
    expect(html).toContain("只读");
    expect(html).toContain("安全默认");
    expect(html).toContain("自动编辑");
    expect(html).toContain("严格白名单");
    expect(html).toContain("全权限");
    expect(html).toContain("转换结果：Claude: default");
    expect(html).toContain("禁读 env/key 文件");
    expect(html).toContain("禁止 git push");
    expect(html).toContain("禁止危险删除");
    expect(html).toContain("允许联网");
  });

  it("should require confirmation when selecting full access", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <GlobalSettingsPanel
          settings={{
            ...defaultGlobalSettings(),
            permissions: {
              ...defaultGlobalSettings().permissions,
              preset: "full_access",
              fullAccessConfirmed: false,
            },
          }}
          onChange={onChange}
        />,
      );
    });

    expect(container.textContent).toContain("我确认启用全权限模式");

    const confirm = Array.from(container.querySelectorAll("input[type='checkbox']")).find(
      (input) => input.parentElement?.textContent?.includes("我确认启用全权限模式"),
    );
    await act(async () => {
      confirm?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith({
      permissions: expect.objectContaining({
        preset: "full_access",
        fullAccessConfirmed: true,
      }),
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
