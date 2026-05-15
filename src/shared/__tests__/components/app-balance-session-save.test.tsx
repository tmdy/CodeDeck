// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import App, { resetAppStartupStateForTests } from "../../../App.jsx";
import type { SiteBalanceSessionsByBaseUrl } from "../../balance/site-balance-sessions.js";
import type { BalanceCheckState } from "../../balance/types.js";
import { createDefaultModelMappingsState } from "../../model-mapping/config-types.js";
import { itemKey } from "../../profile/keys-internal.js";
import type { Profile, RuntimeSettings } from "../../profile/types.js";
import {
  defaultLocalState,
  type BootstrapLocalState,
  type LocalState,
} from "../../state/local-state.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MockProfileManager = NonNullable<Window["profileManager"]>;

const baseProfile: Profile = {
  provider: "claude",
  name: "Relay",
  url: "https://new-api.example.com/v1",
  key: "sk-relay",
};

function createState(profiles: Profile[], selectedProfile: Profile, runtime: RuntimeSettings): LocalState {
  const key = itemKey(selectedProfile);
  const orderedKeys = profiles
    .filter((profile) => profile.provider === selectedProfile.provider)
    .map((profile) => itemKey(profile));
  const runtimeByProfile = Object.fromEntries(
    profiles.map((profile) => [itemKey(profile), { ...runtime }]),
  );
  return {
    ...defaultLocalState(),
    selected_provider: selectedProfile.provider,
    selected_profile_key: key,
    selected_profile_key_by_provider: {
      [selectedProfile.provider]: key,
    },
    profile_order_by_provider: {
      [selectedProfile.provider]: orderedKeys,
    },
    runtime_by_profile: runtimeByProfile,
  };
}

function cloneSiteBalanceSessions(value: SiteBalanceSessionsByBaseUrl): SiteBalanceSessionsByBaseUrl {
  return Object.fromEntries(
    Object.entries(value).map(([baseUrl, sessions]) => [
      baseUrl,
      sessions.map((session) => ({ ...session })),
    ]),
  );
}

function createBootstrapState(state: LocalState): BootstrapLocalState {
  return {
    selected_provider: state.selected_provider,
    selected_profile_key: state.selected_profile_key,
    selected_profile_key_by_provider: { ...state.selected_profile_key_by_provider },
    profile_order_by_provider: { ...state.profile_order_by_provider },
    runtime_by_profile: { ...state.runtime_by_profile },
    balance_checks_by_profile: { ...state.balance_checks_by_profile },
    global_settings: { ...state.global_settings },
  };
}

