import { contextBridge, ipcRenderer } from "electron";
import type {
  PreviewAction,
  PreviewResult,
  ProjectPreviewResult,
  ProjectScanResult,
  ScanResult,
  SkillsSnapshotResult,
} from "../src/shared/skills-service.js";
import type {
  BatchExecutionResult,
  ProjectBatchAction,
  ProjectRecord,
  SkillHost,
} from "../src/shared/types.js";
import { parseSerializedStartupTheme } from "../src/shared/startup-theme.js";
import {
  LEGACY_STARTUP_THEME_ARG_PREFIX,
  STARTUP_THEME_ARG_PREFIX,
  STARTUP_THEME_GLOBAL_NAME,
} from "../src/shared/branding.js";

function getStartupThemeArgumentValue(): string | undefined {
  const currentArg = process.argv.find((arg) => arg.startsWith(STARTUP_THEME_ARG_PREFIX));
  if (currentArg) {
    return currentArg.slice(STARTUP_THEME_ARG_PREFIX.length);
  }
  const legacyArg = process.argv.find((arg) => arg.startsWith(LEGACY_STARTUP_THEME_ARG_PREFIX));
  return legacyArg?.slice(LEGACY_STARTUP_THEME_ARG_PREFIX.length);
}

const startupTheme = parseSerializedStartupTheme(
  getStartupThemeArgumentValue(),
);

// ---- Skills API（保持不变） ----

const skillsApi = {
  scan: (): Promise<ScanResult> => ipcRenderer.invoke("skills-manager:scan"),
  loadCachedSnapshot: (): Promise<SkillsSnapshotResult | null> =>
    ipcRenderer.invoke("skills-manager:load-cached-snapshot"),
  refreshSnapshot: (): Promise<SkillsSnapshotResult> =>
    ipcRenderer.invoke("skills-manager:refresh-snapshot"),
  updateSkillUserTags: (skillId: string, tags: string[]): Promise<void> =>
    ipcRenderer.invoke("skills-manager:update-skill-user-tags", skillId, tags),
  pickProjectDirectory: (): Promise<string | undefined> =>
    ipcRenderer.invoke("skills-manager:pick-project-directory"),
  selectProject: (projectPath: string): Promise<ProjectRecord> =>
    ipcRenderer.invoke("skills-manager:select-project", projectPath),
  clearCurrentProjectSelection: (): Promise<void> =>
    ipcRenderer.invoke("skills-manager:clear-current-project-selection"),
  scanProject: (projectPath?: string): Promise<ProjectScanResult | null> =>
    ipcRenderer.invoke("skills-manager:scan-project", projectPath),
  createPreview: (
    action: PreviewAction,
    skillIds: string[],
  ): Promise<PreviewResult> =>
    ipcRenderer.invoke("skills-manager:preview", action, skillIds),
  executeBatch: (
    action: PreviewAction,
    skillIds: string[],
  ): Promise<BatchExecutionResult> =>
    ipcRenderer.invoke("skills-manager:execute", action, skillIds),
  createProjectPreview: (
    host: SkillHost,
    skillIds: string[],
    action: ProjectBatchAction,
  ): Promise<ProjectPreviewResult> =>
    ipcRenderer.invoke("skills-manager:project-preview", host, skillIds, action),
  executeProjectBatch: (
    host: SkillHost,
    skillIds: string[],
    action: ProjectBatchAction,
  ): Promise<BatchExecutionResult> =>
    ipcRenderer.invoke(
      "skills-manager:project-execute",
      host,
      skillIds,
      action,
    ),
  rollbackLastBatch: (): Promise<BatchExecutionResult> =>
    ipcRenderer.invoke("skills-manager:rollback-last-batch"),
};

// ---- Profile Manager API（新增） ----

