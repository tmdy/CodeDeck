// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileEditForm } from "../../../components/profiles/ProfileEditForm.jsx";
import type { AdvancedModelMapping } from "../../profile/types.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ProfileEditForm", () => {
  function makeAdvancedMapping(): AdvancedModelMapping {
    return {
      enabled: false,
      claude: {
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

  it("should render direct model-id controls instead of the old global mapping panel", () => {
    const html = renderToStaticMarkup(
      <ProfileEditForm
        draft={{ name: "", url: "", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
        runtime={{
          cwd: "",
          command_base: "claude",
          settings_file: "",
          extra_args: "",
          launch_mode: "new",
          exclude_user_settings: true,
        }}
        provider="claude"
        modelOptions={[]}
        onChange={vi.fn()}
        onAdvancedModelMappingChange={vi.fn()}
        onRuntimeChange={vi.fn()}
        onFetchModels={vi.fn()}
        onPickCwd={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain("命令基座");
    expect(html).toContain("当前配置专属");
    expect(html).toContain("当前模型 ID");
    expect(html).toContain("获取模型列表");
    expect(html).toContain("高级模型别名映射");
    expect(html).not.toContain("Claude Profile 需要当前 Base URL");
    expect(html).not.toContain(">代理<");
  });

  it("should render model fetch success as compact status text instead of a large success banner", () => {
    const html = renderToStaticMarkup(
      <ProfileEditForm
        draft={{ name: "", url: "", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
        runtime={{
          cwd: "",
          command_base: "claude",
          settings_file: "",
          extra_args: "",
          launch_mode: "new",
          exclude_user_settings: true,
        }}
        provider="claude"
        modelOptions={[]}
        modelFetchedAt="2026/5/5 14:55:20"
        modelFetchSuccess="已更新当前站点模型列表"
        onChange={vi.fn()}
        onAdvancedModelMappingChange={vi.fn()}
        onRuntimeChange={vi.fn()}
        onFetchModels={vi.fn()}
        onPickCwd={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain("最近获取：2026/5/5 14:55:20");
    expect(html).toContain("已更新当前站点模型列表");
    expect(html).not.toContain("banner success");
  });

  it("should render working directory picker button and invoke onPickCwd", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onPickCwd = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{ name: "", url: "", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
          runtime={{
            cwd: "",
            command_base: "claude",
            settings_file: "",
            extra_args: "",
            launch_mode: "new",
            exclude_user_settings: true,
          }}
          provider="claude"
          modelOptions={[]}
          onChange={vi.fn()}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={vi.fn()}
          onFetchModels={vi.fn()}
          onPickCwd={onPickCwd}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const pickButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "选择",
    );

    expect(pickButton).toBeDefined();

    await act(async () => {
      pickButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onPickCwd).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should commit cwd changes when the working directory input loses focus", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onRuntimeCommit = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{ name: "", url: "", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
          runtime={{
            cwd: "C:/old",
            command_base: "claude",
            settings_file: "",
            extra_args: "",
            launch_mode: "new",
            exclude_user_settings: true,
          }}
          provider="claude"
          modelOptions={[]}
          onChange={vi.fn()}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={vi.fn()}
          onRuntimeCommit={onRuntimeCommit}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const cwdInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.value === "C:/old",
    );

    expect(cwdInput).toBeDefined();

    await act(async () => {
      cwdInput?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(onRuntimeCommit).toHaveBeenCalledWith("cwd");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should commit selectedModelId changes when the model input loses focus", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onDraftCommit = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{
            name: "",
            url: "",
            key: "",
            selectedModelId: "old-model",
            advancedModelMapping: makeAdvancedMapping(),
          }}
          runtime={{
            cwd: "",
            command_base: "claude",
            settings_file: "",
            extra_args: "",
            launch_mode: "new",
            exclude_user_settings: true,
          }}
          provider="claude"
          modelOptions={["old-model", "new-model"]}
          onChange={vi.fn()}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={vi.fn()}
          onDraftCommit={onDraftCommit}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const modelInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.value === "old-model",
    );

    expect(modelInput).toBeDefined();

    await act(async () => {
      modelInput?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });

    expect(onDraftCommit).toHaveBeenCalledWith("selectedModelId");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should commit selectedModelId immediately when a listed model option is chosen", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();
    const onDraftCommit = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{
            name: "",
            url: "",
            key: "",
            selectedModelId: "old-model",
            advancedModelMapping: makeAdvancedMapping(),
          }}
          runtime={{
            cwd: "",
            command_base: "claude",
            settings_file: "",
            extra_args: "",
            launch_mode: "new",
            exclude_user_settings: true,
          }}
          provider="claude"
          modelOptions={["old-model", "new-model"]}
          onChange={onChange}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={vi.fn()}
          onDraftCommit={onDraftCommit}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const modelInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.value === "old-model",
    );

    expect(modelInput).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(modelInput, "new-model");
      modelInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("selectedModelId", "new-model");
    expect(onDraftCommit).toHaveBeenCalledWith("selectedModelId", "new-model");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
