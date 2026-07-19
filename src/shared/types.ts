export type SkillHost = "codex" | "claude";

export type SkillStatus = "active" | "inactive" | "conflict" | "readonly";
export type SkillLocation = "active-root" | "library-root" | "conflict" | "readonly";

export interface SkillRecord {
  host: SkillHost;
  skillId: string;
  directoryName: string;
  displayName: string;
  description: string;
  summary: string;
  tags: string[];
  userTags: string[];
  hasUserTags: boolean;
  originalDescription?: string;
  originalSummary?: string;
  originalTags?: string[];
  hasSkillMd: boolean;
  isSpecialDir: boolean;
  status: SkillStatus;
  location: SkillLocation;
  sourcePath: string;
  expectedActivePath: string;
  expectedLibraryPath: string;
  sizeSkillMdBytes: number;
  sizeBodyBytes: number;
  sizeTotalBytes: number;
  lastScannedAt: string;
  notes: string[];
}

export interface HostPaths {
  host: SkillHost;
  activeRoot: string;
  libraryRoot: string;
}

export interface AppPaths {
  projectRoot: string;
  manifestPath: string;
  projectsPath: string;
  translationsPath: string;
  tagsPath: string;
  operationsRoot: string;
  backupsRoot: string;
  hosts: Record<SkillHost, HostPaths>;
}

export interface ProjectRecord {
  projectId: string;
  projectName: string;
  projectPath: string;
  createdAt: string;
  lastUsedAt: string;
}

export interface ProjectHostState {
  codex: {
    skillIds: string[];
    managedSkillIds?: string[];
  };
  claude: {
    skillIds: string[];
    managedSkillIds?: string[];
  };
}

export interface ProjectSkillStatus {
  isEnabledInProject: boolean;
  projectTargetPath: string;
  projectConflict: boolean;
}

export interface ProjectSelectionState {
  version: 1;
  currentProjectId?: string;
  records: ProjectRecord[];
  hostStates: Record<string, ProjectHostState>;
}

export interface SkillTranslationEntry {
  translatedDisplayName?: string;
  translatedDescription?: string;
  translatedSummary?: string;
}

export interface SkillTranslationsFile {
  version: 1;
  updatedAt: string;
  entries: Record<string, SkillTranslationEntry>;
}

export interface SkillUserTagsFile {
  version: 1;
  updatedAt: string;
  entries: Record<string, string[]>;
}

export interface FileScanSignature {
  exists: boolean;
  mtimeMs?: number;
  size?: number;
}

export interface DirectoryEntryScanSignature {
  name: string;
  type: "directory" | "file" | "other";
}

export interface SkillScanSignature {
  sourcePath: string;
  expectedActivePath: string;
  expectedLibraryPath: string;
  status: SkillStatus;
  location: SkillLocation;
  inActive: boolean;
  inLibrary: boolean;
  sourceDirectoryMtimeMs: number;
  skillMd: FileScanSignature;
  readme: FileScanSignature;
  topLevelEntries: DirectoryEntryScanSignature[];
}

export interface SkillScanCacheEntry {
  signature: SkillScanSignature;
  scannedAt: string;
}

export interface ScanCache {
  version: 1 | 2;
  entries: Record<string, SkillScanCacheEntry>;
}

export interface ScanManifest {
  version: 1;
  projectRoot: string;
  lastScannedAt: string;
  lastSuccessfulOperationId?: string;
  records: SkillRecord[];
  scanCache?: ScanCache;
}

export interface HostSummary {
  host: SkillHost;
  counts: Record<SkillStatus, number>;
  totalBytes: number;
  readonlyBytes: number;
}

export interface ProjectSkillRecord extends SkillRecord {
  projectStatus: ProjectSkillStatus;
}

export interface PreviewItem {
  skillId: string;
  host: SkillHost;
  directoryName: string;
  sourcePath: string;
  targetPath: string;
  sizeTotalBytes: number;
  statusBefore: SkillStatus;
  statusAfter: SkillStatus;
}

export type ProjectBatchAction = "copy-to-project" | "remove-from-project";

export interface ProjectPreviewItem {
  skillId: string;
  host: SkillHost;
  directoryName: string;
  sourcePath: string;
  targetPath: string;
  sizeTotalBytes: number;
  isEnabledInProjectBefore: boolean;
  isEnabledInProjectAfter: boolean;
}

export interface OperationPlan {
  operationId: string;
  action: "enable" | "disable" | "rollback-last-batch" | ProjectBatchAction;
  createdAt: string;
  items: Array<PreviewItem | ProjectPreviewItem>;
}

export interface OperationResultItem extends PreviewItem {
  success: boolean;
  error?: string;
}

export interface ProjectOperationResultItem extends ProjectPreviewItem {
  success: boolean;
  error?: string;
}

export interface BatchExecutionResult {
  operationId: string;
  action: OperationPlan["action"];
  startedAt: string;
  finishedAt: string;
  success: boolean;
  rolledBack: boolean;
  results: Array<OperationResultItem | ProjectOperationResultItem>;
  message: string;
}
