// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileEditForm } from "../../../components/profiles/ProfileEditForm.jsx";
import { defaultProfilePermissions } from "../../profile/permissions.js";
import type { AdvancedModelMapping } from "../../profile/types.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("ProfileEditForm", () => {
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
        deepseekReasoningEffort: "default",
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
        commandPreview={<section>命令预览</section>}
      />,
    );

    const mainGridIndex = html.indexOf("class=\"profile-edit-main-grid\"");
    const primaryColumnIndex = html.indexOf("class=\"profile-edit-column profile-edit-column-primary\"");
    const secondaryColumnIndex = html.indexOf("class=\"profile-edit-column profile-edit-column-secondary\"");
    const profileCardIndex = html.indexOf("<h3>Profile 信息</h3>");
    const modelCardIndex = html.indexOf("<h3>模型配置</h3>");
    const permissionCardIndex = html.indexOf("<h3>权限</h3>");
    const runtimeCardIndex = html.indexOf("<h3>当前配置专属运行时设置</h3>");
    const commandPreviewIndex = html.indexOf("命令预览");
    const claudeCompatCardIndex = html.indexOf("<h3>Claude 模型兼容设置</h3>");

    expect(mainGridIndex).toBeGreaterThan(-1);
    expect(primaryColumnIndex).toBeGreaterThan(mainGridIndex);
    expect(secondaryColumnIndex).toBeGreaterThan(primaryColumnIndex);
    expect(profileCardIndex).toBeGreaterThan(primaryColumnIndex);
    expect(permissionCardIndex).toBeGreaterThan(profileCardIndex);
    expect(claudeCompatCardIndex).toBeGreaterThan(permissionCardIndex);
    expect(claudeCompatCardIndex).toBeLessThan(secondaryColumnIndex);
    expect(modelCardIndex).toBeGreaterThan(secondaryColumnIndex);
    expect(runtimeCardIndex).toBeGreaterThan(modelCardIndex);
    expect(commandPreviewIndex).toBeGreaterThan(runtimeCardIndex);
    expect(html).toContain("命令基座");
    expect(html).toContain("当前配置专属");
    expect(html).toContain("当前模型 ID");
    expect(html).toContain("获取模型列表");
    expect(html).toContain("Claude 模型兼容设置");
    expect(html).not.toContain("<datalist");
    expect(html).not.toContain("Claude Profile 需要当前 Base URL");
    expect(html).not.toContain(">代理<");
  });

  it("should render Claude single-model compatibility controls without explanatory helper text", () => {
    const mapping = makeAdvancedMapping();
    mapping.enabled = true;
    mapping.claude = {
      ...mapping.claude,
      aliasMode: "single_model_compat",
    };

    const html = renderToStaticMarkup(
      <ProfileEditForm
        draft={{ name: "GLM", url: "https://api.aicod.com", key: "sk", selectedModelId: "glm-5.1", advancedModelMapping: mapping }}
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

    expect(html).toContain("Claude 模型兼容设置");
    expect(html).toContain("主会话模型");
    expect(html).toContain("glm-5.1");
    expect(html).toContain("第三方单模型兼容模式");
    expect(html).toContain("DeepSeek 推理强度");
    expect(html).toContain("用于 DeepSeek Claude Code 兼容接口，会注入 CLAUDE_CODE_EFFORT_LEVEL。");
    expect(html).not.toContain("将 Opus / Sonnet / Haiku / Subagent 全部指向当前模型");
    expect(html).not.toContain("ANTHROPIC_DEFAULT_OPUS_MODEL");
    expect(html).not.toContain("ANTHROPIC_DEFAULT_SONNET_MODEL");
    expect(html).not.toContain("ANTHROPIC_DEFAULT_HAIKU_MODEL");
    expect(html).not.toContain("CLAUDE_CODE_SUBAGENT_MODEL");
    expect(html).not.toContain("这些不是 CLI 参数");
  });

  it("should not render Claude compatibility controls for Codex profiles", () => {
    const html = renderToStaticMarkup(
      <ProfileEditForm
        draft={{ name: "Codex", url: "https://api.openai.com/v1", key: "sk", selectedModelId: "gpt-5.5", advancedModelMapping: makeAdvancedMapping() }}
        runtime={{
          cwd: "",
          command_base: "codex",
          settings_file: "",
          extra_args: "",
          launch_mode: "new",
          exclude_user_settings: true,
        }}
        provider="codex"
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

    expect(html).not.toContain("Claude 模型兼容设置");
    expect(html).not.toContain("DeepSeek 推理强度");
    expect(html).toContain("Codex 命令行模型覆盖");
    expect(html.indexOf("<h3>高级选项</h3>")).toBeGreaterThan(html.indexOf("<h3>权限</h3>"));
    expect(html.indexOf("<h3>高级选项</h3>")).toBeLessThan(html.indexOf("<h3>模型配置</h3>"));
  });

  it("should offer a recommended compatibility action for third-party Claude models", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAdvancedModelMappingChange = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{ name: "GLM", url: "https://api.aicod.com", key: "sk", selectedModelId: "glm-5.1", advancedModelMapping: makeAdvancedMapping() }}
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
          onAdvancedModelMappingChange={onAdvancedModelMappingChange}
          onRuntimeChange={vi.fn()}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("当前模型 glm-5.1 看起来是第三方模型");
    const applyButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "应用推荐设置",
    );
    expect(applyButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      applyButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onAdvancedModelMappingChange).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      claude: expect.objectContaining({ aliasMode: "single_model_compat" }),
    }));

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should not recommend single-model compatibility after the user selects custom alias mapping", () => {
    const mapping = makeAdvancedMapping();
    mapping.enabled = true;
    mapping.claude = {
      ...mapping.claude,
      aliasMode: "custom",
      defaultTarget: "deepseek-v4-pro[1m]",
      opusTarget: "deepseek-v4-pro[1m]",
      sonnetTarget: "deepseek-v4-pro[1m]",
      haikuTarget: "deepseek-v4-flash",
      subagentTarget: "deepseek-v4-flash",
    };

    const html = renderToStaticMarkup(
      <ProfileEditForm
        draft={{ name: "DeepSeek", url: "https://api.deepseek.com/anthropic", key: "sk", selectedModelId: "deepseek-v4-pro[1m]", advancedModelMapping: mapping }}
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

    expect(html).toContain("Claude 模型兼容设置");
    expect(html).toContain("高级自定义");
    expect(html).toContain("deepseek-v4-flash");
    expect(html).not.toContain("看起来是第三方模型");
    expect(html).not.toContain("应用推荐设置");
  });

  it("should update Claude DeepSeek reasoning effort from the compatibility panel", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAdvancedModelMappingChange = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{ name: "DeepSeek", url: "https://api.deepseek.com/anthropic", key: "sk", selectedModelId: "deepseek-v4-pro", advancedModelMapping: makeAdvancedMapping() }}
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
          onAdvancedModelMappingChange={onAdvancedModelMappingChange}
          onRuntimeChange={vi.fn()}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const effortSelect = Array.from(container.querySelectorAll("select")).find(
      (select) => select.parentElement?.textContent?.includes("DeepSeek 推理强度"),
    );
    expect(effortSelect).toBeInstanceOf(HTMLSelectElement);

    await act(async () => {
      if (effortSelect) {
        effortSelect.value = "max";
        effortSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(onAdvancedModelMappingChange).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
      claude: expect.objectContaining({ deepseekReasoningEffort: "max" }),
    }));

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should not offer a recommended compatibility action for official Claude models on third-party gateways", () => {
    const html = renderToStaticMarkup(
      <ProfileEditForm
        draft={{ name: "Claude", url: "https://api.aicod.com", key: "sk", selectedModelId: "claude-opus-4-7", advancedModelMapping: makeAdvancedMapping() }}
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

    expect(html).toContain("Claude 模型兼容设置");
    expect(html).toContain("claude-opus-4-7");
    expect(html).not.toContain("看起来是第三方模型");
    expect(html).not.toContain("应用推荐设置");
  });

  it("should render model configuration with model help beside the field title", () => {
    const html = renderToStaticMarkup(
      <ProfileEditForm
        draft={{ name: "", url: "", key: "", selectedModelId: "gpt-5.5", advancedModelMapping: makeAdvancedMapping() }}
        runtime={{
          cwd: "",
          command_base: "claude",
          settings_file: "",
          extra_args: "",
          launch_mode: "new",
          exclude_user_settings: true,
        }}
        provider="claude"
        modelOptions={["gpt-5.5"]}
        onChange={vi.fn()}
        onAdvancedModelMappingChange={vi.fn()}
        onRuntimeChange={vi.fn()}
        onFetchModels={vi.fn()}
        onPickCwd={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const modelCardIndex = html.indexOf("<h3>模型配置</h3>");
    const permissionCardIndex = html.indexOf("<h3>权限</h3>");
    const modelFieldIndex = html.indexOf("当前模型 ID");
    const modelHelpIndex = html.indexOf("当前模型 ID 可选。填写后会按原始 model id 启动 CLI");
    const inputIndex = html.indexOf("placeholder=\"可选：站点返回什么 model id，这里就填什么 model id\"");
    const fetchButtonIndex = html.indexOf("获取模型列表");

    expect(modelCardIndex).toBeGreaterThan(-1);
    expect(permissionCardIndex).toBeGreaterThan(-1);
    expect(permissionCardIndex).toBeLessThan(modelCardIndex);
    expect(modelHelpIndex).toBeGreaterThan(modelFieldIndex);
    expect(modelHelpIndex).toBeLessThan(inputIndex);
    expect(modelHelpIndex).toBeLessThan(fetchButtonIndex);
    expect(html).toContain("class=\"field-help\"");
    expect(html).toContain("class=\"field-title-with-help\"");
    expect(html).not.toContain("除非开启高级别名映射，否则不会自动转换成 default / sonnet / opus / haiku");
    expect(html).not.toContain("站点后台会话");
    expect(html).toContain("class=\"secondary-button small\">获取模型列表</button>");
  });

  it("should toggle API Key visibility without changing edit behavior", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{ name: "", url: "", key: "sk-test", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
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
          onChange={onChange}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={vi.fn()}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const apiKeyInput = container.querySelector("input[placeholder='输入 API Key']") as HTMLInputElement | null;
    expect(apiKeyInput?.type).toBe("password");

    const showButton = container.querySelector("button[aria-label='显示 API Key']");
    expect(showButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      showButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(apiKeyInput?.type).toBe("text");

    const hideButton = container.querySelector("button[aria-label='隐藏 API Key']");
    expect(hideButton).toBeInstanceOf(HTMLButtonElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(apiKeyInput, "sk-next");
      apiKeyInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("key", "sk-next");

    await act(async () => {
      hideButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(apiKeyInput?.type).toBe("password");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should render permission controls and switch from inherited global permissions to custom profile permissions", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onPermissionsChange = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{ name: "", url: "", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping(), permissions: null }}
          globalPermissions={defaultProfilePermissions("claude")}
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
          onPermissionsChange={onPermissionsChange}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={vi.fn()}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain("权限");
    expect(container.textContent).toContain("继承全局");
    const permissionSelect = Array.from(container.querySelectorAll("select")).find(
      (select) => select.textContent?.includes("安全默认"),
    );
    expect(permissionSelect?.textContent).toContain("安全默认（允许工作区内编辑，敏感操作需要确认）");
    expect(permissionSelect?.textContent).toContain("严格白名单（不询问并限制在安全白名单内）");
    expect(container.textContent).toContain("全权限");
    expect(container.textContent).not.toContain("不询问并限制在安全白名单内。");
    expect(container.textContent).toContain("转换结果：Claude: default");

    const customButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "自定义",
    );
    await act(async () => {
      customButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onPermissionsChange).toHaveBeenCalledWith(expect.objectContaining({ preset: "safe" }));

    await act(async () => {
      root.unmount();
    });
    container.remove();
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
        modelFetchSuccess="已获取2个模型"
        onChange={vi.fn()}
        onAdvancedModelMappingChange={vi.fn()}
        onRuntimeChange={vi.fn()}
        onFetchModels={vi.fn()}
        onPickCwd={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain("最近获取：2026/5/5 14:55:20，已获取2个模型");
    expect(html).not.toContain("已更新当前站点模型列表");
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

  it("should render a Base URL open button and invoke onOpenBaseUrl", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onOpenBaseUrl = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{
            name: "",
            url: "https://ai.centos.hk/v1",
            key: "",
            selectedModelId: "",
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
          modelOptions={[]}
          onChange={vi.fn()}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={vi.fn()}
          onFetchModels={vi.fn()}
          onOpenBaseUrl={onOpenBaseUrl}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const openButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "打开",
    );

    expect(openButton).toBeDefined();
    expect(openButton).toBeInstanceOf(HTMLButtonElement);
    expect((openButton as HTMLButtonElement | undefined)?.disabled).toBe(false);

    await act(async () => {
      openButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onOpenBaseUrl).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should disable the Base URL open button when the URL is blank", () => {
    const html = renderToStaticMarkup(
      <ProfileEditForm
        draft={{ name: "", url: "  ", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
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
        onOpenBaseUrl={vi.fn()}
        onPickCwd={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain(">打开</button>");
    expect(html).toContain("disabled=\"\"");
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

  it("should open a controlled searchable model picker and filter listed models", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{
            name: "",
            url: "",
            key: "",
            selectedModelId: "gpt",
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
          modelOptions={["claude-opus-4-7", "gpt-5-high", "gpt-5-low"]}
          onChange={vi.fn()}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={vi.fn()}
          onDraftCommit={vi.fn()}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const modelInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.value === "gpt",
    );

    expect(modelInput).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      modelInput?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    const listbox = container.querySelector('[role="listbox"][aria-label="模型 ID 候选列表"]');
    expect(listbox).toBeInstanceOf(HTMLElement);
    expect(listbox?.textContent).toContain("gpt-5-high");
    expect(listbox?.textContent).toContain("gpt-5-low");
    expect(listbox?.textContent).not.toContain("claude-opus-4-7");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should commit selectedModelId when a model picker option is clicked", async () => {
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
            selectedModelId: "",
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
          modelOptions={["claude-opus-4-7", "gpt-5-high"]}
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
      (input) => input.placeholder.includes("model id"),
    );

    await act(async () => {
      modelInput?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    const option = Array.from(container.querySelectorAll('[role="option"]')).find(
      (item) => item.textContent?.trim() === "gpt-5-high",
    );
    expect(option).toBeInstanceOf(HTMLElement);

    await act(async () => {
      option?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });

    expect(onChange).toHaveBeenCalledWith("selectedModelId", "gpt-5-high");
    expect(onDraftCommit).toHaveBeenCalledWith("selectedModelId", "gpt-5-high");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should keep the model picker closed while disabled", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{
            name: "",
            url: "",
            key: "",
            selectedModelId: "",
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
          modelOptions={["claude-opus-4-7", "gpt-5-high"]}
          onChange={vi.fn()}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={vi.fn()}
          onDraftCommit={vi.fn()}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
          disabled
        />,
      );
    });

    const modelInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.placeholder.includes("model id"),
    );

    await act(async () => {
      modelInput?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });

    expect(container.querySelector('[role="listbox"][aria-label="模型 ID 候选列表"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

});
