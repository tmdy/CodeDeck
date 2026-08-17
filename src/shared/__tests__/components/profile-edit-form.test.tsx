// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
      },
      codex: {
        subagentTarget: "",
      },
    };
  }

  it("routes saved-argument chips through the immediate persistence callback only", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onRuntimeChange = vi.fn();
    const onSavedExtraArgToggle = vi.fn();
    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{ name: "", url: "", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
          runtime={{
            cwd: "",
            command_base: "claude",
            settings_file: "",
            extra_args: "--manual keep",
            launch_mode: "new",
            exclude_user_settings: true,
          }}
          savedExtraArgs={[{ id: "saved-1", value: "--review fast" }]}
          provider="claude"
          modelOptions={[]}
          onChange={vi.fn()}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={onRuntimeChange}
          onSavedExtraArgToggle={onSavedExtraArgToggle}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const chip = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "--review fast",
    );
    await act(async () => chip?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onSavedExtraArgToggle).toHaveBeenCalledWith("--review fast");
    expect(onRuntimeChange).not.toHaveBeenCalledWith("extra_args", expect.anything());

    const input = container.querySelector<HTMLInputElement>('input[placeholder="其他 CLI 参数"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      valueSetter?.call(input, "--typed-only");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onRuntimeChange).toHaveBeenCalledWith("extra_args", "--typed-only");

    await act(async () => root.unmount());
    container.remove();
  });

  it("renders saved arguments as only a clickable parameter box and delete control", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSavedExtraArgsChange = vi.fn();
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
          savedExtraArgs={[{ id: "saved-1", value: "--review fast" }]}
          provider="claude"
          modelOptions={[]}
          onChange={vi.fn()}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={vi.fn()}
          onSavedExtraArgsChange={onSavedExtraArgsChange}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const chip = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "--review fast",
    );
    expect(chip?.disabled).toBe(false);
    const row = chip?.closest(".profile-saved-extra-arg-row");
    expect(row?.querySelector("input")).toBeNull();
    expect(Array.from(row?.querySelectorAll("button") ?? []).map((button) => button.textContent)).toEqual([
      "--review fast",
      "×",
    ]);
    const deleteButton = row?.querySelector<HTMLButtonElement>('[aria-label="删除已保存参数"]');
    await act(async () => deleteButton?.click());
    expect(onSavedExtraArgsChange).toHaveBeenCalledWith([]);

    const addButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "添加参数",
    );
    await act(async () => addButton?.click());
    const editor = container.querySelector<HTMLInputElement>(
      'input[placeholder="输入要保存的 CLI 参数"]',
    );
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      valueSetter?.call(editor, "--review thorough");
      editor?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const saveButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "保存",
    );
    await act(async () => saveButton?.click());
    expect(onSavedExtraArgsChange).toHaveBeenLastCalledWith([
      { id: "saved-1", value: "--review fast" },
      { id: expect.stringMatching(/^saved-extra-arg-/), value: "--review thorough" },
    ]);

    await act(async () => root.unmount());
    container.remove();
  });

  it("renders channel management controls for the active credential", () => {
    const html = renderToStaticMarkup(
      <ProfileEditForm
        draft={{
          name: "Relay",
          url: "https://relay.example.com",
          key: "sk-b",
          selectedModelId: "model-b",
          channels: [
            { id: "a", name: "渠道 A", key: "sk-a" },
            { id: "b", name: "渠道 B", key: "sk-b", selectedModelId: "model-b" },
          ],
          activeChannelId: "b",
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
        onChannelsChange={vi.fn()}
        onAdvancedModelMappingChange={vi.fn()}
        onRuntimeChange={vi.fn()}
        onFetchModels={vi.fn()}
        onTestHealth={vi.fn()}
        healthState={{
          target: {
            provider: "claude",
            profile_key: "claude::Relay",
            channel_id: "b",
            base_url: "https://relay.example.com",
            model_id: "model-b",
          },
          status: "available",
          reason_code: "ok",
          running: false,
          source: "active",
          checked_at: "2026-08-17T08:00:00.000Z",
          verified_at: "2026-08-17T08:00:00.000Z",
          latency_ms: 1250,
          consecutive_successes: 3,
          last_failure: "",
        }}
        onPickCwd={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain("当前渠道");
    expect(html).not.toContain('placeholder="输入渠道名称"');
    expect(html).toContain("渠道 A");
    expect(html).toContain("渠道 B");
    expect(html).toContain('value="sk-b"');
    expect(html).toContain('aria-label="添加渠道"');
    expect(html).toContain('aria-label="重命名当前渠道"');
    expect(html).toContain('aria-label="删除当前渠道"');
    expect(html).toContain("检测渠道");
    expect(html).toContain("可用 · 1.3s");
    expect(html).toContain("来源：主动检测");
    expect(html).toContain("连续成功：3 次");
    expect(html).not.toContain("profile-channel-health-detail");
  });

  it("uses the saved-profile gating reason and hides the active action when unavailable", () => {
    const baseProps = {
      draft: {
        name: "Relay",
        url: "https://relay.example.com",
        key: "sk-test",
        selectedModelId: "model-a",
        channels: [{ id: "default", name: "默认渠道", key: "sk-test", selectedModelId: "model-a" }],
        activeChannelId: "default",
        advancedModelMapping: makeAdvancedMapping(),
      },
      runtime: {
        cwd: "D:/workspace",
        command_base: "claude",
        settings_file: "",
        extra_args: "",
        launch_mode: "new" as const,
        exclude_user_settings: true,
      },
      provider: "claude" as const,
      modelOptions: [],
      onChange: vi.fn(),
      onAdvancedModelMappingChange: vi.fn(),
      onRuntimeChange: vi.fn(),
      onFetchModels: vi.fn(),
      onPickCwd: vi.fn(),
      onSave: vi.fn(),
      onCancel: vi.fn(),
    };
    const disabledHtml = renderToStaticMarkup(
      <ProfileEditForm
        {...baseProps}
        onTestHealth={vi.fn()}
        healthTestDisabledReason="请先保存当前修改"
      />,
    );
    const hiddenHtml = renderToStaticMarkup(<ProfileEditForm {...baseProps} />);

    expect(disabledHtml).toContain('title="请先保存当前修改"');
    expect(disabledHtml).toContain("disabled");
    expect(hiddenHtml).not.toContain("检测渠道");
  });


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
    expect(html).toContain("glass-card profile-runtime-card");
    expect(html).toContain("命令基座");
    expect(html).toContain("当前配置专属");
    expect(html).toContain("当前模型 ID");
    expect(html).toContain("获取模型列表");
    expect(html).toContain("Claude 模型兼容设置");
    expect(html).not.toContain("<datalist");
    expect(html).not.toContain("Claude Profile 需要当前 Base URL");
    expect(html).not.toContain(">代理<");
  });

  it("should render profile runtime environment variable controls", () => {
    const html = renderToStaticMarkup(
      <ProfileEditForm
        draft={{ name: "", url: "", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
        runtime={{
          cwd: "",
          command_base: "claude",
          settings_file: "",
          extra_args: "",
          extra_env: {
            PROFILE_ONLY: "profile value",
            CLAUDE_CODE_EFFORT_LEVEL: "max",
          },
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

    expect(html).toContain("环境变量");
    expect(html).not.toContain("Profile 环境变量会覆盖全局环境变量");
    expect(html).toContain("profile-runtime-env-list");
    expect(html).toContain("profile-runtime-env-actions");
    expect(html).toContain("PROFILE_ONLY");
    expect(html).toContain("profile value");
    expect(html).toContain("CLAUDE_CODE_EFFORT_LEVEL");
    expect(html).toContain("max");
  });

  it("should render provider-specific reasoning effort options in model config", () => {
    const claudeHtml = renderToStaticMarkup(
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
    const codexHtml = renderToStaticMarkup(
      <ProfileEditForm
        draft={{ name: "", url: "", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
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

    expect(claudeHtml).toContain("思考等级");
    expect(claudeHtml).toContain("沿用默认");
    expect(claudeHtml).toContain("xhigh");
    expect(claudeHtml).toContain("max");
    expect(claudeHtml).not.toContain("minimal");
    expect(codexHtml).toContain("思考等级");
    expect(codexHtml).toContain("minimal");
    expect(codexHtml).toContain("xhigh");
    expect(codexHtml).toContain("max");
    expect(codexHtml).toContain("ultra");
  });

  it("should update the structured reasoning effort field without enabling advanced alias mapping", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAdvancedModelMappingChange = vi.fn();

    await act(async () => {
      root.render(
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
      (select) => select.textContent?.includes("minimal") && select.textContent?.includes("ultra"),
    );
    expect(effortSelect).toBeInstanceOf(HTMLSelectElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      valueSetter?.call(effortSelect, "ultra");
      effortSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(onAdvancedModelMappingChange).toHaveBeenCalledWith(expect.objectContaining({
      enabled: false,
      codex: expect.objectContaining({ reasoningEffort: "ultra" }),
    }));

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should keep profile runtime environment inputs aligned with form field typography", () => {
    const css = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

    expect(css).toMatch(/\.profile-runtime-env-section > span,\s*\.profile-runtime-env-row input\s*\{[^}]*font-size:\s*0\.86rem;[^}]*font-weight:\s*600;/s);
  });

  it("should keep the working directory and favorites fields proportionally responsive", () => {
    const css = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");

    expect(css).toMatch(/\.path-field input\s*\{[^}]*flex:\s*4 1 0;/s);
    expect(css).toMatch(/\.path-field select\s*\{[^}]*flex:\s*1 1 0;[^}]*min-width:\s*0;[^}]*max-width:\s*none;/s);
  });

  it("should add, update and remove profile runtime environment variables", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onRuntimeChange = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{ name: "", url: "", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
          runtime={{
            cwd: "",
            command_base: "claude",
            settings_file: "",
            extra_args: "",
            extra_env: { OLD_ENV: "old value" },
            launch_mode: "new",
            exclude_user_settings: true,
          }}
          provider="claude"
          modelOptions={[]}
          onChange={vi.fn()}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={onRuntimeChange}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "添加环境变量",
    );
    expect(addButton).toBeDefined();
    expect(addButton?.className).toContain("small");

    await act(async () => {
      addButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRuntimeChange).toHaveBeenLastCalledWith("extra_env", {
      OLD_ENV: "old value",
      "": "",
    });

    const oldEnvInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.value === "OLD_ENV",
    );
    expect(oldEnvInput).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(oldEnvInput, "NEW_ENV");
      oldEnvInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(onRuntimeChange).toHaveBeenLastCalledWith("extra_env", {
      NEW_ENV: "old value",
    });

    const deleteButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "删除",
    );
    expect(deleteButton).toBeDefined();

    await act(async () => {
      deleteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onRuntimeChange).toHaveBeenLastCalledWith("extra_env", {});

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should bulk import runtime environment variables and report skipped lines", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onRuntimeChange = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{ name: "", url: "", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
          runtime={{
            cwd: "",
            command_base: "codex",
            settings_file: "",
            extra_args: "",
            extra_env: { HTTP_PROXY: "old", KEEP_ME: "unchanged" },
            launch_mode: "new",
            exclude_user_settings: true,
          }}
          provider="codex"
          modelOptions={[]}
          onChange={vi.fn()}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={onRuntimeChange}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const bulkButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "批量粘贴",
    );
    await act(async () => {
      bulkButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const textarea = container.querySelector("textarea");
    expect(textarea).toBeInstanceOf(HTMLTextAreaElement);
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      valueSetter?.call(textarea, "HTTP_PROXY=http://127.0.0.1:10808\ninvalid line\nTOKEN=part=two");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const importButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "导入",
    );
    await act(async () => {
      importButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onRuntimeChange).toHaveBeenLastCalledWith("extra_env", {
      HTTP_PROXY: "http://127.0.0.1:10808",
      KEEP_ME: "unchanged",
      TOKEN: "part=two",
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("已导入 2 项，已跳过第 2 行。");
    expect(container.querySelector("textarea")).toBeInstanceOf(HTMLTextAreaElement);

    const cancelButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "取消",
    );
    await act(async () => {
      cancelButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("textarea")).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should expose working directory favorite controls", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onToggleWorkingDirectoryFavorite = vi.fn();
    const onSelectWorkingDirectoryFavorite = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{ name: "", url: "", key: "", selectedModelId: "", advancedModelMapping: makeAdvancedMapping() }}
          runtime={{
            cwd: "C:/workspace/alpha",
            command_base: "claude",
            settings_file: "",
            extra_args: "",
            launch_mode: "new",
            exclude_user_settings: true,
          }}
          provider="claude"
          modelOptions={[]}
          workingDirectoryFavorites={["C:/workspace/alpha", "C:/workspace/beta"]}
          onChange={vi.fn()}
          onAdvancedModelMappingChange={vi.fn()}
          onRuntimeChange={vi.fn()}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onToggleWorkingDirectoryFavorite={onToggleWorkingDirectoryFavorite}
          onSelectWorkingDirectoryFavorite={onSelectWorkingDirectoryFavorite}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const favoriteButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.getAttribute("aria-label") === "取消收藏当前工作目录",
    );
    expect(favoriteButton).toBeDefined();
    expect(favoriteButton?.textContent).toBe("★");

    await act(async () => {
      favoriteButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onToggleWorkingDirectoryFavorite).toHaveBeenCalledTimes(1);

    const favoriteSelect = Array.from(container.querySelectorAll("select")).find(
      (select) => select.getAttribute("aria-label") === "选择收藏的工作目录",
    );
    expect(favoriteSelect).toBeInstanceOf(HTMLSelectElement);
    expect(favoriteSelect?.textContent).toContain("C:/workspace/beta");

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      valueSetter?.call(favoriteSelect, "C:/workspace/beta");
      favoriteSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(onSelectWorkingDirectoryFavorite).toHaveBeenCalledWith("C:/workspace/beta");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should disable the working directory favorite button when cwd is empty", () => {
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
        workingDirectoryFavorites={["C:/workspace/alpha"]}
        onChange={vi.fn()}
        onAdvancedModelMappingChange={vi.fn()}
        onRuntimeChange={vi.fn()}
        onFetchModels={vi.fn()}
        onPickCwd={vi.fn()}
        onToggleWorkingDirectoryFavorite={vi.fn()}
        onSelectWorkingDirectoryFavorite={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    expect(html).toContain("aria-label=\"收藏当前工作目录\"");
    expect(html).toContain("disabled=\"\"");
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
    expect(html).not.toContain("用于第三方 Anthropic-compatible 网关的 Claude 内部模型别名覆盖");
    expect(html).not.toContain("主会话模型");
    expect(html).toContain("glm-5.1");
    expect(html).toContain("第三方单模型兼容模式");
    expect(html).not.toContain("DeepSeek 推理强度");
    expect(html).not.toContain("用于 DeepSeek Claude Code 兼容接口，会注入 CLAUDE_CODE_EFFORT_LEVEL。");
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
    expect(html).toContain("Codex 子代理模型映射");
    expect(html).toContain("启用子代理模型映射");
    expect(html).toContain("子代理模型");
    expect(html).not.toContain("Codex 命令行模型覆盖");
    expect(html.indexOf("<h3>Codex 子代理模型映射</h3>")).toBeGreaterThan(html.indexOf("<h3>权限</h3>"));
    expect(html.indexOf("<h3>Codex 子代理模型映射</h3>")).toBeLessThan(html.indexOf("<h3>模型配置</h3>"));
  });

  it("should keep the Codex subagent model mapping disabled", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onAdvancedModelMappingChange = vi.fn();

    await act(async () => {
      root.render(
        <ProfileEditForm
          draft={{ name: "Codex", url: "https://api.openai.com/v1", key: "sk", selectedModelId: "gpt-5.6", advancedModelMapping: makeAdvancedMapping() }}
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
          onAdvancedModelMappingChange={onAdvancedModelMappingChange}
          onRuntimeChange={vi.fn()}
          onFetchModels={vi.fn()}
          onPickCwd={vi.fn()}
          onSave={vi.fn()}
          onCancel={vi.fn()}
        />,
      );
    });

    const mappingLabel = Array.from(container.querySelectorAll("label")).find(
      (label) => label.textContent?.includes("启用子代理模型映射"),
    );
    const checkbox = mappingLabel?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(checkbox?.disabled).toBe(true);
    expect(onAdvancedModelMappingChange).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
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
    expect(html).not.toContain("用于第三方 Anthropic-compatible 网关的 Claude 内部模型别名覆盖");
    expect(html).not.toContain("主会话模型");
    expect(html).not.toContain("看起来是第三方模型");
    expect(html).not.toContain("应用推荐设置");
  });

  it("should not offer a recommended compatibility action for newer official Claude models on third-party gateways", () => {
    const html = renderToStaticMarkup(
      <ProfileEditForm
        draft={{ name: "Claude", url: "https://api.aicod.com", key: "sk", selectedModelId: "claude-fable-5[1m]", advancedModelMapping: makeAdvancedMapping() }}
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
    expect(html).toContain("claude-fable-5[1m]");
    expect(html).not.toContain("用于第三方 Anthropic-compatible 网关的 Claude 内部模型别名覆盖");
    expect(html).not.toContain("主会话模型");
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
    expect(modelFieldIndex).toBeLessThan(inputIndex);
    expect(modelHelpIndex).toBe(-1);
    expect(inputIndex).toBeLessThan(fetchButtonIndex);
    expect(html).not.toContain("class=\"field-title-with-help\"");
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
      (select) => select.textContent?.includes("manual"),
    );
    expect(permissionSelect?.textContent).toContain("manual（手动确认，安全默认）");
    expect(permissionSelect?.textContent).toContain("dontAsk（不询问）");
    expect(container.textContent).toContain("bypassPermissions");
    expect(container.textContent).not.toContain("不询问并限制在安全白名单内。");
    expect(container.textContent).not.toContain("最终配置：");
    expect(container.textContent).not.toContain("Claude --permission-mode manual");

    const customButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "自定义",
    );
    await act(async () => {
      customButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(onPermissionsChange).toHaveBeenCalledWith(expect.objectContaining({ mode: "manual" }));

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("should render model fetch success as responsive Beijing-time status text", () => {
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
        modelFetchedAt="2026-07-31T09:45:13.399Z"
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

    expect(html).toContain("最近获取：2026年07月31日 17:45:13，已获取2个模型");
    expect(html).toContain('class="inline-actions model-fetch-actions"');
    expect(html).toContain('class="muted model-fetch-status"');
    expect(html).not.toContain('flex-wrap:nowrap');
    expect(html).not.toContain('white-space:nowrap');
    expect(html).not.toContain("已更新当前站点模型列表");
    expect(html).not.toContain("banner success");
  });

  it("should normalize legacy model fetch timestamps without shifting their Beijing wall time", () => {
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

    expect(html).toContain("最近获取：2026年05月05日 14:55:20，已获取2个模型");
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
