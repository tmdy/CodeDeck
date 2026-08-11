// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { SettingsPage } from "../../../components/app/SettingsPage.jsx";
import { defaultParameterSettings } from "../../parameter/types.js";
import { defaultGlobalSettings } from "../../profile/types.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function changeInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("SettingsPage", () => {
  it("should persist the Codex sub-agent filter only when global settings are saved", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onGlobalChange = vi.fn();

    await act(async () => {
      root.render(
        <SettingsPage
          settingsSubTab="global"
          onSelectGlobal={vi.fn()}
          onSelectParameters={vi.fn()}
          globalSettingsProps={{
            settings: defaultGlobalSettings(),
            onChange: onGlobalChange,
          }}
          parameterSettingsProps={{
            settings: defaultParameterSettings(),
            onChange: vi.fn(),
          }}
        />,
      );
    });

    const checkbox = Array.from(container.querySelectorAll("input[type='checkbox']")).find(
      (input) => input.parentElement?.textContent?.includes("隐藏 Codex 子代理会话"),
    ) as HTMLInputElement | undefined;
    await act(async () => {
      checkbox?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onGlobalChange).not.toHaveBeenCalled();

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "保存设置",
    );
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onGlobalChange).toHaveBeenCalledWith(expect.objectContaining({
      hide_codex_subagent_sessions: false,
    }));
    await act(async () => root.unmount());
    container.remove();
  });

  it("should keep parameter edits as a draft until the user saves", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onParameterChange = vi.fn();

    await act(async () => {
      root.render(
        <SettingsPage
          settingsSubTab="parameters"
          onSelectGlobal={vi.fn()}
          onSelectParameters={vi.fn()}
          globalSettingsProps={{
            settings: defaultGlobalSettings(),
            onChange: vi.fn(),
          }}
          parameterSettingsProps={{
            settings: defaultParameterSettings(),
            onChange: onParameterChange,
          }}
        />,
      );
    });

    const wireApiInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.value === "responses",
    ) as HTMLInputElement | undefined;
    expect(wireApiInput).toBeDefined();

    await act(async () => {
      if (!wireApiInput) return;
      changeInputValue(wireApiInput, "chat");
    });

    expect(onParameterChange).not.toHaveBeenCalled();

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "保存设置",
    );
    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onParameterChange).toHaveBeenCalledWith(
      expect.objectContaining({
        cli_settings: expect.objectContaining({
          codex: expect.objectContaining({ wire_api: "chat" }),
        }),
      }),
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should discard draft parameter edits when the user cancels", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onParameterChange = vi.fn();

    await act(async () => {
      root.render(
        <SettingsPage
          settingsSubTab="parameters"
          onSelectGlobal={vi.fn()}
          onSelectParameters={vi.fn()}
          globalSettingsProps={{
            settings: defaultGlobalSettings(),
            onChange: vi.fn(),
          }}
          parameterSettingsProps={{
            settings: defaultParameterSettings(),
            onChange: onParameterChange,
          }}
        />,
      );
    });

    const wireApiInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.value === "responses",
    ) as HTMLInputElement | undefined;
    expect(wireApiInput).toBeDefined();

    await act(async () => {
      if (!wireApiInput) return;
      changeInputValue(wireApiInput, "chat");
    });

    const cancelButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "取消修改",
    );
    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onParameterChange).not.toHaveBeenCalled();
    const resetWireApiInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.value === "responses",
    );
    expect(resetWireApiInput).toBeDefined();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
