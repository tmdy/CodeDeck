// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { GlobalSettingsPanel } from "../../../components/settings/GlobalSettingsPanel.jsx";
import { defaultGlobalSettings } from "../../profile/types.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("GlobalSettingsPanel", () => {
  it("should not render launch traffic or co-authored-by switches", () => {
    const html = renderToStaticMarkup(
      <GlobalSettingsPanel
        settings={defaultGlobalSettings()}
        onChange={vi.fn()}
      />,
    );

    expect(html).not.toContain("禁用遥测");
    expect(html).not.toContain("禁用错误报告");
    expect(html).not.toContain("禁用非必要网络流量");
    expect(html).not.toContain("包含 Co-authored-by 标记");
  });

  it("should render separate Claude and Codex permission selectors with common protection switches", () => {
    const html = renderToStaticMarkup(
      <GlobalSettingsPanel
        settings={defaultGlobalSettings()}
        onChange={vi.fn()}
      />,
    );

    expect(html).toContain("Claude Code 默认权限");
    expect(html).toContain("Codex 默认权限");
    expect(html).toContain("<select");
    expect(html).toContain("plan（只读/规划）");
    expect(html).toContain("manual（手动确认，安全默认）");
    expect(html).toContain("acceptEdits（自动接受编辑）");
    expect(html).toContain("workspace-write + on-request（安全默认）");
    expect(html).toContain("danger-full-access + never（全权限）");
    expect(html).not.toContain("最终配置：");
    expect(html).not.toContain("Claude --permission-mode manual");
    expect(html).not.toContain("Codex sandbox_mode=workspace-write; approval_policy=on-request");
    expect(html).not.toContain("Codex 路径");
    expect(html).not.toContain("CODEX_HOME");
    expect(html).not.toContain("Codex config.toml 文件");
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
              claude: {
                ...defaultGlobalSettings().permissions.claude,
                mode: "bypassPermissions",
                fullAccessConfirmed: false,
              },
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
        claude: expect.objectContaining({
          mode: "bypassPermissions",
          fullAccessConfirmed: true,
        }),
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
