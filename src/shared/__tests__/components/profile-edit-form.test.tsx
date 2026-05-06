// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfileEditForm } from "../../../components/profiles/ProfileEditForm.jsx";
import { defaultProfilePermissions } from "../../profile/permissions.js";
import type { AdvancedModelMapping } from "../../profile/types.js";
import type { SiteBalanceSession } from "../../balance/site-balance-sessions.js";

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

  function makeSiteSession(id: string, label: string): SiteBalanceSession {
    return {
      id,
      label,
      base_url: "https://new-api.example.com",
      access_token: `token-${id}`,
      user_id: "42",
      updated_at: "2026-05-05T09:00:00.000Z",
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
        siteBalanceSessions={[]}
        balanceSessionSelection="auto"
        balanceSessionDraft={{ label: "", access_token: "", user_id: "" }}
        onChange={vi.fn()}
        onBalanceSessionSelectionChange={vi.fn()}
        onBalanceSessionDraftChange={vi.fn()}
        onDeleteSiteBalanceSession={vi.fn()}
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

  it("should render model configuration before site balance sessions with model help beside the field title", () => {
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
        siteBalanceSessions={[]}
        balanceSessionSelection="auto"
        balanceSessionDraft={{ label: "", access_token: "", user_id: "" }}
        onChange={vi.fn()}
        onBalanceSessionSelectionChange={vi.fn()}
        onBalanceSessionDraftChange={vi.fn()}
        onDeleteSiteBalanceSession={vi.fn()}
        onAdvancedModelMappingChange={vi.fn()}
        onRuntimeChange={vi.fn()}
        onFetchModels={vi.fn()}
        onPickCwd={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const modelCardIndex = html.indexOf("<h3>模型配置</h3>");
    const balanceCardIndex = html.indexOf("<h3>站点后台会话</h3>");
    const modelFieldIndex = html.indexOf("当前模型 ID");
    const modelHelpIndex = html.indexOf("当前模型 ID 可选。填写后会按原始 model id 启动 CLI");
    const inputIndex = html.indexOf("placeholder=\"可选：站点返回什么 model id，这里就填什么 model id\"");
    const fetchButtonIndex = html.indexOf("获取模型列表");

    expect(modelCardIndex).toBeGreaterThan(-1);
    expect(balanceCardIndex).toBeGreaterThan(-1);
    expect(modelCardIndex).toBeLessThan(balanceCardIndex);
    expect(modelHelpIndex).toBeGreaterThan(modelFieldIndex);
    expect(modelHelpIndex).toBeLessThan(inputIndex);
    expect(modelHelpIndex).toBeLessThan(fetchButtonIndex);
    expect(html).toContain("class=\"field-help\"");
    expect(html).toContain("class=\"field-title-with-help\"");
    expect(html).not.toContain("除非开启高级别名映射，否则不会自动转换成 default / sonnet / opus / haiku");
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
          siteBalanceSessions={[]}
          balanceSessionSelection="auto"
          balanceSessionDraft={{ label: "", access_token: "", user_id: "" }}
          onChange={onChange}
          onBalanceSessionSelectionChange={vi.fn()}
          onBalanceSessionDraftChange={vi.fn()}
          onDeleteSiteBalanceSession={vi.fn()}
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
          siteBalanceSessions={[]}
          balanceSessionSelection="auto"
          balanceSessionDraft={{ label: "", access_token: "", user_id: "" }}
          onChange={vi.fn()}
          onPermissionsChange={onPermissionsChange}
          onBalanceSessionSelectionChange={vi.fn()}
          onBalanceSessionDraftChange={vi.fn()}
          onDeleteSiteBalanceSession={vi.fn()}
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
        siteBalanceSessions={[]}
        balanceSessionSelection="auto"
        balanceSessionDraft={{ label: "", access_token: "", user_id: "" }}
        modelFetchedAt="2026/5/5 14:55:20"
        modelFetchSuccess="已更新当前站点模型列表"
        onChange={vi.fn()}
        onBalanceSessionSelectionChange={vi.fn()}
        onBalanceSessionDraftChange={vi.fn()}
        onDeleteSiteBalanceSession={vi.fn()}
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
          siteBalanceSessions={[]}
          balanceSessionSelection="auto"
          balanceSessionDraft={{ label: "", access_token: "", user_id: "" }}
          onChange={vi.fn()}
          onBalanceSessionSelectionChange={vi.fn()}
          onBalanceSessionDraftChange={vi.fn()}
          onDeleteSiteBalanceSession={vi.fn()}
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
          siteBalanceSessions={[]}
          balanceSessionSelection="auto"
          balanceSessionDraft={{ label: "", access_token: "", user_id: "" }}
          onChange={vi.fn()}
          onBalanceSessionSelectionChange={vi.fn()}
          onBalanceSessionDraftChange={vi.fn()}
          onDeleteSiteBalanceSession={vi.fn()}
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
        siteBalanceSessions={[]}
        balanceSessionSelection="auto"
        balanceSessionDraft={{ label: "", access_token: "", user_id: "" }}
        onChange={vi.fn()}
        onBalanceSessionSelectionChange={vi.fn()}
        onBalanceSessionDraftChange={vi.fn()}
        onDeleteSiteBalanceSession={vi.fn()}
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
          siteBalanceSessions={[]}
          balanceSessionSelection="auto"
          balanceSessionDraft={{ label: "", access_token: "", user_id: "" }}
          onChange={vi.fn()}
          onBalanceSessionSelectionChange={vi.fn()}
          onBalanceSessionDraftChange={vi.fn()}
          onDeleteSiteBalanceSession={vi.fn()}
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
          siteBalanceSessions={[]}
          balanceSessionSelection="auto"
          balanceSessionDraft={{ label: "", access_token: "", user_id: "" }}
          onChange={vi.fn()}
          onBalanceSessionSelectionChange={vi.fn()}
          onBalanceSessionDraftChange={vi.fn()}
          onDeleteSiteBalanceSession={vi.fn()}
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
          siteBalanceSessions={[]}
          balanceSessionSelection="auto"
          balanceSessionDraft={{ label: "", access_token: "", user_id: "" }}
          onChange={onChange}
          onBalanceSessionSelectionChange={vi.fn()}
          onBalanceSessionDraftChange={vi.fn()}
          onDeleteSiteBalanceSession={vi.fn()}
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

  it("should render site balance session options without a manual remark field", () => {
    const html = renderToStaticMarkup(
      <ProfileEditForm
        draft={{ name: "", url: "https://new-api.example.com/v1", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
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
        siteBalanceSessions={[makeSiteSession("sess-a", "账号1")]}
        balanceSessionSelection="sess-a"
        balanceSessionDraft={{ label: "账号1", access_token: "token-a", user_id: "42" }}
        onChange={vi.fn()}
        onBalanceSessionSelectionChange={vi.fn()}
        onBalanceSessionDraftChange={vi.fn()}
        onDeleteSiteBalanceSession={vi.fn()}
        onAdvancedModelMappingChange={vi.fn()}
        onRuntimeChange={vi.fn()}
        onFetchModels={vi.fn()}
        onPickCwd={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain("站点后台会话");
    expect(html).toContain("仅用于管理面板类站点的余额检测");
    expect(html).toContain(">自动<");
    expect(html).toContain("账号1");
    expect(html).toContain("新建会话");
    expect(html).not.toContain("备注名");
    expect(html).not.toContain("自动模式下：当前站点只有 1 套后台会话时会自动复用");
    expect(html).toContain("保存会话");
  });

  it("should expose a visible create-session affordance even when no sessions exist yet", () => {
    const html = renderToStaticMarkup(
      <ProfileEditForm
        draft={{ name: "", url: "https://new-api.example.com/v1", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
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
        siteBalanceSessions={[]}
        balanceSessionSelection="auto"
        balanceSessionDraft={{ label: "", access_token: "", user_id: "" }}
        onChange={vi.fn()}
        onBalanceSessionSelectionChange={vi.fn()}
        onBalanceSessionDraftChange={vi.fn()}
        onDeleteSiteBalanceSession={vi.fn()}
        onAdvancedModelMappingChange={vi.fn()}
        onRuntimeChange={vi.fn()}
        onFetchModels={vi.fn()}
        onPickCwd={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain("当前站点还没有后台会话");
    expect(html).toContain("选择“新建会话”后填写 Access Token / Session 和 User ID");
    expect(html).toContain(">新建会话<");
    expect(html).not.toContain("<button type=\"button\" class=\"secondary-button\">新建会话</button>");
  });

  it("should render balance session save and delete actions as small buttons in one row", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{ name: "", url: "https://new-api.example.com/v1", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
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
          siteBalanceSessions={[makeSiteSession("sess-a", "账号1")]}
          balanceSessionSelection="sess-a"
          balanceSessionDraft={{ label: "账号1", access_token: "token-a", user_id: "42" }}
          onChange={vi.fn()}
          onBalanceSessionSelectionChange={vi.fn()}
          onBalanceSessionDraftChange={vi.fn()}
          onSaveBalanceSession={vi.fn()}
          onDeleteSiteBalanceSession={vi.fn()}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={vi.fn()}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const actionRow = container.querySelector(".balance-session-actions");
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "保存会话",
    );
    const deleteButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "删除当前会话",
    );

    expect(actionRow).toBeInstanceOf(HTMLDivElement);
    expect(saveButton?.parentElement).toBe(actionRow);
    expect(deleteButton?.parentElement).toBe(actionRow);
    expect(saveButton?.className).toContain("small");
    expect(deleteButton?.className).toContain("small");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should invoke onSaveBalanceSession when saving a new site session", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSaveBalanceSession = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{ name: "", url: "https://new-api.example.com/v1", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
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
          siteBalanceSessions={[]}
          balanceSessionSelection="new"
          balanceSessionDraft={{ label: "后台 A", access_token: "token-a", user_id: "42" }}
          onChange={vi.fn()}
          onBalanceSessionSelectionChange={vi.fn()}
          onBalanceSessionDraftChange={vi.fn()}
          onSaveBalanceSession={onSaveBalanceSession}
          onDeleteSiteBalanceSession={vi.fn()}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={vi.fn()}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "保存会话",
    );

    expect(saveButton).toBeDefined();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onSaveBalanceSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