function createProfileManagerFixture(
  initialProfiles: Profile[] = [{ ...baseProfile }],
  initialSiteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl = {},
) {
  const runtime: RuntimeSettings = {
    cwd: "",
    command_base: "claude",
    model: "",
    settings_file: "",
    launch_mode: "new",
    extra_args: "",
    exclude_user_settings: true,
  };
  let profiles: Profile[] = initialProfiles.map((profile) => ({ ...profile }));
  let siteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl = cloneSiteBalanceSessions(
    initialSiteBalanceSessionsByBaseUrl,
  );
  let state = createState(profiles, profiles[0], runtime);

  const listProfiles = vi.fn(async () => ({
    profiles: profiles.map((profile) => ({ ...profile })),
    state: {
      ...state,
      selected_profile_key_by_provider: { ...state.selected_profile_key_by_provider },
      profile_order_by_provider: { ...state.profile_order_by_provider },
      runtime_by_profile: { ...state.runtime_by_profile },
      balance_checks_by_profile: { ...state.balance_checks_by_profile },
      sessions_tab_scope_by_provider: { ...state.sessions_tab_scope_by_provider },
      sessions_tab_restore_profile_key_by_provider: { ...state.sessions_tab_restore_profile_key_by_provider },
    },
    siteBalanceSessionsByBaseUrl: cloneSiteBalanceSessions(siteBalanceSessionsByBaseUrl),
    defaultWorkingDirectory: "C:/Users/99395/Downloads",
  }));
  const saveSiteBalanceSession = vi.fn(async (_baseUrl: string, draft) => {
    const baseUrl = "https://new-api.example.com";
    const created = {
      id: draft.id ?? "sess-1",
      label: draft.label,
      base_url: baseUrl,
      access_token: draft.access_token,
      user_id: draft.user_id,
      updated_at: "2026-05-05T10:00:00.000Z",
    };
    const currentSessions = siteBalanceSessionsByBaseUrl[baseUrl] ?? [];
    const nextSessions = currentSessions.filter((session) => session.id !== created.id);
    siteBalanceSessionsByBaseUrl = {
      ...siteBalanceSessionsByBaseUrl,
      [baseUrl]: [...nextSessions, created],
    };
    return created;
  });
  const saveProfile = vi.fn(async (_targetKey, draft: Profile, runtimeDraft: RuntimeSettings) => {
    profiles = [{ ...draft }];
    state = createState(profiles, draft, runtimeDraft);
    return draft;
  });
  const testBalance = vi.fn(async () => undefined);
  const balanceState: BalanceCheckState = {
    provider: "claude",
    profile_name: "Relay",
    base_url: "https://new-api.example.com",
    running: false,
    supported: true,
    success: false,
    message: "",
    items: [],
    endpoint: "",
    finished_at_display: "",
  };

  const manager: MockProfileManager = {
    checkEncryptedConfig: vi.fn(async () => false),
    unlock: vi.fn(async () => ({ success: true })),
    initializeEncryption: vi.fn(async () => ({ success: true })),
    changePassphrase: vi.fn(async () => ({ success: true })),
    bootstrap: vi.fn(async () => ({
      profiles: profiles.map((profile) => ({ ...profile })),
      state: createBootstrapState(state),
      siteBalanceSessionsByBaseUrl: cloneSiteBalanceSessions(siteBalanceSessionsByBaseUrl),
      defaultWorkingDirectory: "C:/Users/99395/Downloads",
    })),
    listProfiles,
    saveProfile,
    deleteProfile: vi.fn(async () => undefined),
    cloneProfile: vi.fn(async () => ({
      ...baseProfile,
      provider: "codex" as const,
      name: "Relay (1)",
    })),
    selectProfile: vi.fn(async (provider, key) => {
      const selected = profiles.find((profile) => profile.provider === provider && itemKey(profile) === key);
      if (!selected) return;
      state = {
        ...state,
        selected_provider: selected.provider,
        selected_profile_key: key,
        selected_profile_key_by_provider: {
          ...state.selected_profile_key_by_provider,
          [selected.provider]: key,
        },
      };
    }),
    reorderProfiles: vi.fn(async () => undefined),
    activateProvider: vi.fn(async () => undefined),
    saveSiteBalanceSession,
    deleteSiteBalanceSession: vi.fn(async () => undefined),
    pickWorkingDirectory: vi.fn(async () => undefined),
    openBaseUrl: vi.fn(async () => undefined),
    previewForDraft: vi.fn(async () => ({
      command: "",
      cwd: "",
      env: [],
      valid: false,
    })),
    previewForProfile: vi.fn(async () => ({
      command: "",
      cwd: "",
      env: [],
      valid: false,
    })),
    launch: vi.fn(async () => undefined),
    listSessions: vi.fn(async () => []),
    refreshSessions: vi.fn(async () => undefined),
    updateSessionsTabState: vi.fn(async () => undefined),
    testBalance,
    getBalanceState: vi.fn(async () => balanceState),
    getModelMappings: vi.fn(async () => createDefaultModelMappingsState()),
    saveModelMappings: vi.fn(async (value) => value),
    fetchSiteModels: vi.fn(async () => ({ models: [] })),
    getGlobalSettings: vi.fn(async () => state.global_settings),
    updateGlobalSettings: vi.fn(async (patch) => ({ ...state.global_settings, ...patch })),
    getParameterSettings: vi.fn(async () => state.parameter_settings),
    updateParameterSettings: vi.fn(async (patch) => ({ ...state.parameter_settings, ...patch })),
    promptUnsavedProfileAction: vi.fn(async () => "save" as const),
    promptLaunchWithUnsavedChanges: vi.fn(async () => "save_and_launch" as const),
    onStateChanged: vi.fn(() => () => undefined),
    onBalanceProgress: vi.fn(() => () => undefined),
    onUnlockError: vi.fn(() => () => undefined),
  };

  return {
    manager,
    saveSiteBalanceSession,
    saveProfile,
    testBalance,
  };
}