const profileApi = {
  // 加密 & 认证
  checkEncryptedConfig: (): Promise<boolean> =>
    ipcRenderer.invoke("profile:check-encrypted-config"),
  unlock: (
    passphrase: string,
  ): Promise<{ success: boolean; bootstrap?: unknown }> =>
    ipcRenderer.invoke("profile:unlock", passphrase),
  bootstrap: (): Promise<unknown> =>
    ipcRenderer.invoke("profile:bootstrap"),
  initializeEncryption: (passphrase: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("profile:initialize-encryption", passphrase),
  changePassphrase: (currentPassphrase: string, nextPassphrase: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("profile:change-passphrase", currentPassphrase, nextPassphrase),

  // Profile CRUD
  listProfiles: (): Promise<{ profiles: unknown[]; state: unknown }> =>
    ipcRenderer.invoke("profile:list"),
  saveProfile: (
    targetKey: string,
    draft: unknown,
    runtime: unknown,
  ): Promise<unknown> =>
    ipcRenderer.invoke("profile:save", targetKey, draft, runtime),
  deleteProfile: (key: string): Promise<void> =>
    ipcRenderer.invoke("profile:delete", key),
  cloneProfile: (sourceKey: string, targetProvider: string): Promise<unknown> =>
    ipcRenderer.invoke("profile:clone", sourceKey, targetProvider),
  selectProfile: (provider: string, key: string): Promise<void> =>
    ipcRenderer.invoke("profile:select", provider, key),
  reorderProfiles: (provider: string, orderedKeys: string[]): Promise<void> =>
    ipcRenderer.invoke("profile:reorder", provider, orderedKeys),
  activateProvider: (provider: string): Promise<void> =>
    ipcRenderer.invoke("profile:activate-provider", provider),
  updateWorkingDirectoryFavorites: (favorites: string[]): Promise<string[]> =>
    ipcRenderer.invoke("profile:update-working-directory-favorites", favorites),
  saveSiteBalanceSession: (baseUrl: string, draft: unknown): Promise<unknown> =>
    ipcRenderer.invoke("profile:save-site-balance-session", baseUrl, draft),
  deleteSiteBalanceSession: (baseUrl: string, sessionId: string): Promise<void> =>
    ipcRenderer.invoke("profile:delete-site-balance-session", baseUrl, sessionId),
  pickWorkingDirectory: (): Promise<string | undefined> =>
    ipcRenderer.invoke("profile:pick-working-directory"),
  openBaseUrl: (baseUrl: string): Promise<void> =>
    ipcRenderer.invoke("profile:open-base-url", baseUrl),

  // Launcher
  previewForDraft: (
    draft: unknown,
    runtime: unknown,
    mappingsState?: unknown,
    sessionId?: string,
  ): Promise<unknown> =>
    ipcRenderer.invoke("launcher:preview-for-draft", draft, runtime, mappingsState, sessionId),
  previewForProfile: (profileKey: string): Promise<unknown> =>
    ipcRenderer.invoke("launcher:preview-for-profile", profileKey),
  launch: (request: unknown): Promise<unknown> =>
    ipcRenderer.invoke("launcher:launch", request),

  // Sessions
  listSessions: (request: unknown): Promise<unknown[]> =>
    ipcRenderer.invoke("session:list", request),
  refreshSessions: (provider: string): Promise<void> =>
    ipcRenderer.invoke("session:refresh", provider),
  updateSessionsTabState: (provider: string, patch: unknown): Promise<void> =>
    ipcRenderer.invoke("session:update-tab-state", provider, patch),
  updateSessionFavorites: (favorites: unknown[]): Promise<unknown[]> =>
    ipcRenderer.invoke("session:update-favorites", favorites),

  testBalance: (profileKey: string): Promise<void> =>
    ipcRenderer.invoke("balance:test", profileKey),
  getBalanceState: (profileKey: string): Promise<unknown> =>
    ipcRenderer.invoke("balance:get-state", profileKey),
  clearBalanceState: (profileKey: string): Promise<void> =>
    ipcRenderer.invoke("balance:clear-state", profileKey),

  // Model Mappings
  getModelMappings: (): Promise<unknown> =>
    ipcRenderer.invoke("model-mapping-config:get"),
  saveModelMappings: (state: unknown): Promise<unknown> =>
    ipcRenderer.invoke("model-mapping-config:save", state),
  fetchSiteModels: (draft: unknown): Promise<unknown> =>
    ipcRenderer.invoke("model-mapping-config:fetch-site-models", draft),

  // Settings
  getGlobalSettings: (): Promise<unknown> =>
    ipcRenderer.invoke("settings:get-global"),
  updateGlobalSettings: (settings: unknown): Promise<unknown> =>
    ipcRenderer.invoke("settings:update-global", settings),
  getParameterSettings: (): Promise<unknown> =>
    ipcRenderer.invoke("parameter:get"),
  updateParameterSettings: (settings: unknown): Promise<unknown> =>
    ipcRenderer.invoke("parameter:update", settings),
  promptUnsavedProfileAction: (): Promise<"save" | "discard" | "cancel"> =>
    ipcRenderer.invoke("dialog:unsaved-profile-action"),
  promptLaunchWithUnsavedChanges: (): Promise<"save_and_launch" | "launch_saved" | "cancel"> =>
    ipcRenderer.invoke("dialog:launch-unsaved-profile"),

  // 事件监听
  onStateChanged: (callback: (state: unknown) => void): (() => void) => {
    const handler = (_event: unknown, state: unknown) => callback(state);
    ipcRenderer.on("profile:state-changed", handler);
    return () => {
      ipcRenderer.removeListener("profile:state-changed", handler);
    };
  },
  onBalanceProgress: (
    callback: (key: string, state: unknown) => void,
  ): (() => void) => {
    const handler = (_event: unknown, key: string, state: unknown) =>
      callback(key, state);
    ipcRenderer.on("balance:test-progress", handler);
    return () => {
      ipcRenderer.removeListener("balance:test-progress", handler);
    };
  },
  onUnlockError: (callback: (message: string) => void): (() => void) => {
    const handler = (_event: unknown, message: string) => callback(message);
    ipcRenderer.on("profile:unlock-error", handler);
    return () => {
      ipcRenderer.removeListener("profile:unlock-error", handler);
    };
  },
  logRendererEvent: (event: string, message: string, context?: unknown): void => {
    ipcRenderer.send("app:renderer-log", { event, message, context });
  },
};

const terminalApi = {
  attachSession: (sessionId: string): Promise<unknown> =>
    ipcRenderer.invoke("terminal:attach", sessionId),
  sendInput: (sessionId: string, data: string): Promise<void> =>
    ipcRenderer.invoke("terminal:send-input", sessionId, data),
  resizeSession: (sessionId: string, cols: number, rows: number): Promise<void> =>
    ipcRenderer.invoke("terminal:resize", sessionId, cols, rows),
  closeSession: (sessionId: string): Promise<void> =>
    ipcRenderer.invoke("terminal:close", sessionId),
  readClipboardText: (): Promise<string> =>
    ipcRenderer.invoke("terminal:read-clipboard-text"),
  writeClipboardText: (text: string): Promise<void> =>
    ipcRenderer.invoke("terminal:write-clipboard-text", text),
  onOutput: (callback: (sessionId: string, chunk: string) => void): (() => void) => {
    const handler = (_event: unknown, sessionId: string, chunk: string) => callback(sessionId, chunk);
    ipcRenderer.on("terminal:output", handler);
    return () => {
      ipcRenderer.removeListener("terminal:output", handler);
    };
  },
  onStatus: (callback: (snapshot: unknown) => void): (() => void) => {
    const handler = (_event: unknown, snapshot: unknown) => callback(snapshot);
    ipcRenderer.on("terminal:status", handler);
    return () => {
      ipcRenderer.removeListener("terminal:status", handler);
    };
  },
};

contextBridge.exposeInMainWorld("skillsManager", skillsApi);
contextBridge.exposeInMainWorld("profileManager", profileApi);
contextBridge.exposeInMainWorld("terminalManager", terminalApi);
contextBridge.exposeInMainWorld(STARTUP_THEME_GLOBAL_NAME, startupTheme);
