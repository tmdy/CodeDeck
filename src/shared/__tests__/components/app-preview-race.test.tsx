// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import App from "../../../App.jsx";
import type { CommandPreview } from "../../launcher/types.js";
import { createDefaultModelMappingsState } from "../../model-mapping/config-types.js";
import { itemKey } from "../../profile/keys-internal.js";
import type { Profile, RuntimeSettings } from "../../profile/types.js";
import { defaultLocalState, type LocalState } from "../../state/local-state.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MockProfileManager = NonNullable<Window["profileManager"]>;

const profile: Profile = {
  provider: "claude",
  name: "Relay",
  url: "https://new-api.example.com/v1",
  key: "sk-relay",
};

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

function createProfileManagerFixture() {
  const runtime: RuntimeSettings = {
    cwd: "C:/workspace/initial",
    command_base: "claude",
    model: "",
    settings_file: "",
    launch_mode: "new",
    extra_args: "",
    exclude_user_settings: true,
  };
  const state = createState(runtime);
  const firstPreview = createDeferred<CommandPreview>();
  const secondPreview = createDeferred<CommandPreview>();

  const manager: MockProfileManager = {
    checkEncryptedConfig: vi.fn(async () => false),
    unlock: vi.fn(async () => ({ success: true })),
    initializeEncryption: vi.fn(async () => ({ success: true })),
    changePassphrase: vi.fn(async () => ({ success: true })),
    listProfiles: vi.fn(async () => ({
      profiles: [{ ...profile }],
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
      siteBalanceSessionsByBaseUrl: {},
    })),
    saveProfile: vi.fn(async (_targetKey, draft) => draft),
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
    pickWorkingDirectory: vi.fn(async () => undefined),
    openBaseUrl: vi.fn(async () => undefined),
    previewForDraft: vi.fn()
      .mockImplementationOnce(async () => firstPreview.promise)
      .mockImplementationOnce(async () => secondPreview.promise),
    previewForProfile: vi.fn(async () => ({ command: "", cwd: "", env: [], valid: false })),
    launch: vi.fn(async () => undefined),
    listSessions: vi.fn(async () => []),
    refreshSessions: vi.fn(async () => undefined),
    updateSessionsTabState: vi.fn(async () => undefined),
    testConnection: vi.fn(async () => undefined),
    getConnectivityState: vi.fn(async () => ({
      provider: "claude",
      profile_name: "Relay",
      base_url: "https://new-api.example.com",
      running: false,
      success: false,
      message: "",
      command_used: "",
      finished_at_display: "",
    })),
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
    onConnectivityProgress: vi.fn(() => () => undefined),
    onBalanceProgress: vi.fn(() => () => undefined),
    onUnlockError: vi.fn(() => () => undefined),
  };

  return { manager, firstPreview, secondPreview };
}

describe("App command preview", () => {
  afterEach(() => {
    delete window.profileManager;
    document.body.innerHTML = "";
  });

  it("keeps the latest draft preview when an older request resolves later", async () => {
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

    const nameInput = Array.from(container.querySelectorAll("input")).find(
      (input) => input.placeholder === "输入 Profile 名称",
    );
    expect(nameInput).toBeInstanceOf(HTMLInputElement);

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(nameInput, "Relay Next");
      nameInput?.dispatchEvent(new Event("input", { bubbles: true }));
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
});
