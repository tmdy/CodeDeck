import { contextBridge, ipcRenderer } from "electron";
import type {
  PreviewAction,
  PreviewResult,
  ProjectPreviewResult,
  ProjectScanResult,
  ScanResult,
} from "../src/shared/skills-service.js";
import type {
  BatchExecutionResult,
  ProjectBatchAction,
  ProjectRecord,
  SkillHost,
} from "../src/shared/types.js";

// ---- Skills Manager API（保持不变） ----

const skillsApi = {
  scan: (): Promise<ScanResult> => ipcRenderer.invoke("skills-manager:scan"),
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
  ): Promise<{ success: boolean; profiles?: unknown[]; state?: unknown }> =>
    ipcRenderer.invoke("profile:unlock", passphrase),
  initializeEncryption: (passphrase: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke("profile:initialize-encryption", passphrase),

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
  pickWorkingDirectory: (): Promise<string | undefined> =>
    ipcRenderer.invoke("profile:pick-working-directory"),

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
  launch: (request: unknown): Promise<void> =>
    ipcRenderer.invoke("launcher:launch", request),

  // Sessions
  listSessions: (provider: string, cwd: string): Promise<unknown[]> =>
    ipcRenderer.invoke("session:list", provider, cwd),
  refreshSessions: (provider: string): Promise<void> =>
    ipcRenderer.invoke("session:refresh", provider),

  // Connectivity
  testConnection: (profileKey: string): Promise<void> =>
    ipcRenderer.invoke("connectivity:test", profileKey),
  getConnectivityState: (profileKey: string): Promise<unknown> =>
    ipcRenderer.invoke("connectivity:get-state", profileKey),

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
  onConnectivityProgress: (
    callback: (key: string, state: unknown) => void,
  ): (() => void) => {
    const handler = (_event: unknown, key: string, state: unknown) =>
      callback(key, state);
    ipcRenderer.on("connectivity:test-progress", handler);
    return () => {
      ipcRenderer.removeListener("connectivity:test-progress", handler);
    };
  },
  onUnlockError: (callback: (message: string) => void): (() => void) => {
    const handler = (_event: unknown, message: string) => callback(message);
    ipcRenderer.on("profile:unlock-error", handler);
    return () => {
      ipcRenderer.removeListener("profile:unlock-error", handler);
    };
  },
};

contextBridge.exposeInMainWorld("skillsManager", skillsApi);
contextBridge.exposeInMainWorld("profileManager", profileApi);
