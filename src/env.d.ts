import type {
  PreviewAction,
  PreviewResult,
  ProjectPreviewResult,
  ProjectScanResult,
  ScanResult,
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
import type { ConnectivityTestState } from "./shared/connectivity/types.js";
import type { ModelMappingEntry } from "./shared/model-mapping/types.js";
import type { ParameterSettings } from "./shared/parameter/types.js";
import type { LocalState } from "./shared/state/local-state.js";

declare global {
  interface Window {
    skillsManager?: {
      scan: () => Promise<ScanResult>;
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
      unlock: (passphrase: string) => Promise<{ success: boolean }>;
      initializeEncryption: (passphrase: string) => Promise<{ success: boolean }>;

      // Profile CRUD
      listProfiles: () => Promise<{ profiles: Profile[]; state: LocalState }>;
      saveProfile: (targetKey: ProfileKey, draft: Profile, runtime: RuntimeSettings) => Promise<Profile>;
      deleteProfile: (key: ProfileKey) => Promise<void>;
      cloneProfile: (sourceKey: ProfileKey, targetProvider: string) => Promise<Profile>;
      selectProfile: (provider: string, key: ProfileKey) => Promise<void>;
      reorderProfiles: (provider: string, orderedKeys: ProfileKey[]) => Promise<void>;
      activateProvider: (provider: string) => Promise<void>;

      // Launcher
      previewForDraft: (draft: Profile, runtime: RuntimeSettings) => Promise<CommandPreview>;
      previewForProfile: (profileKey: ProfileKey) => Promise<CommandPreview>;
      launch: (request: LaunchRequest) => Promise<void>;

      // Sessions
      listSessions: (provider: string, cwd: string) => Promise<unknown[]>;
      refreshSessions: (provider: string) => Promise<void>;

      // Connectivity
      testConnection: (profileKey: ProfileKey) => Promise<void>;
      getConnectivityState: (profileKey: ProfileKey) => Promise<ConnectivityTestState>;

      // Model Mapping
      listModelMappings: () => Promise<ModelMappingEntry[]>;
      addModelMapping: (entry: Omit<ModelMappingEntry, "id">) => Promise<ModelMappingEntry>;
      updateModelMapping: (id: string, update: Partial<ModelMappingEntry>) => Promise<ModelMappingEntry | null>;
      deleteModelMapping: (id: string) => Promise<boolean>;
      resolveModel: (provider: string, model: string) => Promise<string>;

      // Settings
      getGlobalSettings: () => Promise<GlobalSettings>;
      updateGlobalSettings: (settings: Partial<GlobalSettings>) => Promise<GlobalSettings>;
      getParameterSettings: () => Promise<ParameterSettings>;
      updateParameterSettings: (settings: Partial<ParameterSettings>) => Promise<ParameterSettings>;

      // Events
      onStateChanged: (callback: (state: LocalState) => void) => () => void;
      onConnectivityProgress: (callback: (key: ProfileKey, state: ConnectivityTestState) => void) => () => void;
      onUnlockError: (callback: (message: string) => void) => () => void;
    };
  }
}

export {};