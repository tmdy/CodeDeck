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
    expect(html).toContain("安全默认（允许工作区内编辑，敏感操作需要确认）");
    expect(html).toContain("自动编辑");
    expect(html).toContain("严格白名单（不询问并限制在安全白名单内）");
    expect(html).toContain("全权限");
    expect(html).toContain("转换结果：Claude: default");
    expect(html).toContain("禁读 env/key 文件");
    expect(html).toContain("禁止 git push");
    expect(html).toContain("禁止危险删除");
    expect(html).toContain("允许联网");
  });

  it("should render and update the application theme mode", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <GlobalSettingsPanel
          settings={defaultGlobalSettings()}
          onChange={onChange}
        />,
      );
    });

    expect(container.textContent).toContain("外观模式");
    expect(container.textContent).toContain("跟随系统");
    expect(container.textContent).toContain("日间");
    expect(container.textContent).toContain("夜间");

    const darkButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "夜间",
    );
    await act(async () => {
      darkButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith({ theme_mode: "dark" });

    await act(async () => {
      root.unmount();
    });
    container.remove();
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

  it("should submit current and new passwords when confirmation matches", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChangePassphrase = vi.fn();

    await act(async () => {
      root.render(
        <GlobalSettingsPanel
          settings={defaultGlobalSettings()}
          onChange={vi.fn()}
          onChangePassphrase={onChangePassphrase}
        />,
      );
    });

    expect(container.textContent).toContain("修改配置密码");

    const current = container.querySelector("input[name='currentPassword']") as HTMLInputElement;
    const next = container.querySelector("input[name='nextPassword']") as HTMLInputElement;
    const confirm = container.querySelector("input[name='confirmPassword']") as HTMLInputElement;
    const form = container.querySelector("form") as HTMLFormElement;

    await act(async () => {
      current.value = "old-password";
      next.value = "new-password";
      confirm.value = "new-password";
      form.dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }));
    });

    expect(onChangePassphrase).toHaveBeenCalledWith("old-password", "new-password");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