describe("App balance session autosave", () => {
  afterEach(() => {
    resetAppStartupStateForTests();
    delete window.profileManager;
    document.body.innerHTML = "";
  });

  async function setInputValue(input: HTMLInputElement, value: string) {
    const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      valueSetter?.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  async function unlockAppIfNeeded(container: HTMLElement) {
    const passwordInput = container.querySelector<HTMLInputElement>('input[type="password"]');
    if (!passwordInput) {
      return;
    }
    const unlockButton = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === "创建并进入" || candidate.textContent?.trim() === "解锁",
    );
    expect(unlockButton).toBeInstanceOf(HTMLButtonElement);
    await setInputValue(passwordInput, "test-passphrase");
    await act(async () => {
      unlockButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  async function modelOptionValues(container: HTMLElement): Promise<string[]> {
    const modelInput = container.querySelector<HTMLInputElement>('input[role="combobox"]');
    expect(modelInput).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      modelInput?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      await Promise.resolve();
    });

    return Array.from(container.querySelectorAll('[role="option"]')).map((option) =>
      option.textContent?.trim() ?? "",
    );
  }

  async function renderAppWithFixture(fixture: ReturnType<typeof createProfileManagerFixture>) {
    window.profileManager = fixture.manager;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await unlockAppIfNeeded(container);
    await act(async () => {
      await Promise.resolve();
    });

    return { container, root };
  }

  function clickButtonByText(container: HTMLElement, text: string) {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim().includes(text),
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("renders fetched model count after refreshing the site model list", async () => {
    const fixture = createProfileManagerFixture();
    fixture.manager.fetchSiteModels = vi.fn(async () => ({
      models: ["model-a", "model-b"],
    }));
    const { container, root } = await renderAppWithFixture(fixture);

    await act(async () => {
      clickButtonByText(container, "获取模型列表");
    });

    expect(fixture.manager.fetchSiteModels).toHaveBeenCalledWith({
      url: "https://new-api.example.com/v1",
      key: "sk-relay",
    });
    expect(container.textContent).toMatch(/最近获取：.+，已获取2个模型/);
    expect(container.textContent).not.toContain("已更新当前站点模型列表");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps fetched model lists isolated by normalized site URL", async () => {
    const siteA: Profile = {
      provider: "claude",
      name: "Site A",
      url: "https://site-a.example.com/v1",
      key: "sk-site-a",
    };
    const siteB: Profile = {
      provider: "claude",
      name: "Site B",
      url: "https://site-b.example.com/v1",
      key: "sk-site-b",
    };
    const fixture = createProfileManagerFixture([siteA, siteB]);
    fixture.manager.fetchSiteModels = vi.fn(async ({ url }) => ({
      models: url.includes("site-a") ? ["a-model"] : ["b-model"],
    }));
    const { container, root } = await renderAppWithFixture(fixture);

    await act(async () => {
      clickButtonByText(container, "获取模型列表");
    });

    expect(fixture.manager.fetchSiteModels).toHaveBeenCalledWith({
      url: "https://site-a.example.com/v1",
      key: "sk-site-a",
    });
    await expect(modelOptionValues(container)).resolves.toContain("a-model");
    expect(container.textContent).toMatch(/最近获取：.+，已获取1个模型/);

    await act(async () => {
      clickButtonByText(container, "Site B");
    });

    await expect(modelOptionValues(container)).resolves.not.toContain("a-model");
    expect(container.textContent).not.toContain("已获取1个模型");

    await act(async () => {
      clickButtonByText(container, "获取模型列表");
    });

    expect(fixture.manager.fetchSiteModels).toHaveBeenLastCalledWith({
      url: "https://site-b.example.com/v1",
      key: "sk-site-b",
    });
    await expect(modelOptionValues(container)).resolves.toContain("b-model");
    await expect(modelOptionValues(container)).resolves.not.toContain("a-model");

    await act(async () => {
      clickButtonByText(container, "Site A");
    });

    await expect(modelOptionValues(container)).resolves.toContain("a-model");
    await expect(modelOptionValues(container)).resolves.not.toContain("b-model");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not show a failed model fetch error after switching to another normalized site URL", async () => {
    const siteA: Profile = {
      provider: "claude",
      name: "Site A",
      url: "https://site-a.example.com/v1",
      key: "sk-site-a",
    };
    const siteB: Profile = {
      provider: "claude",
      name: "Site B",
      url: "https://site-b.example.com/v1",
      key: "sk-site-b",
    };
    const fixture = createProfileManagerFixture([siteA, siteB]);
    fixture.manager.fetchSiteModels = vi.fn(async ({ url }) => {
      if (url.includes("site-a")) {
        throw new Error("site-a model fetch failed");
      }
      return { models: ["b-model"] };
    });
    const { container, root } = await renderAppWithFixture(fixture);

    await act(async () => {
      clickButtonByText(container, "获取模型列表");
    });

    expect(container.textContent).toContain("site-a model fetch failed");

    await act(async () => {
      clickButtonByText(container, "Site B");
    });

    expect(container.textContent).not.toContain("site-a model fetch failed");

    await act(async () => {
      clickButtonByText(container, "获取模型列表");
    });

    await expect(modelOptionValues(container)).resolves.toContain("b-model");
    expect(container.textContent).not.toContain("site-a model fetch failed");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("shares fetched model lists for profiles with the same normalized site URL", async () => {
    const siteRoot: Profile = {
      provider: "claude",
      name: "Site Root",
      url: "https://same.example.com/v1",
      key: "sk-root",
    };
    const siteCompletions: Profile = {
      provider: "claude",
      name: "Site Completions",
      url: "https://same.example.com/v1/chat/completions",
      key: "sk-completions",
    };
    const fixture = createProfileManagerFixture([siteRoot, siteCompletions]);
    fixture.manager.fetchSiteModels = vi.fn(async () => ({
      models: ["same-site-model"],
    }));
    const { container, root } = await renderAppWithFixture(fixture);

    await act(async () => {
      clickButtonByText(container, "获取模型列表");
    });

    await expect(modelOptionValues(container)).resolves.toContain("same-site-model");

    await act(async () => {
      clickButtonByText(container, "Site Completions");
    });

    expect(fixture.manager.fetchSiteModels).toHaveBeenCalledTimes(1);
    await expect(modelOptionValues(container)).resolves.toContain("same-site-model");
    expect(container.textContent).toMatch(/最近获取：.+，已获取1个模型/);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("persists session-only changes before balance testing", async () => {
    const fixture = createProfileManagerFixture();
    const { container, root } = await renderAppWithFixture(fixture);

    const balanceSessionSelect = Array.from(container.querySelectorAll("select")).find((select) =>
      Array.from(select.options).some((option) => option.value === "new" && option.textContent === "新建会话"),
    );
    expect(balanceSessionSelect).toBeInstanceOf(HTMLSelectElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      valueSetter?.call(balanceSessionSelect, "new");
      balanceSessionSelect?.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const inputs = Array.from(container.querySelectorAll("input"));
    const tokenInput = inputs.find((input) => input.placeholder === "输入后台 Access Token 或 Session");
    const userIdInput = inputs.find((input) => input.placeholder === "输入后台 User ID");

    expect(tokenInput).toBeInstanceOf(HTMLInputElement);
    expect(userIdInput).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(tokenInput, "token-a");
      tokenInput?.dispatchEvent(new Event("input", { bubbles: true }));
      valueSetter?.call(userIdInput, "42");
      userIdInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const testButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "检测余额",
    );
    expect(testButton).toBeDefined();

    await act(async () => {
      testButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(fixture.saveSiteBalanceSession).toHaveBeenCalledWith(
      "https://new-api.example.com/v1",
      {
        label: "",
        access_token: "token-a",
        user_id: "42",
      },
    );
    expect(fixture.saveProfile).toHaveBeenCalledTimes(1);
    expect(fixture.testBalance).toHaveBeenCalledTimes(1);
    expect(fixture.saveSiteBalanceSession.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.testBalance.mock.invocationCallOrder[0],
    );
    expect(fixture.saveProfile.mock.invocationCallOrder[0]).toBeLessThan(
      fixture.testBalance.mock.invocationCallOrder[0],
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("preserves edits for an existing balance session until save updates the same session", async () => {
    const sessionProfile: Profile = {
      ...baseProfile,
      balance_session_id: "sess-1",
    };
    const fixture = createProfileManagerFixture([sessionProfile], {
      "https://new-api.example.com": [
        {
          id: "sess-1",
          label: "账号1",
          base_url: "https://new-api.example.com",
          access_token: "old-token",
          user_id: "65",
          updated_at: "2026-05-05T09:00:00.000Z",
        },
      ],
    });
    const { container, root } = await renderAppWithFixture(fixture);

    const inputs = Array.from(container.querySelectorAll("input"));
    const tokenInput = inputs.find((input) => input.placeholder === "输入后台 Access Token 或 Session");
    const userIdInput = inputs.find((input) => input.placeholder === "输入后台 User ID");

    expect(tokenInput).toBeInstanceOf(HTMLInputElement);
    expect(userIdInput).toBeInstanceOf(HTMLInputElement);
    expect((tokenInput as HTMLInputElement).value).toBe("old-token");
    expect((userIdInput as HTMLInputElement).value).toBe("65");

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(tokenInput, "new-token");
      tokenInput?.dispatchEvent(new Event("input", { bubbles: true }));
      valueSetter?.call(userIdInput, "7945");
      userIdInput?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });

    expect((tokenInput as HTMLInputElement).value).toBe("new-token");
    expect((userIdInput as HTMLInputElement).value).toBe("7945");

    await act(async () => {
      clickButtonByText(container, "保存会话");
    });

    expect(fixture.saveSiteBalanceSession).toHaveBeenCalledWith(
      "https://new-api.example.com/v1",
      {
        id: "sess-1",
        label: "",
        access_token: "new-token",
        user_id: "7945",
      },
    );
    expect(fixture.saveProfile).toHaveBeenCalledWith(
      itemKey(sessionProfile),
      expect.objectContaining({
        balance_session_id: "sess-1",
      }),
      expect.any(Object),
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("loads the saved draft when switching to another existing balance session", async () => {
    const sessionProfile: Profile = {
      ...baseProfile,
      balance_session_id: "sess-1",
    };
    const fixture = createProfileManagerFixture([sessionProfile], {
      "https://new-api.example.com": [
        {
          id: "sess-1",
          label: "账号1",
          base_url: "https://new-api.example.com",
          access_token: "token-one",
          user_id: "65",
          updated_at: "2026-05-05T09:00:00.000Z",
        },
        {
          id: "sess-2",
          label: "账号2",
          base_url: "https://new-api.example.com",
          access_token: "token-two",
          user_id: "7945",
          updated_at: "2026-05-05T09:30:00.000Z",
        },
      ],
    });
    const { container, root } = await renderAppWithFixture(fixture);

    const balanceSessionSelect = Array.from(container.querySelectorAll("select")).find((select) =>
      Array.from(select.options).some((option) => option.value === "sess-2"),
    );
    expect(balanceSessionSelect).toBeInstanceOf(HTMLSelectElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      valueSetter?.call(balanceSessionSelect, "sess-2");
      balanceSessionSelect?.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    const inputs = Array.from(container.querySelectorAll("input"));
    const tokenInput = inputs.find((input) => input.placeholder === "输入后台 Access Token 或 Session");
    const userIdInput = inputs.find((input) => input.placeholder === "输入后台 User ID");

    expect((tokenInput as HTMLInputElement).value).toBe("token-two");
    expect((userIdInput as HTMLInputElement).value).toBe("7945");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
