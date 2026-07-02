import type {
  PreviewAction,
  PreviewResult,
  ProjectPreviewResult,
  ProjectScanResult,
  ScanResult,
  SkillsSnapshotResult,
} from "./shared/skills-service.js";
import type {
  BatchExecutionResult,
  ProjectBatchAction,
  ProjectRecord,
  SkillHost,
} from "./shared/types.js";

// Profile Manager types
import type { Profile, ProfileKey, RuntimeSettings, GlobalSettings } from "./shared/profile/types.js";
import type { CommandPreview, LaunchRequest } from "./shared/launcher/types.js";
import type { BalanceCheckState } from "./shared/balance/types.js";
import type { ModelMappingsState } from "./shared/model-mapping/config-types.js";
import type { ParameterSettings } from "./shared/parameter/types.js";
import type { BootstrapResult, FavoriteSessionSummary, LocalState } from "./shared/state/local-state.js";
import type { ListSessionsRequest, SessionListScope } from "./shared/services/session-service.js";
import type {
  SiteBalanceSession,
  SiteBalanceSessionDraft,
  SiteBalanceSessionsByBaseUrl,
} from "./shared/balance/site-balance-sessions.js";

declare global {
  interface SkillsManagerStartupTheme {
    themeMode: "system" | "light" | "dark";
    effectiveTheme: "light" | "dark";
  }

  interface Window {
    __SKILLS_MANAGER_STARTUP_THEME__?: SkillsManagerStartupTheme | null;
    skillsManager?: {
      scan: () => Promise<ScanResult>;
      loadCachedSnapshot: () => Promise<SkillsSnapshotResult | null>;
      refreshSnapshot: () => Promise<SkillsSnapshotResult>;
      updateSkillUserTags: (skillId: string, tags: string[]) => Promise<void>;
      pickProjectDirectory: () => Promise<string | undefined>;
      selectProject: (projectPath: string) => Promise<ProjectRecord>;
      clearCurrentProjectSelection: () => Promise<void>;
      scanProject: (projectPath?: string) => Promise<ProjectScanResult | null>;
      createPreview: (action: PreviewAction, skillIds: string[]) => Promise<PreviewResult>;
      executeBatch: (action: PreviewAction, skillIds: string[]) => Promise<BatchExecutionResult>;
      createProjectPreview: (
        host: SkillHost,
        skillIds: string[],
        action: ProjectBatchAction,
      ) => Promise<ProjectPreviewResult>;
      executeProjectBatch: (
        host: SkillHost,
        skillIds: string[],
        action: ProjectBatchAction,
      ) => Promise<BatchExecutionResult>;
      rollbackLastBatch: () => Promise<BatchExecutionResult>;
    };

    profileManager?: {
      // Auth
      checkEncryptedConfig: () => Promise<boolean>;
      unlock: (passphrase: string) => Promise<{ success: boolean; bootstrap?: BootstrapResult }>;
      bootstrap: () => Promise<BootstrapResult>;
      initializeEncryption: (passphrase: string) => Promise<{ success: boolean }>;
      changePassphrase: (currentPassphrase: string, nextPassphrase: string) => Promise<{ success: boolean }>;

      // Profile CRUD
      listProfiles: () => Promise<{
        profiles: Profile[];
        state: LocalState;
        siteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl;
        defaultWorkingDirectory: string;
      }>;
      saveProfile: (targetKey: ProfileKey, draft: Profile, runtime: RuntimeSettings) => Promise<Profile>;
      deleteProfile: (key: ProfileKey) => Promise<void>;
      cloneProfile: (sourceKey: ProfileKey, targetProvider: string) => Promise<Profile>;
      selectProfile: (provider: string, key: ProfileKey) => Promise<void>;
      reorderProfiles: (provider: string, orderedKeys: ProfileKey[]) => Promise<void>;
      activateProvider: (provider: string) => Promise<void>;
      updateWorkingDirectoryFavorites?: (favorites: string[]) => Promise<string[]>;
      saveSiteBalanceSession: (baseUrl: string, draft: SiteBalanceSessionDraft) => Promise<SiteBalanceSession>;
      deleteSiteBalanceSession: (baseUrl: string, sessionId: string) => Promise<void>;
      pickWorkingDirectory: () => Promise<string | undefined>;
      openBaseUrl: (baseUrl: string) => Promise<void>;

      // Launcher
      previewForDraft: (
        draft: Profile,
        runtime: RuntimeSettings,
        mappingsState?: ModelMappingsState,
        sessionId?: string,
      ) => Promise<CommandPreview>;
      previewForProfile: (profileKey: ProfileKey) => Promise<CommandPreview>;
      launch: (request: LaunchRequest) => Promise<void>;

      // Sessions
      listSessions: (request: ListSessionsRequest) => Promise<unknown[]>;
      refreshSessions: (provider: string) => Promise<void>;
      updateSessionsTabState: (
        provider: string,
        patch: { scope?: SessionListScope; restore_profile_key?: ProfileKey },
      ) => Promise<void>;
      updateSessionFavorites?: (favorites: FavoriteSessionSummary[]) => Promise<FavoriteSessionSummary[]>;

      // Balance
      testBalance: (profileKey: ProfileKey) => Promise<void>;
      getBalanceState: (profileKey: ProfileKey) => Promise<BalanceCheckState>;

      // Model Mappings
      getModelMappings: () => Promise<ModelMappingsState>;
      saveModelMappings: (state: ModelMappingsState) => Promise<ModelMappingsState>;
      fetchSiteModels: (draft: Pick<Profile, "url" | "key">) => Promise<{ models: string[] }>;

      // Settings
      getGlobalSettings: () => Promise<GlobalSettings>;
      updateGlobalSettings: (settings: Partial<GlobalSettings>) => Promise<GlobalSettings>;
      getParameterSettings: () => Promise<ParameterSettings>;
      updateParameterSettings: (settings: Partial<ParameterSettings>) => Promise<ParameterSettings>;
      promptUnsavedProfileAction: () => Promise<"save" | "discard" | "cancel">;
      promptLaunchWithUnsavedChanges: () => Promise<"save_and_launch" | "launch_saved" | "cancel">;

      // Events
      onStateChanged: (callback: (state: LocalState) => void) => () => void;
      onBalanceProgress: (callback: (key: ProfileKey, state: BalanceCheckState) => void) => () => void;
      onUnlockError: (callback: (message: string) => void) => () => void;
      logRendererEvent?: (event: string, message: string, context?: unknown) => void;
    };
  }
}

export {};
