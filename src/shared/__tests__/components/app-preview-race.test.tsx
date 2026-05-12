// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import App from "../../../App.jsx";
import type { CommandPreview } from "../../launcher/types.js";
import { createDefaultModelMappingsState } from "../../model-mapping/config-types.js";
import { itemKey } from "../../profile/keys-internal.js";
import type { Profile, RuntimeSettings } from "../../profile/types.js";
import type { SessionSummary } from "../../services/session-service.js";
import { defaultLocalState, type LocalState } from "../../state/local-state.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MockProfileManager = NonNullable<Window["profileManager"]>;

const profile: Profile = {
  provider: "claude",
  name: "Relay",
  url: "https://new-api.example.com/v1",
  key: "sk-relay",
};
const DEFAULT_DOWNLOADS_CWD = "C:/Users/99395/Downloads";

function createState(runtime: RuntimeSettings): LocalState {
  const key = itemKey(profile);
  return {
    ...defaultLocalState(),
    selected_provider: profile.provider,
    selected_profile_key: key,
    selected_profile_key_by_provider: {
      [profile.provider]: key,
    },
    profile_order_by_provider: {
      [profile.provider]: [key],
    },
    runtime_by_profile: {
      [key]: runtime,
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createProfileManagerFixture(options: { initialCwd?: string } = {}) {
  const runtime: RuntimeSettings = {
    cwd: options.initialCwd ?? "C:/workspace/initial",
    command_base: "claude",
    model: "",
    settings_file: "",
    launch_mode: "new",
    extra_args: "",
    exclude_user_settings: true,
  };
  let state = createState(runtime);
  let currentProfile = { ...profile };
  const firstPreview = createDeferred<CommandPreview>();
  const secondPreview = createDeferred<CommandPreview>();

  const manager: MockProfileManager = {
    checkEncryptedConfig: vi.fn(async () => false),
    unlock: vi.fn(async () => ({ success: true })),
    initializeEncryption: vi.fn(async () => ({ success: true })),
    changePassphrase: vi.fn(async () => ({ success: true })),
    listProfiles: vi.fn(async () => ({
      profiles: [{ ...currentProfile }],
      state: {
        ...state,
        selected_profile_key_by_provider: { ...state.selected_profile_key_by_provider },
        profile_order_by_provider: { ...state.profile_order_by_provider },
        runtime_by_profile: { ...state.runtime_by_profile },
        balance_checks_by_profile: { ...state.balance_checks_by_profile },
        sessions_tab_scope_by_provider: { ...state.sessions_tab_scope_by_provider },
        sessions_tab_restore_profile_key_by_provider: { ...state.sessions_tab_restore_profile_key_by_provider },
      },
      siteBalanceSessionsByBaseUrl: {},
      defaultWorkingDirectory: DEFAULT_DOWNLOADS_CWD,
    })),
    saveProfile: vi.fn(async (_targetKey, draft, runtimeDraft) => {
      currentProfile = { ...draft };
      state = createState(runtimeDraft);
      return currentProfile;
    }),
    deleteProfile: vi.fn(async () => undefined),
    cloneProfile: vi.fn(async () => ({ ...profile, provider: "codex" as const })),
    selectProfile: vi.fn(async () => undefined),
    reorderProfiles: vi.fn(async () => undefined),
    activateProvider: vi.fn(async () => undefined),
    saveSiteBalanceSession: vi.fn(async (_baseUrl, draft) => ({
      id: draft.id ?? "session-1",
      label: draft.label,
      base_url: "https://new-api.example.com",
      access_token: draft.access_token,
      user_id: draft.user_id,
      updated_at: "2026-05-05T10:00:00.000Z",
    })),
    deleteSiteBalanceSession: vi.fn(async () => undefined),
    pickWorkingDirectory: vi.fn(async () => "C:/workspace/picked"),
    openBaseUrl: vi.fn(async () => undefined),
    previewForDraft: vi.fn()
      .mockImplementationOnce(async () => firstPreview.promise)
      .mockImplementationOnce(async () => secondPreview.promise)
      .mockResolvedValue({ command: "extra-preview", cwd: "", env: [], valid: false }),
    previewForProfile: vi.fn(async () => ({ command: "", cwd: "", env: [], valid: false })),
    launch: vi.fn(async () => undefined),
    listSessions: vi.fn(async () => []),
    refreshSessions: vi.fn(async () => undefined),
    updateSessionsTabState: vi.fn(async () => undefined),
    testBalance: vi.fn(async () => undefined),
    getBalanceState: vi.fn(async () => ({
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
    })),
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

  return { manager, firstPreview, secondPreview };
}

function cloneLocalStateForTest(state: LocalState): LocalState {
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

function createSession(profileKey: string, cwd: string, preview: string): SessionSummary {
  return {
    provider: "claude",
    session_id: `${profileKey}-session`,
    cwd,
    updated_at: "2026-05-07T10:00:00.000Z",
    preview,
  };
}

function createProfileSessionSwitchFixture(options: { delayAlpha?: boolean; delayBeta?: boolean } = {}) {
  const alphaProfile: Profile = {
    provider: "claude",
    name: "Alpha",
    url: "https://alpha.example.com/v1",
    key: "sk-alpha",
  };
  const betaProfile: Profile = {
    provider: "claude",
    name: "Beta",
    url: "https://beta.example.com/v1",
    key: "sk-beta",
  };
  const profiles = [alphaProfile, betaProfile];
  const alphaKey = itemKey(alphaProfile);
  const betaKey = itemKey(betaProfile);
  const alphaRuntime = {
    cwd: "C:/workspace/alpha",
    command_base: "claude",
    model: "",
    settings_file: "",
    launch_mode: "new" as const,
    extra_args: "",
    exclude_user_settings: true,
  };
  const betaRuntime = {
    ...alphaRuntime,
    cwd: "C:/workspace/beta",
  };
  const alphaSession = createSession(alphaKey, alphaRuntime.cwd, "Alpha project session");
  const betaSession = createSession(betaKey, betaRuntime.cwd, "Beta project session");
  const alphaSessions = createDeferred<SessionSummary[]>();
  const betaSessions = createDeferred<SessionSummary[]>();
  let state: LocalState = {
    ...defaultLocalState(),
    selected_provider: "claude",
    selected_profile_key: alphaKey,
    selected_profile_key_by_provider: {
      claude: alphaKey,
    },
    profile_order_by_provider: {
      claude: [alphaKey, betaKey],
    },
    runtime_by_profile: {
      [alphaKey]: alphaRuntime,
      [betaKey]: betaRuntime,
    },
  };

  const listSessions = vi.fn((request) => {
    if (request.profile_key === alphaKey && options.delayAlpha) {
      return alphaSessions.promise;
    }
    if (request.profile_key === betaKey && options.delayBeta) {
      return betaSessions.promise;
    }
    return Promise.resolve(request.profile_key === betaKey ? [betaSession] : [alphaSession]);
  });

  const manager: MockProfileManager = {
    checkEncryptedConfig: vi.fn(async () => false),
    unlock: vi.fn(async () => ({ success: true })),
    initializeEncryption: vi.fn(async () => ({ success: true })),
    changePassphrase: vi.fn(async () => ({ success: true })),
    listProfiles: vi.fn(async () => ({
      profiles: profiles.map((profile) => ({ ...profile })),
      state: cloneLocalStateForTest(state),
      siteBalanceSessionsByBaseUrl: {},
      defaultWorkingDirectory: DEFAULT_DOWNLOADS_CWD,
    })),
    saveProfile: vi.fn(async (_targetKey, draft, runtimeDraft) => {
      state = {
        ...state,
        runtime_by_profile: {
          ...state.runtime_by_profile,
          [_targetKey]: runtimeDraft,
        },
      };
      return draft;
    }),
    deleteProfile: vi.fn(async () => undefined),
    cloneProfile: vi.fn(async () => ({ ...alphaProfile })),
    selectProfile: vi.fn(async (_provider, key) => {
      state = {
        ...state,
        selected_profile_key: key,
        selected_profile_key_by_provider: {
          ...state.selected_profile_key_by_provider,
          claude: key,
        },
      };
    }),
    reorderProfiles: vi.fn(async () => undefined),
    activateProvider: vi.fn(async () => undefined),
    saveSiteBalanceSession: vi.fn(async (_baseUrl, draft) => ({
      id: draft.id ?? "site-session-1",
      label: draft.label,
      base_url: _baseUrl,
      access_token: draft.access_token,
      user_id: draft.user_id,
      updated_at: "2026-05-07T10:00:00.000Z",
    })),
    deleteSiteBalanceSession: vi.fn(async () => undefined),
    pickWorkingDirectory: vi.fn(async () => undefined),
    openBaseUrl: vi.fn(async () => undefined),
    previewForDraft: vi.fn(async () => ({ command: "", cwd: "", env: [], valid: false })),
    previewForProfile: vi.fn(async () => ({ command: "", cwd: "", env: [], valid: false })),
    launch: vi.fn(async () => undefined),
    listSessions,
    refreshSessions: vi.fn(async () => undefined),
    updateSessionsTabState: vi.fn(async () => undefined),
    testBalance: vi.fn(async () => undefined),
    getBalanceState: vi.fn(async () => ({
      provider: "claude",
      profile_name: "Alpha",
      base_url: "https://alpha.example.com",
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
    updateGlobalSettings: vi.fn(async (patch) => ({ ...state.global_settings, ...patch })),
    getParameterSettings: vi.fn(async () => state.parameter_settings),
    updateParameterSettings: vi.fn(async (patch) => ({ ...state.parameter_settings, ...patch })),
    promptUnsavedProfileAction: vi.fn(async () => "discard" as const),
    promptLaunchWithUnsavedChanges: vi.fn(async () => "save_and_launch" as const),
    onStateChanged: vi.fn(() => () => undefined),
    onBalanceProgress: vi.fn(() => () => undefined),
    onUnlockError: vi.fn(() => () => undefined),
  };

  return {
    manager,
    listSessions,
    alphaKey,
    betaKey,
    alphaSession,
    betaSession,
    alphaSessions,
    betaSessions,
  };
}

async function flushAsyncWork(times = 4) {
  for (let index = 0; index < times; index += 1) {
    await Promise.resolve();
  }
}

describe("App command preview", () => {
  afterEach(() => {
    vi.useRealTimers();
    delete window.profileManager;
    document.body.innerHTML = "";
  });

  it("debounces draft preview updates and keeps the latest response", async () => {
    vi.useFakeTimers();
    const fixture = createProfileManagerFixture();
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
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(fixture.manager.previewForDraft).toHaveBeenCalledTimes(1);

    const nameInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.placeholder === "输入 Profile 名称",
    );
    expect(nameInput).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(nameInput, "Relay Next");
      nameInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(nameInput, "Relay Next Draft");
      nameInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(299);
    });

    expect(fixture.manager.previewForDraft).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(fixture.manager.previewForDraft).toHaveBeenCalledTimes(2);

    await act(async () => {
      fixture.secondPreview.resolve({
        command: "latest-preview",
        cwd: "C:/workspace/latest",
        env: [],
        valid: true,
      });
      await Promise.resolve();
    });
    expect(container.textContent).toContain("latest-preview");

    await act(async () => {
      fixture.firstPreview.resolve({
        command: "old-preview",
        cwd: "C:/workspace/old",
        env: [],
        valid: true,
      });
      await Promise.resolve();
    });

    expect(container.textContent).toContain("latest-preview");
    expect(container.textContent).not.toContain("old-preview");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("clears stale profile sessions while loading sessions for the selected profile", async () => {
    vi.useFakeTimers();
    const fixture = createProfileSessionSwitchFixture({ delayBeta: true });
    window.profileManager = fixture.manager;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Alpha project session");

    const betaButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Beta"),
    );
    expect(betaButton).toBeDefined();

    await act(async () => {
      betaButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork();
    });

    expect(fixture.listSessions).toHaveBeenCalledWith({
      provider: "claude",
      scope: "project",
      cwd: "C:/workspace/beta",
      profile_key: fixture.betaKey,
      limit: 20,
      offset: 0,
    });
    expect(container.textContent).toContain("正在加载会话...");
    expect(container.textContent).not.toContain("Alpha project session");
    expect(container.textContent).not.toContain("当前工作目录未找到会话。");

    await act(async () => {
      fixture.betaSessions.resolve([fixture.betaSession]);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Beta project session");
    expect(container.textContent).not.toContain("Alpha project session");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("ignores late profile session responses from a previously selected profile", async () => {
    vi.useFakeTimers();
    const fixture = createProfileSessionSwitchFixture({ delayAlpha: true, delayBeta: true });
    window.profileManager = fixture.manager;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<App />);
      await flushAsyncWork();
    });

    expect(fixture.listSessions).toHaveBeenCalledWith({
      provider: "claude",
      scope: "project",
      cwd: "C:/workspace/alpha",
      profile_key: fixture.alphaKey,
      limit: 20,
      offset: 0,
    });

    const betaButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("Beta"),
    );
    expect(betaButton).toBeDefined();

    await act(async () => {
      betaButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await flushAsyncWork();
    });

    expect(fixture.listSessions).toHaveBeenCalledWith({
      provider: "claude",
      scope: "project",
      cwd: "C:/workspace/beta",
      profile_key: fixture.betaKey,
      limit: 20,
      offset: 0,
    });

    await act(async () => {
      fixture.alphaSessions.resolve([fixture.alphaSession]);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("正在加载会话...");
    expect(container.textContent).not.toContain("Alpha project session");

    await act(async () => {
      fixture.betaSessions.resolve([fixture.betaSession]);
      await flushAsyncWork();
    });

    expect(container.textContent).toContain("Beta project session");
    expect(container.textContent).not.toContain("Alpha project session");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("uses the downloads directory as the visible cwd when saved runtime cwd is empty", async () => {
    vi.useFakeTimers();
    const fixture = createProfileManagerFixture({ initialCwd: "" });
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

    const cwdInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.placeholder === "默认使用下载目录",
    );
    expect(cwdInput).toBeInstanceOf(HTMLInputElement);
    expect((cwdInput as HTMLInputElement).value).toBe(DEFAULT_DOWNLOADS_CWD);
    expect(fixture.manager.listSessions).toHaveBeenLastCalledWith({
      provider: "claude",
      scope: "project",
      cwd: DEFAULT_DOWNLOADS_CWD,
      profile_key: "claude::Relay",
      limit: 20,
      offset: 0,
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("persists the downloads directory when saving a profile without a saved runtime cwd", async () => {
    vi.useFakeTimers();
    const fixture = createProfileManagerFixture({ initialCwd: "" });
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

    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "保存",
    );
    expect(saveButton).toBeDefined();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fixture.manager.saveProfile).toHaveBeenCalledTimes(1);
    expect(fixture.manager.saveProfile).toHaveBeenLastCalledWith(
      "claude::Relay",
      expect.objectContaining({ name: "Relay" }),
      expect.objectContaining({ cwd: DEFAULT_DOWNLOADS_CWD }),
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("uses the downloads directory when launching a saved profile whose runtime cwd is empty", async () => {
    vi.useFakeTimers();
    const fixture = createProfileManagerFixture({ initialCwd: "" });
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

    const launchButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "直接启动",
    );
    expect(launchButton).toBeDefined();

    await act(async () => {
      launchButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fixture.manager.launch).toHaveBeenCalledTimes(1);
    expect(fixture.manager.launch).toHaveBeenLastCalledWith(
      expect.objectContaining({
        profile_key: "claude::Relay",
        runtime_settings: expect.objectContaining({ cwd: DEFAULT_DOWNLOADS_CWD }),
      }),
    );

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not reload profile sessions while editing cwd until the cwd is saved", async () => {
    vi.useFakeTimers();
    const fixture = createProfileManagerFixture();
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

    expect(fixture.manager.listSessions).toHaveBeenCalledTimes(1);
    expect(fixture.manager.listSessions).toHaveBeenLastCalledWith({
      provider: "claude",
      scope: "project",
      cwd: "C:/workspace/initial",
      profile_key: "claude::Relay",
      limit: 20,
      offset: 0,
    });

    const cwdInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.placeholder === "默认使用下载目录",
    );
    expect(cwdInput).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(cwdInput, "C:/workspace/draft");
      cwdInput?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fixture.manager.listSessions).toHaveBeenCalledTimes(1);

    await act(async () => {
      cwdInput?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fixture.manager.saveProfile).toHaveBeenCalledTimes(1);
    expect(fixture.manager.listSessions).toHaveBeenCalledTimes(2);
    expect(fixture.manager.listSessions).toHaveBeenLastCalledWith({
      provider: "claude",
      scope: "project",
      cwd: "C:/workspace/draft",
      profile_key: "claude::Relay",
      limit: 20,
      offset: 0,
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("reloads profile sessions after picking and saving a cwd", async () => {
    vi.useFakeTimers();
    const fixture = createProfileManagerFixture();
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

    expect(fixture.manager.listSessions).toHaveBeenCalledTimes(1);

    const pickButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "选择",
    );
    expect(pickButton).toBeDefined();

    await act(async () => {
      pickButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fixture.manager.pickWorkingDirectory).toHaveBeenCalledTimes(1);
    expect(fixture.manager.saveProfile).toHaveBeenCalledTimes(1);
    expect(fixture.manager.listSessions).toHaveBeenCalledTimes(2);
    expect(fixture.manager.listSessions).toHaveBeenLastCalledWith({
      provider: "claude",
      scope: "project",
      cwd: "C:/workspace/picked",
      profile_key: "claude::Relay",
      limit: 20,
      offset: 0,
    });

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
