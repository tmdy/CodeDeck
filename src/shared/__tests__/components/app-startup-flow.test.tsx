// @vitest-environment jsdom

import { StrictMode, type ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { resetAppStartupStateForTests } from "../../../App.jsx";
import { createDefaultModelMappingsState } from "../../model-mapping/config-types.js";
import { itemKey } from "../../profile/keys-internal.js";
import type { Profile, RuntimeSettings } from "../../profile/types.js";
import {
  type BootstrapResult,
  defaultLocalState,
  type BootstrapLocalState,
  type LocalState,
} from "../../state/local-state.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MockProfileManager = NonNullable<Window["profileManager"]>;
type UnlockResponse = Awaited<ReturnType<MockProfileManager["unlock"]>>;

const baseProfile: Profile = {
  provider: "claude",
  name: "Relay",
  url: "https://relay.example.com/v1",
  key: "sk-relay",
};

const baseRuntime: RuntimeSettings = {
  cwd: "C:/workspace",
  command_base: "claude",
  model: "",
  settings_file: "",
  launch_mode: "new",
  extra_args: "",
  extra_env: {},
  exclude_user_settings: true,
};

function createState(profile: Profile): LocalState {
  const profileKey = itemKey(profile);
  return {
    ...defaultLocalState(),
    selected_provider: profile.provider,
    selected_profile_key: profileKey,
    selected_profile_key_by_provider: {
      [profile.provider]: profileKey,
    },
    profile_order_by_provider: {
      [profile.provider]: [profileKey],
    },
    runtime_by_profile: {
      [profileKey]: { ...baseRuntime },
    },
  };
}

function cloneState(state: LocalState): LocalState {
  return {
    ...state,
    selected_profile_key_by_provider: { ...state.selected_profile_key_by_provider },
    profile_order_by_provider: { ...state.profile_order_by_provider },
    runtime_by_profile: { ...state.runtime_by_profile },
    balance_checks_by_profile: { ...state.balance_checks_by_profile },
    sessions_tab_scope_by_provider: { ...state.sessions_tab_scope_by_provider },
    sessions_tab_restore_profile_key_by_provider: { ...state.sessions_tab_restore_profile_key_by_provider },
  };
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

function createBootstrapResult(state: LocalState): BootstrapResult {
  return {
    profiles: [{ ...baseProfile }],
    state: createBootstrapState(state),
    siteBalanceSessionsByBaseUrl: {},
    defaultWorkingDirectory: "C:/Users/example/Downloads",
  };
}

function installWindowStubs() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockImplementation(() => ({
      matches: false,
      media: "(prefers-color-scheme: dark)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
  Object.defineProperty(window, "requestIdleCallback", {
    configurable: true,
    value: ((callback: IdleRequestCallback) => window.setTimeout(() => callback({
      didTimeout: false,
      timeRemaining: () => 0,
    } as IdleDeadline), 0)) as typeof window.requestIdleCallback,
  });
  Object.defineProperty(window, "cancelIdleCallback", {
    configurable: true,
    value: ((handle: number) => window.clearTimeout(handle)) as typeof window.cancelIdleCallback,
  });
}

function createProfileManagerFixture(options: {
  hasEncryptedConfig: boolean;
  unlockBootstrap?: BootstrapResult;
  unlockResult?: Promise<UnlockResponse>;
}) {
  const state = createState(baseProfile);
  const bootstrapResult = options.unlockBootstrap ?? createBootstrapResult(state);

  const manager: MockProfileManager = {
    checkEncryptedConfig: vi.fn(async () => options.hasEncryptedConfig),
    unlock: vi.fn(() => (
      options.unlockResult
        ?? Promise.resolve(options.unlockBootstrap
          ? { success: true, bootstrap: options.unlockBootstrap }
          : { success: true })
    )),
    initializeEncryption: vi.fn(async () => ({ success: true })),
    changePassphrase: vi.fn(async () => ({ success: true })),
    bootstrap: vi.fn(async () => bootstrapResult),
    listProfiles: vi.fn(async () => ({
      profiles: [{ ...baseProfile }],
      state: cloneState(state),
      siteBalanceSessionsByBaseUrl: {},
      defaultWorkingDirectory: "C:/Users/example/Downloads",
    })),
    saveProfile: vi.fn(async (_targetKey, draft) => draft),
    deleteProfile: vi.fn(async () => undefined),
    cloneProfile: vi.fn(async () => ({ ...baseProfile, provider: "codex" as const, name: "Relay (1)" })),
    selectProfile: vi.fn(async () => undefined),
    reorderProfiles: vi.fn(async () => undefined),
    activateProvider: vi.fn(async () => undefined),
    saveSiteBalanceSession: vi.fn(async (_baseUrl, draft) => ({
      id: draft.id ?? "site-session-1",
      label: draft.label,
      base_url: _baseUrl,
      access_token: draft.access_token,
      user_id: draft.user_id,
      updated_at: "2026-05-06T10:00:00.000Z",
    })),
    deleteSiteBalanceSession: vi.fn(async () => undefined),
    pickWorkingDirectory: vi.fn(async () => undefined),
    openBaseUrl: vi.fn(async () => undefined),
    previewForDraft: vi.fn(async () => ({
      command: "claude",
      cwd: "C:/workspace",
      env: [],
      valid: true,
    })),
    previewForProfile: vi.fn(async () => ({
      command: "claude",
      cwd: "C:/workspace",
      env: [],
      valid: true,
    })),
    launch: vi.fn(async () => undefined),
    listSessions: vi.fn(async () => []),
    getSessionDetail: vi.fn(async () => null),
    refreshSessions: vi.fn(async () => undefined),
    updateSessionsTabState: vi.fn(async () => undefined),
    testBalance: vi.fn(async () => undefined),
    getBalanceState: vi.fn(async () => ({
      provider: "claude",
      profile_name: baseProfile.name,
      base_url: "https://relay.example.com",
      running: false,
      supported: true,
      success: false,
      message: "",
      items: [],
      endpoint: "",
      finished_at_display: "",
    })),
    getModelMappings: vi.fn(async () => createDefaultModelMappingsState()),
    saveModelMappings: vi.fn(async (value) => value),
    fetchSiteModels: vi.fn(async () => ({ models: [] })),
    getGlobalSettings: vi.fn(async () => state.global_settings),
    updateGlobalSettings: vi.fn(async (settings) => ({ ...state.global_settings, ...settings })),
    getParameterSettings: vi.fn(async () => state.parameter_settings),
    updateParameterSettings: vi.fn(async (settings) => ({ ...state.parameter_settings, ...settings })),
    promptUnsavedProfileAction: vi.fn(async () => "save" as const),
    promptLaunchWithUnsavedChanges: vi.fn(async () => "save_and_launch" as const),
    onStateChanged: vi.fn(() => () => undefined),
    onBalanceProgress: vi.fn(() => () => undefined),
    onUnlockError: vi.fn(() => () => undefined),
  };

  return { manager };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function renderApp(node: ReactNode) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(node);
  });
  await flush();

  return { container, root };
}

async function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  await act(async () => {
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function getButtonByText(container: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === text);
  expect(button).toBeInstanceOf(HTMLButtonElement);
  return button as HTMLButtonElement;
}

describe("App startup flow", () => {
  afterEach(async () => {
    resetAppStartupStateForTests();
    delete window.profileManager;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders loading progress while startup auth status is pending", async () => {
    installWindowStubs();
    const fixture = createProfileManagerFixture({ hasEncryptedConfig: true });
    const configCheck = createDeferred<boolean>();
    fixture.manager.checkEncryptedConfig = vi.fn(() => configCheck.promise);
    window.profileManager = fixture.manager;

    const { container, root } = await renderApp(<App />);

    expect(container.querySelector(".startup-screen")).toBeTruthy();
    expect(container.querySelector(".startup-progress")).toBeTruthy();
    expect(container.textContent).toContain("正在准备解锁界面");
    expect(container.querySelector(".unlock-screen")).toBeFalsy();

    await act(async () => {
      configCheck.resolve(true);
      await Promise.resolve();
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the pre-seeded startup theme while app state is not loaded", async () => {
    installWindowStubs();
    document.documentElement.dataset.theme = "dark";
    document.documentElement.dataset.themeMode = "dark";
    const fixture = createProfileManagerFixture({ hasEncryptedConfig: true });
    const configCheck = createDeferred<boolean>();
    fixture.manager.checkEncryptedConfig = vi.fn(() => configCheck.promise);
    window.profileManager = fixture.manager;

    const { root } = await renderApp(<App />);

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.themeMode).toBe("dark");

    await act(async () => {
      configCheck.resolve(true);
      await Promise.resolve();
    });

    await act(async () => {
      root.unmount();
    });
  });

  it("shows the unlock screen first and enters the main UI in the same root after unlocking", async () => {
    installWindowStubs();
    const fixture = createProfileManagerFixture({ hasEncryptedConfig: true });
    window.profileManager = fixture.manager;

    const { container, root } = await renderApp(<App />);

    expect(container.querySelector(".unlock-screen")).toBeTruthy();
    expect(container.textContent).toContain("CodeDeck");
    expect(container.textContent).toContain("解锁");
    expect(container.textContent).not.toContain("AI CLI 工具统一管理");

    const input = container.querySelector("input[type='password']");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await setInputValue(input as HTMLInputElement, "pass-123");
    expect(getButtonByText(container, "解锁").disabled).toBe(false);

    await act(async () => {
      getButtonByText(container, "解锁").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(fixture.manager.unlock).toHaveBeenCalledWith("pass-123");
    expect(fixture.manager.bootstrap).toHaveBeenCalledTimes(1);
    expect(fixture.manager.listProfiles).not.toHaveBeenCalled();
    expect(container.querySelector(".unlock-screen")).toBeFalsy();
    expect(container.textContent).toContain("AI CLI 工具统一管理");

    await act(async () => {
      root.unmount();
    });
  });

  it("switches to unlock loading progress immediately after password submit", async () => {
    installWindowStubs();
    const unlockResult = createDeferred<UnlockResponse>();
    const fixture = createProfileManagerFixture({
      hasEncryptedConfig: true,
      unlockResult: unlockResult.promise,
    });
    window.profileManager = fixture.manager;

    const { container, root } = await renderApp(<App />);

    const input = container.querySelector("input[type='password']");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await setInputValue(input as HTMLInputElement, "pass-123");
    await act(async () => {
      getButtonByText(container, "解锁").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(fixture.manager.unlock).toHaveBeenCalledWith("pass-123");
    expect(container.querySelector(".startup-screen")).toBeTruthy();
    expect(container.querySelector(".startup-progress")).toBeTruthy();
    expect(container.textContent).toContain("正在解锁并进入");
    expect(container.querySelector("input[type='password']")).toBeFalsy();

    await act(async () => {
      unlockResult.resolve({
        success: true,
        bootstrap: createBootstrapResult(createState(baseProfile)),
      });
      await Promise.resolve();
    });
    await flush();

    expect(fixture.manager.bootstrap).not.toHaveBeenCalled();
    expect(container.querySelector(".startup-screen")).toBeFalsy();
    expect(container.textContent).toContain("AI CLI 工具统一管理");

    await act(async () => {
      root.unmount();
    });
  });

  it("hydrates directly from unlock bootstrap when the main process returns it", async () => {
    installWindowStubs();
    const fixture = createProfileManagerFixture({
      hasEncryptedConfig: true,
      unlockBootstrap: createBootstrapResult(createState(baseProfile)),
    });
    window.profileManager = fixture.manager;

    const { container, root } = await renderApp(<App />);

    const input = container.querySelector("input[type='password']");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await setInputValue(input as HTMLInputElement, "pass-123");
    await act(async () => {
      getButtonByText(container, "解锁").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(fixture.manager.unlock).toHaveBeenCalledWith("pass-123");
    expect(fixture.manager.bootstrap).not.toHaveBeenCalled();
    expect(fixture.manager.listProfiles).not.toHaveBeenCalled();
    expect(container.querySelector(".unlock-screen")).toBeFalsy();
    expect(container.textContent).toContain("AI CLI 工具统一管理");

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the create-and-enter path working for first-time startup", async () => {
    installWindowStubs();
    const fixture = createProfileManagerFixture({ hasEncryptedConfig: false });
    window.profileManager = fixture.manager;

    const { container, root } = await renderApp(<App />);

    expect(container.querySelector(".unlock-screen")).toBeTruthy();
    expect(container.textContent).toContain("创建并进入");

    const input = container.querySelector("input[type='password']");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await setInputValue(input as HTMLInputElement, "new-pass");
    expect(getButtonByText(container, "创建并进入").disabled).toBe(false);

    await act(async () => {
      getButtonByText(container, "创建并进入").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(fixture.manager.unlock).toHaveBeenCalledWith("new-pass");
    expect(fixture.manager.bootstrap).toHaveBeenCalledTimes(1);
    expect(fixture.manager.listProfiles).not.toHaveBeenCalled();
    expect(container.textContent).toContain("AI CLI 工具统一管理");

    await act(async () => {
      root.unmount();
    });
  });

  it("deduplicates the startup auth check under React StrictMode", async () => {
    installWindowStubs();
    const fixture = createProfileManagerFixture({ hasEncryptedConfig: true });
    window.profileManager = fixture.manager;

    const { root } = await renderApp(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    expect(fixture.manager.checkEncryptedConfig).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps bootstrap single-shot under React StrictMode during unlock", async () => {
    installWindowStubs();
    const fixture = createProfileManagerFixture({ hasEncryptedConfig: true });
    window.profileManager = fixture.manager;

    const { container, root } = await renderApp(
      <StrictMode>
        <App />
      </StrictMode>,
    );

    const input = container.querySelector("input[type='password']");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await setInputValue(input as HTMLInputElement, "pass-123");
    await act(async () => {
      getButtonByText(container, "解锁").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(fixture.manager.bootstrap).toHaveBeenCalledTimes(1);
    expect(fixture.manager.listProfiles).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });

  it("defers parameter settings loading until the Settings tab is opened", async () => {
    installWindowStubs();
    const fixture = createProfileManagerFixture({ hasEncryptedConfig: true });
    window.profileManager = fixture.manager;

    const { container, root } = await renderApp(<App />);

    const input = container.querySelector("input[type='password']");
    expect(input).toBeInstanceOf(HTMLInputElement);

    await setInputValue(input as HTMLInputElement, "pass-123");
    await act(async () => {
      getButtonByText(container, "解锁").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await flush();

    expect(fixture.manager.getParameterSettings).not.toHaveBeenCalled();

    await act(async () => {
      getButtonByText(container, "设置").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fixture.manager.getParameterSettings).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
