// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import App, { resetAppStartupStateForTests } from "../../../App.jsx";
import type {
  BrowserIdentitySlot,
  SiteBalanceSessionsByBaseUrl,
} from "../../balance/site-balance-sessions.js";
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
  browserIdentitySlots: BrowserIdentitySlot[] = [],
) {
  const runtime: RuntimeSettings = {
    cwd: "",
    command_base: "claude",
    model: "",
    settings_file: "",
    launch_mode: "new",
    extra_args: "",
    extra_env: {},
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
    browserIdentitySlots: browserIdentitySlots.map((slot) => ({ ...slot })),
    defaultWorkingDirectory: "C:/Users/example/Downloads",
  }));
  const saveSiteBalanceSession = vi.fn(async (_baseUrl: string, draft) => {
    const baseUrl = "https://new-api.example.com";
    const created = {
      id: draft.id ?? "sess-1",
      label: draft.label,
      base_url: baseUrl,
      access_token: draft.access_token,
      auth_kind: draft.auth_kind ?? "access_token",
      ...(draft.browser_session_id ? { browser_session_id: draft.browser_session_id } : {}),
      ...(draft.browser_slot ? { browser_slot: draft.browser_slot } : {}),
      ...(draft.browser_origin ? { browser_origin: draft.browser_origin } : {}),
      ...(draft.refresh_token ? { refresh_token: draft.refresh_token } : {}),
      ...(draft.token_expires_at ? { token_expires_at: draft.token_expires_at } : {}),
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
  const bindProfileSiteBalanceSession = vi.fn(async (
    profileKey: string,
    _baseUrl: string,
    sessionId: string,
  ) => {
    const index = profiles.findIndex((profile) => itemKey(profile) === profileKey);
    if (index < 0) throw new Error("profile not found");
    const updated = { ...profiles[index], balance_session_id: sessionId };
    profiles = profiles.map((profile, currentIndex) => (
      currentIndex === index ? updated : { ...profile }
    ));
    return updated;
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
    checkEncryptedConfig: vi.fn(async () => true),
    unlock: vi.fn(async () => ({ success: true })),
    initializeEncryption: vi.fn(async () => ({ success: true })),
    changePassphrase: vi.fn(async () => ({ success: true })),
    bootstrap: vi.fn(async () => ({
      profiles: profiles.map((profile) => ({ ...profile })),
      state: createBootstrapState(state),
      siteBalanceSessionsByBaseUrl: cloneSiteBalanceSessions(siteBalanceSessionsByBaseUrl),
      browserIdentitySlots: browserIdentitySlots.map((slot) => ({ ...slot })),
      defaultWorkingDirectory: "C:/Users/example/Downloads",
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
    bindProfileSiteBalanceSession,
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
    getSessionDetail: vi.fn(async () => null),
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
    bindProfileSiteBalanceSession,
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

  function clickExactButtonByText(container: HTMLElement, text: string) {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === text,
    );
    expect(button).toBeInstanceOf(HTMLButtonElement);
    button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  function findBalanceSessionSelect(container: HTMLElement) {
    const select = Array.from(container.querySelectorAll("select")).find((candidate) =>
      Array.from(candidate.options).some((option) => option.value === "new" && option.textContent === "新建会话"),
    );
    expect(select).toBeInstanceOf(HTMLSelectElement);
    return select as HTMLSelectElement;
  }

  async function selectBalanceSessionOption(select: HTMLSelectElement, value: string) {
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
      valueSetter?.call(select, value);
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("opens the Profile URL with the currently selected browser account", async () => {
    const profile = { ...baseProfile, balance_session_id: "browser-account" };
    const fixture = createProfileManagerFixture([profile], {
      "https://new-api.example.com": [{
        id: "browser-account",
        label: "账号1",
        base_url: "https://new-api.example.com",
        access_token: "",
        auth_kind: "browser_session",
        browser_session_id: "browser-reference",
        browser_slot: 1,
        browser_origin: "https://new-api.example.com",
        user_id: "42",
        updated_at: "2026-08-15T10:00:00.000Z",
      }],
    });
    const { container, root } = await renderAppWithFixture(fixture);

    await act(async () => {
      clickExactButtonByText(container, "打开");
      await Promise.resolve();
    });

    expect(fixture.manager.openBaseUrl).toHaveBeenCalledWith(
      "https://new-api.example.com/v1",
      "browser-account",
    );

    await act(async () => root.unmount());
    container.remove();
  });

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

  it("resets an empty new balance session draft when leaving and returning to Profiles", async () => {
    const fixture = createProfileManagerFixture();
    const { container, root } = await renderAppWithFixture(fixture);

    const balanceSessionSelect = findBalanceSessionSelect(container);
    await selectBalanceSessionOption(balanceSessionSelect, "new");

    expect(findBalanceSessionSelect(container).value).toBe("new");
    expect(container.textContent).not.toContain("Access Token 不能为空");

    await act(async () => {
      clickButtonByText(container, "设置");
    });
    await act(async () => {
      clickButtonByText(container, "Profiles");
    });

    expect(findBalanceSessionSelect(container).value).toBe("auto");
    expect(fixture.saveSiteBalanceSession).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Access Token 不能为空");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("passes an explicitly selected browser identity slot to login", async () => {
    const fixture = createProfileManagerFixture(
      undefined,
      {},
      [
        { slot: 1, browser_session_id: "slot-one" },
        { slot: 3, browser_session_id: "slot-three" },
      ],
    );
    const savedBrowserSession = {
      id: "sess-browser",
      label: "账号3",
      base_url: "https://new-api.example.com",
      access_token: "",
      auth_kind: "browser_session" as const,
      browser_session_id: "slot-three",
      browser_slot: 3,
      browser_origin: "https://new-api.example.com",
      user_id: "42",
      auto_checkin_enabled: false,
      updated_at: "2026-08-14T00:00:00.000Z",
    };
    const loginBrowserAccount = vi.fn(async () => {
      await fixture.saveSiteBalanceSession(baseProfile.url, savedBrowserSession);
      return savedBrowserSession;
    });
    fixture.manager.loginBrowserAccount = loginBrowserAccount;
    fixture.manager.getBrowserAccountStatus = vi.fn(async () => ({
      accountKey: "https://new-api.example.com::sess-browser",
      mode: "modern" as const,
      status: "ready" as const,
    }));
    const { container, root } = await renderAppWithFixture(fixture);

    await selectBalanceSessionOption(findBalanceSessionSelect(container), "new");
    const identitySelect = Array.from(container.querySelectorAll("select")).find((select) =>
      Array.from(select.options).some((option) => option.value === "slot:3"),
    );
    expect(identitySelect).toBeInstanceOf(HTMLSelectElement);
    await selectBalanceSessionOption(identitySelect as HTMLSelectElement, "slot:3");

    await act(async () => {
      clickExactButtonByText(container, "浏览器登录");
      await Promise.resolve();
    });

    expect(loginBrowserAccount).toHaveBeenCalledWith(
      "https://new-api.example.com/v1",
      3,
    );
    expect(fixture.bindProfileSiteBalanceSession).toHaveBeenCalledWith(
      itemKey(baseProfile),
      "https://new-api.example.com/v1",
      "sess-browser",
    );
    expect(fixture.saveProfile).not.toHaveBeenCalled();
    expect(findBalanceSessionSelect(container).value).toBe("sess-browser");
    expect(container.textContent).toContain("状态：已登录");

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps browser references hydrated and does not persist a new Profile during login", async () => {
    const existingBrowserSession = {
      id: "sess-existing",
      label: "账号1",
      base_url: "https://new-api.example.com",
      access_token: "",
      auth_kind: "browser_session" as const,
      browser_session_id: "slot-one",
      browser_slot: 1,
      browser_origin: "https://new-api.example.com",
      user_id: "42",
      auto_checkin_enabled: false,
      updated_at: "2026-08-14T00:00:00.000Z",
    };
    const profile = { ...baseProfile, balance_session_id: existingBrowserSession.id };
    const fixture = createProfileManagerFixture(
      [profile],
      { "https://new-api.example.com": [existingBrowserSession] },
      [{ slot: 1, browser_session_id: "slot-one" }],
    );
    const savedBrowserSession = {
      ...existingBrowserSession,
      id: "sess-new",
      label: "账号2",
      browser_session_id: "slot-two",
      browser_slot: 2,
      user_id: "84",
    };
    fixture.manager.loginBrowserAccount = vi.fn(async () => {
      await fixture.saveSiteBalanceSession(baseProfile.url, savedBrowserSession);
      return savedBrowserSession;
    });
    const { container, root } = await renderAppWithFixture(fixture);

    const createProfileButton = container.querySelector<HTMLButtonElement>(
      'button[title="新建 Profile"]',
    );
    expect(createProfileButton).toBeInstanceOf(HTMLButtonElement);
    await act(async () => {
      createProfileButton?.click();
    });

    expect(fixture.saveProfile).not.toHaveBeenCalled();
    const urlInput = container.querySelector<HTMLInputElement>('input[placeholder="https://api.example.com"]');
    expect(urlInput).toBeInstanceOf(HTMLInputElement);
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(urlInput, baseProfile.url);
      urlInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await selectBalanceSessionOption(findBalanceSessionSelect(container), "new");
    await act(async () => {
      clickExactButtonByText(container, "浏览器登录");
      await Promise.resolve();
    });

    expect(fixture.bindProfileSiteBalanceSession).not.toHaveBeenCalled();
    expect(fixture.saveProfile).not.toHaveBeenCalled();
    expect(findBalanceSessionSelect(container).value).toBe("sess-new");

    await act(async () => root.unmount());
    container.remove();
  });

  it("renders browser authentication status events from the main process", async () => {
    const profile = { ...baseProfile, balance_session_id: "sess-browser" };
    const browserSession = {
      id: "sess-browser",
      label: "账号1",
      base_url: "https://new-api.example.com",
      access_token: "",
      auth_kind: "browser_session" as const,
      browser_session_id: "slot-one",
      browser_slot: 1,
      browser_origin: "https://new-api.example.com",
      user_id: "42",
      auto_checkin_enabled: false,
      updated_at: "2026-08-14T00:00:00.000Z",
    };
    const fixture = createProfileManagerFixture(
      [profile],
      { "https://new-api.example.com": [browserSession] },
      [{ slot: 1, browser_session_id: "slot-one" }],
    );
    const accountKey = "https://new-api.example.com::sess-browser";
    let statusCallback: Parameters<
      NonNullable<MockProfileManager["onBrowserAccountStatus"]>
    >[0] | undefined;
    fixture.manager.getBrowserAccountStatus = vi.fn(async () => ({
      accountKey,
      mode: "unknown" as const,
      status: "unknown" as const,
    }));
    fixture.manager.onBrowserAccountStatus = vi.fn((callback) => {
      statusCallback = callback;
      return () => undefined;
    });
    const { container, root } = await renderAppWithFixture(fixture);

    expect(container.textContent).toContain("状态：尚未检查");
    await act(async () => {
      statusCallback?.({ accountKey, mode: "modern", status: "ready" });
    });
    expect(container.textContent).toContain("状态：已登录");

    await act(async () => root.unmount());
    container.remove();
  });

  it("saves an empty new balance session selection as API key auto without creating a session", async () => {
    const fixture = createProfileManagerFixture();
    const { container, root } = await renderAppWithFixture(fixture);

    await selectBalanceSessionOption(findBalanceSessionSelect(container), "new");

    await act(async () => {
      clickExactButtonByText(container, "保存");
    });

    expect(fixture.saveSiteBalanceSession).not.toHaveBeenCalled();
    expect(fixture.saveProfile).toHaveBeenCalledWith(
      itemKey(baseProfile),
      expect.objectContaining({
        balance_session_id: undefined,
      }),
      expect.any(Object),
    );
    expect(container.textContent).not.toContain("Access Token 不能为空");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("blocks balance testing while a new browser session is still unverified", async () => {
    const fixture = createProfileManagerFixture();
    const { container, root } = await renderAppWithFixture(fixture);

    await selectBalanceSessionOption(findBalanceSessionSelect(container), "new");
    await act(async () => {
      clickExactButtonByText(container, "检测余额");
    });

    expect(fixture.saveProfile).not.toHaveBeenCalled();
    expect(fixture.saveSiteBalanceSession).not.toHaveBeenCalled();
    expect(fixture.testBalance).not.toHaveBeenCalled();
    expect(container.textContent).toContain("请先完成浏览器登录");

    await act(async () => root.unmount());
    container.remove();
  });

  it("blocks balance testing for an empty new PAT session instead of falling back to API key auto", async () => {
    const fixture = createProfileManagerFixture();
    const { container, root } = await renderAppWithFixture(fixture);

    await selectBalanceSessionOption(findBalanceSessionSelect(container), "new");
    await act(async () => {
      clickButtonByText(container, "改用 PAT 兼容模式");
    });
    await act(async () => {
      clickExactButtonByText(container, "检测余额");
    });

    expect(fixture.saveProfile).not.toHaveBeenCalled();
    expect(fixture.saveSiteBalanceSession).not.toHaveBeenCalled();
    expect(fixture.testBalance).not.toHaveBeenCalled();
    expect(container.textContent).toContain("请先填写并保存 PAT");

    await act(async () => root.unmount());
    container.remove();
  });

  it("persists session-only changes before balance testing", async () => {
    const fixture = createProfileManagerFixture();
    const { container, root } = await renderAppWithFixture(fixture);

    await selectBalanceSessionOption(findBalanceSessionSelect(container), "new");
    await act(async () => {
      clickButtonByText(container, "改用 PAT 兼容模式");
    });

    const inputs = Array.from(container.querySelectorAll("input"));
    const tokenInput = inputs.find((input) => input.placeholder === "输入后台 Access Token 或 PAT");
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
        auth_kind: "access_token",
        refresh_token: "",
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
    const tokenInput = inputs.find((input) => input.placeholder === "输入后台 Access Token 或 PAT");
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
      clickButtonByText(container, "保存 PAT 账号");
    });

    expect(fixture.saveSiteBalanceSession).toHaveBeenCalledWith(
      "https://new-api.example.com/v1",
      {
        id: "sess-1",
        label: "",
        access_token: "new-token",
        auth_kind: "access_token",
        refresh_token: "",
        token_expires_at: undefined,
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
    const tokenInput = inputs.find((input) => input.placeholder === "输入后台 Access Token 或 PAT");
    const userIdInput = inputs.find((input) => input.placeholder === "输入后台 User ID");

    expect((tokenInput as HTMLInputElement).value).toBe("token-two");
    expect((userIdInput as HTMLInputElement).value).toBe("7945");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
