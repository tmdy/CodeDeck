// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import App, { resetAppStartupStateForTests } from "../../../App.jsx";
import { defaultBalanceCheckState } from "../../balance/types.js";
import { createDefaultModelMappingsState } from "../../model-mapping/config-types.js";
import { itemKey } from "../../profile/keys-internal.js";
import type { Profile, RuntimeSettings } from "../../profile/types.js";
import { defaultLocalState, type LocalState } from "../../state/local-state.js";
import type { SessionSummary } from "../../services/session-service.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MockProfileManager = NonNullable<Window["profileManager"]>;

function runtime(cwd: string, commandBase: string): RuntimeSettings {
  return {
    cwd,
    command_base: commandBase,
    model: "",
    settings_file: "",
    launch_mode: "new",
    extra_args: "",
    exclude_user_settings: true,
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

function createProviderRaceFixture() {
  const claudeProfile: Profile = {
    provider: "claude",
    name: "Claude Official",
    url: "https://claude.example.com/v1",
    key: "sk-claude",
  };
  const codexProfile: Profile = {
    provider: "codex",
    name: "Codex AI",
    url: "https://codex.example.com/v1",
    key: "sk-codex",
  };
  const profiles = [claudeProfile, codexProfile];
  const claudeKey = itemKey(claudeProfile);
  const codexKey = itemKey(codexProfile);

  let state: LocalState = {
    ...defaultLocalState(),
    selected_provider: "codex",
    selected_profile_key: codexKey,
    selected_profile_key_by_provider: {
      claude: claudeKey,
      codex: codexKey,
    },
    profile_order_by_provider: {
      claude: [claudeKey],
      codex: [codexKey],
    },
    runtime_by_profile: {
      [claudeKey]: runtime("C:/repo-claude", "claude"),
      [codexKey]: runtime("C:/repo-codex", "codex"),
    },
  };

  const codexResolvers: Array<(sessions: SessionSummary[]) => void> = [];
  const listSessions = vi.fn((request) => {
    if (request.provider === "codex") {
      return new Promise<SessionSummary[]>((resolve) => {
        codexResolvers.push(resolve);
      });
    }
    return Promise.resolve<SessionSummary[]>([
      {
        provider: "claude",
        session_id: "claude-session-1",
        cwd: "C:/repo-claude",
        updated_at: "2026-05-06T02:00:00.000Z",
        preview: "Claude current project",
      },
    ]);
  });

  const manager: MockProfileManager = {
    checkEncryptedConfig: vi.fn(async () => false),
    unlock: vi.fn(async () => ({ success: true })),
    initializeEncryption: vi.fn(async () => ({ success: true })),
    changePassphrase: vi.fn(async () => ({ success: true })),
    listProfiles: vi.fn(async () => ({
      profiles: profiles.map((profile) => ({ ...profile })),
      state: cloneState(state),
      siteBalanceSessionsByBaseUrl: {},
      defaultWorkingDirectory: "C:/Users/99395/Downloads",
    })),
    saveProfile: vi.fn(async (_targetKey, draft) => draft),
    deleteProfile: vi.fn(async () => undefined),
    cloneProfile: vi.fn(async () => ({ ...claudeProfile })),
    selectProfile: vi.fn(async (_provider, key) => {
      state = {
        ...state,
        selected_profile_key: key,
        selected_profile_key_by_provider: {
          ...state.selected_profile_key_by_provider,
          [state.selected_provider]: key,
        },
      };
    }),
    reorderProfiles: vi.fn(async () => undefined),
    activateProvider: vi.fn(async (provider) => {
      state = {
        ...state,
        selected_provider: provider,
        selected_profile_key: provider === "claude" ? claudeKey : codexKey,
      };
    }),
    saveSiteBalanceSession: vi.fn(async (_baseUrl, draft) => ({
      id: draft.id ?? "site-session-1",
      label: draft.label,
      base_url: _baseUrl,
      access_token: draft.access_token,
      user_id: draft.user_id,
      updated_at: "2026-05-06T02:00:00.000Z",
    })),
    deleteSiteBalanceSession: vi.fn(async () => undefined),
    pickWorkingDirectory: vi.fn(async () => undefined),
    openBaseUrl: vi.fn(async () => undefined),
    previewForDraft: vi.fn(async () => ({ command: "", cwd: "", env: [], valid: false })),
    previewForProfile: vi.fn(async () => ({ command: "", cwd: "", env: [], valid: false })),
    launch: vi.fn(async () => undefined),
    listSessions,
    refreshSessions: vi.fn(async () => undefined),
    updateSessionsTabState: vi.fn(async (provider, patch) => {
      state = {
        ...state,
        sessions_tab_scope_by_provider: patch.scope
          ? { ...state.sessions_tab_scope_by_provider, [provider]: patch.scope }
          : state.sessions_tab_scope_by_provider,
        sessions_tab_restore_profile_key_by_provider: patch.restore_profile_key !== undefined
          ? { ...state.sessions_tab_restore_profile_key_by_provider, [provider]: patch.restore_profile_key }
          : state.sessions_tab_restore_profile_key_by_provider,
      };
    }),
    testBalance: vi.fn(async () => undefined),
    getBalanceState: vi.fn(async () => defaultBalanceCheckState()),
    getModelMappings: vi.fn(async () => createDefaultModelMappingsState()),
    saveModelMappings: vi.fn(async (value) => value),
    fetchSiteModels: vi.fn(async () => ({ models: [] })),
    getGlobalSettings: vi.fn(async () => state.global_settings),
    updateGlobalSettings: vi.fn(async (settings) => ({ ...state.global_settings, ...settings })),
    getParameterSettings: vi.fn(async () => state.parameter_settings),
    updateParameterSettings: vi.fn(async (settings) => ({ ...state.parameter_settings, ...settings })),
    promptUnsavedProfileAction: vi.fn(async () => "discard" as const),
    promptLaunchWithUnsavedChanges: vi.fn(async () => "launch_saved" as const),
    onStateChanged: vi.fn(() => () => undefined),
    onBalanceProgress: vi.fn(() => () => undefined),
    onUnlockError: vi.fn(() => () => undefined),
  };

  return { manager, listSessions, codexResolvers };
}

function createSession(index: number): SessionSummary {
  return {
    provider: "codex",
    session_id: `codex-session-${index}`,
    cwd: `C:/repo-codex-${index}`,
    updated_at: `2026-05-06T${String(index % 24).padStart(2, "0")}:00:00.000Z`,
    preview: `Codex session ${index}`,
  };
}

function createPrefetchFixture() {
  const codexProfile: Profile = {
    provider: "codex",
    name: "Codex AI",
    url: "https://codex.example.com/v1",
    key: "sk-codex",
  };
  const codexKey = itemKey(codexProfile);
  const state: LocalState = {
    ...defaultLocalState(),
    selected_provider: "codex",
    selected_profile_key: codexKey,
    selected_profile_key_by_provider: {
      codex: codexKey,
    },
    profile_order_by_provider: {
      codex: [codexKey],
    },
    runtime_by_profile: {
      [codexKey]: runtime("C:/repo-codex", "codex"),
    },
  };
  const sessions = Array.from({ length: 60 }, (_, index) => createSession(index + 1));
  const listSessions = vi.fn(async (request) => {
    const offset = request.offset ?? 0;
    const limit = request.limit ?? 20;
    return sessions.slice(offset, offset + limit);
  });
  const manager: MockProfileManager = {
    checkEncryptedConfig: vi.fn(async () => false),
    unlock: vi.fn(async () => ({ success: true })),
    initializeEncryption: vi.fn(async () => ({ success: true })),
    changePassphrase: vi.fn(async () => ({ success: true })),
    listProfiles: vi.fn(async () => ({
      profiles: [{ ...codexProfile }],
      state: cloneState(state),
      siteBalanceSessionsByBaseUrl: {},
      defaultWorkingDirectory: "C:/Users/99395/Downloads",
    })),
    saveProfile: vi.fn(async (_targetKey, draft) => draft),
    deleteProfile: vi.fn(async () => undefined),
    cloneProfile: vi.fn(async () => ({ ...codexProfile })),
    selectProfile: vi.fn(async () => undefined),
    reorderProfiles: vi.fn(async () => undefined),
    activateProvider: vi.fn(async () => undefined),
    saveSiteBalanceSession: vi.fn(async (_baseUrl, draft) => ({
      id: draft.id ?? "site-session-1",
      label: draft.label,
      base_url: _baseUrl,
      access_token: draft.access_token,
      user_id: draft.user_id,
      updated_at: "2026-05-06T02:00:00.000Z",
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
    getBalanceState: vi.fn(async () => defaultBalanceCheckState()),
    getModelMappings: vi.fn(async () => createDefaultModelMappingsState()),
    saveModelMappings: vi.fn(async (value) => value),
    fetchSiteModels: vi.fn(async () => ({ models: [] })),
    getGlobalSettings: vi.fn(async () => state.global_settings),
    updateGlobalSettings: vi.fn(async (settings) => ({ ...state.global_settings, ...settings })),
    getParameterSettings: vi.fn(async () => state.parameter_settings),
    updateParameterSettings: vi.fn(async (settings) => ({ ...state.parameter_settings, ...settings })),
    promptUnsavedProfileAction: vi.fn(async () => "discard" as const),
    promptLaunchWithUnsavedChanges: vi.fn(async () => "launch_saved" as const),
    onStateChanged: vi.fn(() => () => undefined),
    onBalanceProgress: vi.fn(() => () => undefined),
    onUnlockError: vi.fn(() => () => undefined),
  };
  return { manager, listSessions };
}

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

async function renderUnlockedApp(manager: MockProfileManager) {
  window.profileManager = manager;
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

async function waitForText(container: HTMLElement, text: string, attempts = 12) {
  for (let index = 0; index < attempts; index += 1) {
    if (container.textContent?.includes(text)) {
      return;
    }
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function waitForButtonText(container: HTMLElement, text: string, attempts = 12) {
  for (let index = 0; index < attempts; index += 1) {
    const button = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (candidate) => candidate.textContent?.trim() === text,
    );
    if (button) {
      return button;
    }
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return undefined;
}

describe("App session history provider switching", () => {
  afterEach(() => {
    resetAppStartupStateForTests();
    delete window.profileManager;
    document.body.innerHTML = "";
  });

  it("does not let a delayed Codex session load overwrite the Claude session page", async () => {
    const fixture = createProviderRaceFixture();
    const { container, root } = await renderUnlockedApp(fixture.manager);

    const sessionsTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "会话",
    );
    expect(sessionsTab).toBeDefined();

    await act(async () => {
      sessionsTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fixture.listSessions).toHaveBeenCalledWith({
      provider: "codex",
      scope: "global_recent",
      profile_key: "codex::Codex AI",
      limit: 20,
      offset: 0,
    });

    const claudeButton = await waitForButtonText(container, "Claude");
    expect(claudeButton).toBeDefined();

    await act(async () => {
      claudeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitForText(container, "当前 Provider：claude");
    await waitForText(container, "Claude current project");
    expect(container.textContent).toContain("当前 Provider：claude");
    expect(container.textContent).toContain("Claude current project");

    await act(async () => {
      for (const resolve of fixture.codexResolvers) {
        resolve([
          {
            provider: "codex",
            session_id: "codex-session-1",
            cwd: "C:/repo-codex",
            updated_at: "2026-05-06T01:00:00.000Z",
            preview: "Body Data Sync",
          },
        ]);
      }
    });

    expect(container.textContent).toContain("当前 Provider：claude");
    expect(container.textContent).toContain("Claude current project");
    expect(container.textContent).not.toContain("Body Data Sync");
    expect(container.textContent).not.toContain("codex-session-1");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("prefetches the next Codex history page and uses it when loading more", async () => {
    const fixture = createPrefetchFixture();
    const { container, root } = await renderUnlockedApp(fixture.manager);

    const sessionsTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "会话",
    );
    expect(sessionsTab).toBeDefined();

    await act(async () => {
      sessionsTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fixture.listSessions).toHaveBeenCalledWith({
      provider: "codex",
      scope: "global_recent",
      profile_key: "codex::Codex AI",
      limit: 20,
      offset: 0,
    });
    expect(fixture.listSessions).toHaveBeenCalledWith({
      provider: "codex",
      scope: "global_recent",
      profile_key: "codex::Codex AI",
      limit: 20,
      offset: 20,
    });
    expect(container.textContent).toContain("Codex session 1");
    expect(container.textContent).not.toContain("Codex session 21");

    const callsBeforeLoadMore = fixture.listSessions.mock.calls.length;
    const loadMoreButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "加载更多 20 条",
    );
    expect(loadMoreButton).toBeDefined();

    await act(async () => {
      loadMoreButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    const offset20Calls = fixture.listSessions.mock.calls.filter(([request]) => request.offset === 20);
    expect(offset20Calls).toHaveLength(1);
    expect(fixture.listSessions.mock.calls.length).toBeGreaterThan(callsBeforeLoadMore);
    expect(fixture.listSessions).toHaveBeenCalledWith({
      provider: "codex",
      scope: "global_recent",
      profile_key: "codex::Codex AI",
      limit: 20,
      offset: 40,
    });
    expect(container.textContent).toContain("Codex session 21");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
