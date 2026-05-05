// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import App from "../../../App.jsx";
import type { SiteBalanceSessionsByBaseUrl } from "../../balance/site-balance-sessions.js";
import type { BalanceCheckState } from "../../balance/types.js";
import type { ConnectivityTestState } from "../../connectivity/types.js";
import { createDefaultModelMappingsState } from "../../model-mapping/config-types.js";
import { itemKey } from "../../profile/keys-internal.js";
import type { Profile, RuntimeSettings } from "../../profile/types.js";
import { defaultLocalState, type LocalState } from "../../state/local-state.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MockProfileManager = NonNullable<Window["profileManager"]>;

const baseProfile: Profile = {
  provider: "claude",
  name: "Relay",
  url: "https://new-api.example.com/v1",
  key: "sk-relay",
};

function createState(profile: Profile, runtime: RuntimeSettings): LocalState {
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

function createProfileManagerFixture() {
  const runtime: RuntimeSettings = {
    cwd: "",
    command_base: "claude",
    model: "",
    settings_file: "",
    launch_mode: "new",
    extra_args: "",
    exclude_user_settings: true,
  };
  let profiles: Profile[] = [{ ...baseProfile }];
  let siteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl = {};
  let state = createState(profiles[0], runtime);

  const listProfiles = vi.fn(async () => ({
    profiles: profiles.map((profile) => ({ ...profile })),
    state: {
      ...state,
      selected_profile_key_by_provider: { ...state.selected_profile_key_by_provider },
      profile_order_by_provider: { ...state.profile_order_by_provider },
      runtime_by_profile: { ...state.runtime_by_profile },
      connectivity_tests_by_profile: { ...state.connectivity_tests_by_profile },
      balance_checks_by_profile: { ...state.balance_checks_by_profile },
      sessions_tab_scope_by_provider: { ...state.sessions_tab_scope_by_provider },
      sessions_tab_restore_profile_key_by_provider: { ...state.sessions_tab_restore_profile_key_by_provider },
    },
    siteBalanceSessionsByBaseUrl: Object.fromEntries(
      Object.entries(siteBalanceSessionsByBaseUrl).map(([baseUrl, sessions]) => [
        baseUrl,
        sessions.map((session) => ({ ...session })),
      ]),
    ),
  }));
  const saveSiteBalanceSession = vi.fn(async (_baseUrl: string, draft) => {
    const created = {
      id: draft.id ?? "sess-1",
      label: draft.label,
      base_url: "https://new-api.example.com",
      access_token: draft.access_token,
      user_id: draft.user_id,
      updated_at: "2026-05-05T10:00:00.000Z",
    };
    siteBalanceSessionsByBaseUrl = {
      "https://new-api.example.com": [created],
    };
    return created;
  });
  const saveProfile = vi.fn(async (_targetKey, draft: Profile, runtimeDraft: RuntimeSettings) => {
    profiles = [{ ...draft }];
    state = createState(draft, runtimeDraft);
    return draft;
  });
  const testBalance = vi.fn(async () => undefined);
  const connectivityState: ConnectivityTestState = {
    provider: "claude",
    profile_name: "Relay",
    base_url: "https://new-api.example.com",
    running: false,
    success: false,
    message: "",
    command_used: "",
    finished_at_display: "",
  };
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
    listProfiles,
    saveProfile,
    deleteProfile: vi.fn(async () => undefined),
    cloneProfile: vi.fn(async () => ({
      ...baseProfile,
      provider: "codex" as const,
      name: "Relay (1)",
    })),
    selectProfile: vi.fn(async () => undefined),
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
    testConnection: vi.fn(async () => undefined),
    getConnectivityState: vi.fn(async () => connectivityState),
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
    onConnectivityProgress: vi.fn(() => () => undefined),
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
    delete window.profileManager;
    document.body.innerHTML = "";
  });

  it("persists session-only changes before balance testing", async () => {
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

    const newSessionButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.trim() === "新建会话",
    );
    expect(newSessionButton).toBeDefined();

    await act(async () => {
      newSessionButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const inputs = Array.from(container.querySelectorAll("input"));
    const remarkInput = inputs.find((input) => input.placeholder === "例如 主账号 / 运营后台");
    const tokenInput = inputs.find((input) => input.placeholder === "输入后台 Access Token 或 Session");
    const userIdInput = inputs.find((input) => input.placeholder === "输入后台 User ID");

    expect(remarkInput).toBeInstanceOf(HTMLInputElement);
    expect(tokenInput).toBeInstanceOf(HTMLInputElement);
    expect(userIdInput).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(remarkInput, "后台 A");
      remarkInput?.dispatchEvent(new Event("input", { bubbles: true }));
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
        label: "后台 A",
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
});
