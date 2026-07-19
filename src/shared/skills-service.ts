import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import {
  copyDirectory,
  computeDirectorySizeStats,
  ensureDirectory,
  listDirectories,
  moveDirectory,
  pathExists,
  readJson,
  readUtf8IfExists,
  writeJson,
} from "./filesystem.js";
import { parseSkillMarkdown } from "./skill-parser.js";
import type {
  AppPaths,
  BatchExecutionResult,
  HostSummary,
  OperationPlan,
  OperationResultItem,
  ProjectBatchAction,
  ProjectHostState,
  ProjectOperationResultItem,
  ProjectPreviewItem,
  ProjectRecord,
  ProjectSelectionState,
  ProjectSkillRecord,
  ProjectSkillStatus,
  PreviewItem,
  DirectoryEntryScanSignature,
  FileScanSignature,
  ScanManifest,
  SkillHost,
  SkillLocation,
  SkillRecord,
  SkillScanCacheEntry,
  SkillScanSignature,
  SkillStatus,
  SkillTranslationEntry,
  SkillTranslationsFile,
  SkillUserTagsFile,
} from "./types.js";
import { buildSummary } from "./summary.js";
import { normalizeUserTags } from "./record-search.js";
import { resolveRecordSourcePath, resolveSkillPlacement } from "./skill-location.js";

export type PreviewAction = "enable" | "disable";

export interface ScanResult {
  scannedAt: string;
  records: SkillRecord[];
  overview: HostSummary[];
  manifestPath: string;
  projectRoot: string;
}

export interface PreviewResult {
  action: PreviewAction;
  generatedAt: string;
  items: PreviewItem[];
  blockedSkillIds: string[];
  overview: Array<{
    host: SkillHost;
    movableCount: number;
    readonlyCount: number;
    conflictCount: number;
    projectedBytesMoved: number;
  }>;
}

export interface ProjectScanResult {
  currentProject: ProjectRecord;
  hostStates: ProjectHostState;
  records: ProjectSkillRecord[];
}

export interface SkillsSnapshotResult {
  scan: ScanResult;
  projectScan: ProjectScanResult | null;
  source: "cache" | "fresh";
}

export interface ProjectPreviewResult {
  action: ProjectBatchAction;
  host: SkillHost;
  generatedAt: string;
  items: ProjectPreviewItem[];
  blockedSkillIds: string[];
  project: ProjectRecord;
}

interface CodeDeckSkillsServiceOptions {
  moveDirectory?: typeof moveDirectory;
  copyDirectory?: typeof copyDirectory;
}

interface EnvironmentBaseSnapshot {
  scannedAt: string;
  records: SkillRecord[];
}

interface SkillScanCandidate {
  host: SkillHost;
  directoryName: string;
  activePath: string;
  libraryPath: string;
  inActive: boolean;
  inLibrary: boolean;
  sourcePath: string;
  status: SkillStatus;
  location: SkillLocation;
  notes: string[];
}

interface SkillScanItem {
  baseRecord: SkillRecord;
  record: SkillRecord;
  cacheEntry: SkillScanCacheEntry;
}

const SKILL_SCAN_CONCURRENCY = 8;
const SKILL_SCAN_CACHE_VERSION = 2;
const SKILL_SIZE_SCAN_LIMITS = {
  maxFiles: 5000,
  maxDirectories: 1000,
} as const;
const SIZE_SCAN_TRUNCATED_NOTE = "目录体积统计达到扫描上限，显示值可能低于实际大小。";

export function resolveDefaultPaths(projectRoot: string): AppPaths {
  const codexActive = path.join(os.homedir(), ".codex", "skills");
  const claudeActive = path.join(os.homedir(), ".claude", "skills");

  return {
    projectRoot,
    manifestPath: path.join(projectRoot, "app-data", "manifest.json"),
    projectsPath: path.join(projectRoot, "app-data", "projects.json"),
    translationsPath: path.join(projectRoot, "app-data", "translations.json"),
    tagsPath: path.join(projectRoot, "app-data", "tags.json"),
    operationsRoot: path.join(projectRoot, "app-data", "operations"),
    backupsRoot: path.join(projectRoot, "app-data", "backups"),
    hosts: {
      codex: {
        host: "codex",
        activeRoot: codexActive,
        libraryRoot: path.join(projectRoot, "library", "codex"),
      },
      claude: {
        host: "claude",
        activeRoot: claudeActive,
        libraryRoot: path.join(projectRoot, "library", "claude"),
      },
    },
  };
}

function createSkillId(host: SkillHost, directoryName: string): string {
  return `${host}:${directoryName}`;
}

async function collectMetadata(
  host: SkillHost,
  directoryName: string,
  sourcePath: string,
  expectedActivePath: string,
  expectedLibraryPath: string,
  status: SkillStatus,
  location: SkillLocation,
  notes: string[],
): Promise<SkillRecord> {
  const skillMdPath = path.join(sourcePath, "SKILL.md");
  const readmePath = path.join(sourcePath, "README.md");
  const skillMd = await readUtf8IfExists(skillMdPath);
  const fallbackReadme = await readUtf8IfExists(readmePath);
  const hasSkillMd = typeof skillMd === "string";
  const isSpecialDir = !hasSkillMd || directoryName.startsWith(".") || directoryName.startsWith("_");
  const stats = await computeDirectorySizeStats(sourcePath, SKILL_SIZE_SCAN_LIMITS);
  if (stats.truncated) {
    notes.push(SIZE_SCAN_TRUNCATED_NOTE);
  }

  let displayName = directoryName;
  let description = "";
  let tags: string[] = [];
  let summary = "";

  if (skillMd) {
    const parsed = parseSkillMarkdown(directoryName, skillMd);
    displayName = parsed.displayName;
    description = parsed.description;
    tags = parsed.tags;
    summary = parsed.summary;
  } else {
    description = fallbackReadme?.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
    summary = buildSummary({
      directoryName,
      description,
      body: fallbackReadme,
      isSpecialDir: true,
    });
  }

  return {
    host,
    skillId: createSkillId(host, directoryName),
    directoryName,
    displayName,
    description,
    summary,
    tags,
    userTags: [],
    hasUserTags: false,
    hasSkillMd,
    isSpecialDir,
    status,
    location,
    sourcePath,
    expectedActivePath,
    expectedLibraryPath,
    sizeSkillMdBytes: stats.skillMdBytes,
    sizeBodyBytes: stats.bodyBytes,
    sizeTotalBytes: stats.totalBytes,
    lastScannedAt: new Date().toISOString(),
    notes,
  };
}

function applyTranslations(record: SkillRecord, translation?: SkillTranslationEntry): SkillRecord {
  if (!translation) {
    return record;
  }

  return {
    ...record,
    displayName: translation.translatedDisplayName?.trim() || record.displayName,
    description: translation.translatedDescription?.trim() || record.description,
    summary: translation.translatedSummary?.trim() || record.summary,
    originalDescription: record.description,
    originalSummary: record.summary,
    originalTags: [...record.tags],
  };
}

function signaturesEqual(left: SkillScanSignature | undefined, right: SkillScanSignature): boolean {
  if (!left) {
    return false;
  }

  return left.sourcePath === right.sourcePath
    && left.expectedActivePath === right.expectedActivePath
    && left.expectedLibraryPath === right.expectedLibraryPath
    && left.status === right.status
    && left.location === right.location
    && left.inActive === right.inActive
    && left.inLibrary === right.inLibrary
    && left.sourceDirectoryMtimeMs === right.sourceDirectoryMtimeMs
    && fileSignaturesEqual(left.skillMd, right.skillMd)
    && fileSignaturesEqual(left.readme, right.readme)
    && directoryEntrySignatureArraysEqual(left.topLevelEntries, right.topLevelEntries);
}

function fileSignaturesEqual(left: FileScanSignature, right: FileScanSignature): boolean {
  return left.exists === right.exists
    && left.mtimeMs === right.mtimeMs
    && left.size === right.size;
}

function directoryEntrySignaturesEqual(
  left: DirectoryEntryScanSignature,
  right: DirectoryEntryScanSignature,
): boolean {
  return left.name === right.name && left.type === right.type;
}

function directoryEntrySignatureArraysEqual(
  left: readonly DirectoryEntryScanSignature[],
  right: readonly DirectoryEntryScanSignature[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((entry, index) => directoryEntrySignaturesEqual(entry, right[index]));
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function run(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => run()));
  return results;
}

async function buildFileSignature(targetPath: string): Promise<SkillScanSignature["skillMd"]> {
  try {
    const stat = await fs.stat(targetPath);
    return {
      exists: true,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { exists: false };
    }
    throw error;
  }
}

async function buildSkillScanSignature(candidate: SkillScanCandidate): Promise<SkillScanSignature> {
  const [sourceStat, entries, skillMd, readme] = await Promise.all([
    fs.stat(candidate.sourcePath),
    fs.readdir(candidate.sourcePath, { withFileTypes: true }),
    buildFileSignature(path.join(candidate.sourcePath, "SKILL.md")),
    buildFileSignature(path.join(candidate.sourcePath, "README.md")),
  ]);

  return {
    sourcePath: candidate.sourcePath,
    expectedActivePath: candidate.activePath,
    expectedLibraryPath: candidate.libraryPath,
    status: candidate.status,
    location: candidate.location,
    inActive: candidate.inActive,
    inLibrary: candidate.inLibrary,
    sourceDirectoryMtimeMs: sourceStat.mtimeMs,
    skillMd,
    readme,
    topLevelEntries: entries
      .map((entry) => ({
        name: entry.name,
        type: entry.isDirectory() ? "directory" as const : entry.isFile() ? "file" as const : "other" as const,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export class CodeDeckSkillsService {
  private readonly moveDirectoryFn: typeof moveDirectory;
  private readonly copyDirectoryFn: typeof copyDirectory;
  private inFlightEnvironmentScan: Promise<ScanResult> | null = null;
  private recentEnvironmentBaseSnapshot: EnvironmentBaseSnapshot | null = null;

  constructor(
    private readonly paths: AppPaths,
    options: CodeDeckSkillsServiceOptions = {},
  ) {
    this.moveDirectoryFn = options.moveDirectory ?? moveDirectory;
    this.copyDirectoryFn = options.copyDirectory ?? copyDirectory;
  }

  async scanEnvironment(): Promise<ScanResult> {
    if (this.inFlightEnvironmentScan) {
      return this.inFlightEnvironmentScan;
    }

    const scanPromise = this.performEnvironmentScan();
    this.inFlightEnvironmentScan = scanPromise;

    try {
      return await scanPromise;
    } finally {
      if (this.inFlightEnvironmentScan === scanPromise) {
        this.inFlightEnvironmentScan = null;
      }
    }
  }

  private async performEnvironmentScan(): Promise<ScanResult> {
    await this.ensureRoots();
    const translations = await this.loadTranslations();
    const userTags = await this.loadUserTags();
    const manifest = await this.loadManifest();
    const manifestRecords = new Map((manifest?.records ?? []).map((record) => [record.skillId, record]));
    const manifestCache = manifest?.scanCache?.version === SKILL_SCAN_CACHE_VERSION ? manifest.scanCache.entries : {};

    const candidates: SkillScanCandidate[] = [];
    const hostDirectoryLists = await Promise.all((["codex", "claude"] as const).map(async (host) => {
      const hostPaths = this.paths.hosts[host];
      const [activeNames, libraryNames] = await Promise.all([
        listDirectories(hostPaths.activeRoot),
        listDirectories(hostPaths.libraryRoot),
      ]);
      return { host, hostPaths, activeNames, libraryNames };
    }));

    for (const { host, hostPaths, activeNames, libraryNames } of hostDirectoryLists) {
      const activeNameSet = new Set(activeNames);
      const libraryNameSet = new Set(libraryNames);
      const names = [...new Set([...activeNames, ...libraryNames])].sort((left, right) => left.localeCompare(right));

      for (const directoryName of names) {
        const activePath = path.join(hostPaths.activeRoot, directoryName);
        const libraryPath = path.join(hostPaths.libraryRoot, directoryName);
        const inActive = activeNameSet.has(directoryName);
        const inLibrary = libraryNameSet.has(directoryName);
        const notes: string[] = [];
        const placement = resolveSkillPlacement({
          inActive,
          inLibrary,
          isReadonly: false,
        });
        let sourcePath = inActive ? activePath : libraryPath;

        if (placement.location === "conflict") {
          sourcePath = activePath;
          notes.push("宿主目录与中央仓同时存在同名目录，需人工处理冲突。");
        } else if (placement.location === "library-root") {
          sourcePath = libraryPath;
        }

        candidates.push({
          host,
          directoryName,
          activePath,
          libraryPath,
          inActive,
          inLibrary,
          sourcePath,
          status: placement.status,
          location: placement.location,
          notes,
        });
      }
    }

    const scanItems = await mapWithConcurrency(candidates, SKILL_SCAN_CONCURRENCY, async (candidate): Promise<SkillScanItem> => {
      const skillId = createSkillId(candidate.host, candidate.directoryName);
      const signature = await buildSkillScanSignature(candidate);
      const cachedRecord = manifestRecords.get(skillId);
      const cachedEntry = manifestCache[skillId];
      let record: SkillRecord;

      if (cachedRecord && signaturesEqual(cachedEntry?.signature, signature)) {
        record = cachedRecord;
      } else {
        record = await collectMetadata(
          candidate.host,
          candidate.directoryName,
          candidate.sourcePath,
          candidate.activePath,
          candidate.libraryPath,
          candidate.status,
          candidate.location,
          [...candidate.notes],
        );

        if (record.isSpecialDir) {
          const readonlyPlacement = resolveSkillPlacement({
            inActive: candidate.inActive,
            inLibrary: candidate.inLibrary,
            isReadonly: true,
          });
          record = {
            ...record,
            status: readonlyPlacement.status,
            location: readonlyPlacement.location,
          };
          if (record.notes.length === 0) {
            record.notes.push("系统/共享目录，V1 不允许移动。");
          }
        }
      }

      const baseRecord = {
        ...record,
        userTags: [],
        hasUserTags: false,
      };
      const translatedRecord = applyTranslations(baseRecord, translations?.entries[baseRecord.skillId]);
      const mergedUserTags = userTags?.entries[translatedRecord.skillId] ?? [];
      return {
        baseRecord,
        record: {
          ...translatedRecord,
          userTags: mergedUserTags,
          hasUserTags: mergedUserTags.length > 0,
        },
        cacheEntry: {
          signature,
          scannedAt: new Date().toISOString(),
        },
      };
    });

    const scannedAt = new Date().toISOString();
    const normalizedRecords = scanItems.map(({ record }) => ({
      ...record,
      lastScannedAt: scannedAt,
    }));
    const nextManifestRecords = scanItems.map(({ baseRecord }) => ({
      ...baseRecord,
      lastScannedAt: scannedAt,
    }));
    const scanCacheEntries = Object.fromEntries(
      scanItems.map(({ record, cacheEntry }) => [record.skillId, {
        ...cacheEntry,
        scannedAt,
      }]),
    );

    const overview = this.buildOverview(normalizedRecords);
    const nextManifest: ScanManifest = {
      version: 1,
      projectRoot: this.paths.projectRoot,
      lastScannedAt: scannedAt,
      lastSuccessfulOperationId: manifest?.lastSuccessfulOperationId,
      records: nextManifestRecords,
      scanCache: {
        version: SKILL_SCAN_CACHE_VERSION,
        entries: scanCacheEntries,
      },
    };
    await writeJson(this.paths.manifestPath, nextManifest);
    this.recentEnvironmentBaseSnapshot = {
      scannedAt,
      records: nextManifestRecords,
    };

    return {
      scannedAt,
      records: normalizedRecords,
      overview,
      manifestPath: this.paths.manifestPath,
      projectRoot: this.paths.projectRoot,
    };
  }

  async loadCachedSnapshot(): Promise<SkillsSnapshotResult | null> {
    const scan = await this.loadRecentEnvironmentScan();
    if (!scan) {
      return null;
    }

    const projectScan = await this.buildCachedProjectScanFromRecords(scan.records);

    return {
      scan,
      projectScan,
      source: "cache",
    };
  }

  async refreshSnapshot(): Promise<SkillsSnapshotResult> {
    const scan = await this.scanEnvironment();
    const projectScan = await this.buildFreshProjectScanFromRecords(scan.records);

    return {
      scan,
      projectScan,
      source: "fresh",
    };
  }

  async selectProject(projectPath: string): Promise<ProjectRecord> {
    if (!projectPath.trim()) {
      throw new Error("项目路径不能为空。");
    }

    await ensureDirectory(projectPath);
    const projects = await this.loadProjectsState();
    const normalizedProjectPath = path.resolve(projectPath);
    const now = new Date().toISOString();
    const existing = projects.records.find((item) => path.resolve(item.projectPath) === normalizedProjectPath);

    const project: ProjectRecord = existing
      ? {
          ...existing,
          lastUsedAt: now,
        }
      : {
          projectId: `project-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
          projectName: path.basename(normalizedProjectPath) || normalizedProjectPath,
          projectPath: normalizedProjectPath,
          createdAt: now,
          lastUsedAt: now,
        };

    const records = existing
      ? projects.records.map((item) => (item.projectId === existing.projectId ? project : item))
      : [...projects.records, project];
    const nextState: ProjectSelectionState = {
      version: 1,
      currentProjectId: project.projectId,
      records,
      hostStates: {
        ...projects.hostStates,
        [project.projectId]: projects.hostStates[project.projectId] ?? {
          codex: { skillIds: [], managedSkillIds: [] },
          claude: { skillIds: [], managedSkillIds: [] },
        },
      },
    };
    await this.persistProjectsState(nextState);
    return project;
  }

  async clearCurrentProjectSelection(): Promise<void> {
    const projects = await this.loadProjectsState();
    await this.persistProjectsState({
      ...projects,
      currentProjectId: undefined,
    });
  }

  async updateSkillUserTags(skillId: string, tags: string[]): Promise<void> {
    const normalizedTags = normalizeUserTags(tags);
    const current = (await this.loadUserTags()) ?? {
      version: 1 as const,
      updatedAt: new Date().toISOString(),
      entries: {},
    };
    const nextEntries = { ...current.entries };

    if (normalizedTags.length > 0) {
      nextEntries[skillId] = normalizedTags;
    } else {
      delete nextEntries[skillId];
    }

    await writeJson(this.paths.tagsPath, {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries: nextEntries,
    } satisfies SkillUserTagsFile);
  }

  async scanProjectSkills(projectPath?: string): Promise<ProjectScanResult | null> {
    const project = projectPath ? await this.selectProject(projectPath) : await this.getCurrentProject();
    if (!project) {
      return null;
    }
    const scan = await this.loadRecentEnvironmentScan();
    if (!scan) {
      throw new Error("请先刷新全局 Skills 后再刷新项目状态。");
    }
    const projectsState = await this.loadProjectsState();
    const hostStates = await this.buildProjectHostState(project.projectPath, projectsState.hostStates[project.projectId]);
    await this.updateStoredProjectHostState(project.projectId, hostStates);

    return {
      currentProject: project,
      hostStates,
      records: scan.records.map((record) => ({
        ...record,
        projectStatus: this.buildProjectSkillStatus(record, project.projectPath, hostStates),
      })),
    };
  }

  async createProjectPreview(
    host: SkillHost,
    skillIds: string[],
    action: ProjectBatchAction,
  ): Promise<ProjectPreviewResult> {
    const projectScan = await this.scanProjectSkills();
    if (!projectScan) {
      throw new Error("请先选择项目文件夹。");
    }
    const selected = new Set(skillIds);
    const blockedSkillIds: string[] = [];
    const items: ProjectPreviewItem[] = [];

    for (const record of projectScan.records) {
      if (record.host !== host || (skillIds.length > 0 && !selected.has(record.skillId))) {
        continue;
      }

      const preview = this.toProjectPreviewItem(action, record);
      if (!preview) {
        if (selected.has(record.skillId)) {
          blockedSkillIds.push(record.skillId);
        }
        continue;
      }
      items.push(preview);
    }

    return {
      action,
      host,
      generatedAt: new Date().toISOString(),
      items,
      blockedSkillIds,
      project: projectScan.currentProject,
    };
  }

  async executeProjectBatch(
    host: SkillHost,
    skillIds: string[],
    action: ProjectBatchAction,
  ): Promise<BatchExecutionResult> {
    const preview = await this.createProjectPreview(host, skillIds, action);
    const startedAt = new Date().toISOString();
    const operationId = `${startedAt.replace(/[:.]/g, "-")}-${action}-${host}`;

    if (preview.items.length === 0) {
      return {
        operationId,
        action,
        startedAt,
        finishedAt: new Date().toISOString(),
        success: false,
        rolledBack: false,
        results: [],
        message: "当前项目没有可执行的 skill。",
      };
    }

    const plan: OperationPlan = {
      operationId,
      action,
      createdAt: startedAt,
      items: preview.items,
    };
    await this.persistOperationPlan(plan);

    const results: ProjectOperationResultItem[] = [];
    const completed: ProjectPreviewItem[] = [];

    try {
      for (const item of preview.items) {
        await this.assertProjectExecutable(action, item);
        if (action === "copy-to-project") {
          await this.copyDirectoryFn(item.sourcePath, item.targetPath);
        } else {
          await removePath(item.targetPath);
        }
        completed.push(item);
        results.push({ ...item, success: true });
      }
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : "未知错误";
      const failedItem = preview.items[completed.length];
      if (failedItem) {
        results.push({ ...failedItem, success: false, error: failureMessage });
      }

      const rollbackResults = await this.rollbackCompletedProjectItems(action, completed);
      for (const rollbackItem of rollbackResults) {
        const index = results.findIndex((item) => item.skillId === rollbackItem.skillId);
        if (index >= 0) {
          results[index] = rollbackItem;
        } else {
          results.push(rollbackItem);
        }
      }

      const finishedAt = new Date().toISOString();
      const execution: BatchExecutionResult = {
        operationId,
        action,
        startedAt,
        finishedAt,
        success: false,
        rolledBack: completed.length > 0,
        results,
        message: `项目批次执行失败：${failureMessage}`,
      };
      await this.updateManagedProjectSkills(preview.project.projectId, host, completed.map((item) => item.skillId), action, true);
      await this.persistOperationExecution(execution, false);
      await this.scanProjectSkills(preview.project.projectPath);
      return execution;
    }

    const finishedAt = new Date().toISOString();
    const execution: BatchExecutionResult = {
      operationId,
      action,
      startedAt,
      finishedAt,
      success: true,
      rolledBack: false,
      results,
      message: `项目批次执行成功，共处理 ${results.length} 个 skill。`,
    };
    await this.updateManagedProjectSkills(preview.project.projectId, host, preview.items.map((item) => item.skillId), action, false);
    await this.persistOperationExecution(execution, false);
    await this.scanProjectSkills(preview.project.projectPath);
    return execution;
  }

  async createPreview(action: PreviewAction, skillIds: string[]): Promise<PreviewResult> {
    const scan = await this.loadRecentEnvironmentScanOrScan();
    const selected = new Set(skillIds);
    const blockedSkillIds: string[] = [];
    const items: PreviewItem[] = [];

    for (const record of scan.records) {
      if (skillIds.length > 0 && !selected.has(record.skillId)) {
        continue;
      }

      const preview = this.toPreviewItem(action, record);
      if (!preview) {
        if (selected.has(record.skillId)) {
          blockedSkillIds.push(record.skillId);
        }
        continue;
      }
      items.push(preview);
    }

    const targets = skillIds.length === 0 ? scan.records : scan.records.filter((record) => selected.has(record.skillId));
    const overview = (["codex", "claude"] as const).map((host) => {
      const relevant = targets.filter((record) => record.host === host);
      const previewItems = items.filter((item) => item.host === host);
      return {
        host,
        movableCount: previewItems.length,
        readonlyCount: relevant.filter((record) => record.status === "readonly").length,
        conflictCount: relevant.filter((record) => record.status === "conflict").length,
        projectedBytesMoved: previewItems.reduce((total, item) => total + item.sizeTotalBytes, 0),
      };
    });

    return {
      action,
      generatedAt: new Date().toISOString(),
      items,
      blockedSkillIds,
      overview,
    };
  }

  async executeBatch(action: PreviewAction, skillIds: string[]): Promise<BatchExecutionResult> {
    const preview = await this.createPreview(action, skillIds);
    const startedAt = new Date().toISOString();
    const operationId = `${startedAt.replace(/[:.]/g, "-")}-${action}`;

    if (preview.items.length === 0) {
      return {
        operationId,
        action,
        startedAt,
        finishedAt: new Date().toISOString(),
        success: false,
        rolledBack: false,
        results: [],
        message: "没有可执行的 skill，批次未启动。",
      };
    }

    const plan: OperationPlan = {
      operationId,
      action,
      createdAt: startedAt,
      items: preview.items,
    };
    await this.persistOperationPlan(plan);

    const results: OperationResultItem[] = [];
    const completed: PreviewItem[] = [];

    try {
      for (const item of preview.items) {
        await this.assertExecutable(item);
        await this.moveDirectoryFn(item.sourcePath, item.targetPath);
        completed.push(item);
        results.push({ ...item, success: true });
      }
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : "未知错误";
      const failedItem = preview.items[completed.length];
      if (failedItem) {
        results.push({ ...failedItem, success: false, error: failureMessage });
      }

      const rollbackResults = await this.rollbackCompletedItems(completed);
      for (const rollbackItem of rollbackResults) {
        const index = results.findIndex((item) => item.skillId === rollbackItem.skillId);
        if (index >= 0) {
          results[index] = rollbackItem;
        } else {
          results.push(rollbackItem);
        }
      }

      const finishedAt = new Date().toISOString();
      const execution: BatchExecutionResult = {
        operationId,
        action,
        startedAt,
        finishedAt,
        success: false,
        rolledBack: completed.length > 0,
        results,
        message: `批次执行失败：${failureMessage}`,
      };
      await this.persistOperationExecution(execution, false);
      await this.scanEnvironment();
      return execution;
    }

    const finishedAt = new Date().toISOString();
    const execution: BatchExecutionResult = {
      operationId,
      action,
      startedAt,
      finishedAt,
      success: true,
      rolledBack: false,
      results,
      message: `批次执行成功，共处理 ${results.length} 个 skill。`,
    };
    await this.persistOperationExecution(execution, true);
    await this.scanEnvironment();
    return execution;
  }

  async rollbackLastSuccessfulBatch(): Promise<BatchExecutionResult> {
    const manifest = await this.loadManifest();
    const lastSuccessfulOperationId = manifest?.lastSuccessfulOperationId;
    const startedAt = new Date().toISOString();
    const action: BatchExecutionResult["action"] = "rollback-last-batch";

    if (!lastSuccessfulOperationId) {
      return {
        operationId: `${startedAt.replace(/[:.]/g, "-")}-rollback-last-batch`,
        action,
        startedAt,
        finishedAt: new Date().toISOString(),
        success: false,
        rolledBack: false,
        results: [],
        message: "没有可回滚的成功批次。",
      };
    }

    const executionPath = path.join(this.paths.operationsRoot, `${lastSuccessfulOperationId}.result.json`);
    const previous = await readJson<BatchExecutionResult>(executionPath);
    if (!previous || !previous.success) {
      return {
        operationId: `${startedAt.replace(/[:.]/g, "-")}-rollback-last-batch`,
        action,
        startedAt,
        finishedAt: new Date().toISOString(),
        success: false,
        rolledBack: false,
        results: [],
        message: "未找到上一批成功操作的结果文件。",
      };
    }

    const items = previous.results
      .filter(
        (item): item is OperationResultItem =>
          item.success && "statusBefore" in item && "statusAfter" in item,
      )
      .map<PreviewItem>((item) => ({
        ...item,
        sourcePath: item.targetPath,
        targetPath: item.sourcePath,
        statusBefore: item.statusAfter,
        statusAfter: item.statusBefore,
      }))
      .reverse();

    const operationId = `${startedAt.replace(/[:.]/g, "-")}-rollback-last-batch`;
    const plan: OperationPlan = {
      operationId,
      action,
      createdAt: startedAt,
      items,
    };
    await this.persistOperationPlan(plan);

    const results: OperationResultItem[] = [];
    try {
      for (const item of items) {
        await this.assertExecutable(item);
        await this.moveDirectoryFn(item.sourcePath, item.targetPath);
        results.push({ ...item, success: true });
      }
    } catch (error) {
      const failureMessage = error instanceof Error ? error.message : "未知错误";
      const finishedAt = new Date().toISOString();
      const execution: BatchExecutionResult = {
        operationId,
        action,
        startedAt,
        finishedAt,
        success: false,
        rolledBack: false,
        results,
        message: `回滚失败：${failureMessage}`,
      };
      await this.persistOperationExecution(execution, false);
      await this.scanEnvironment();
      return execution;
    }

    const finishedAt = new Date().toISOString();
    const rollbackExecution: BatchExecutionResult = {
      operationId,
      action,
      startedAt,
      finishedAt,
      success: true,
      rolledBack: false,
      results,
      message: `已回滚批次 ${lastSuccessfulOperationId}。`,
    };
    await this.persistOperationExecution(rollbackExecution, false);

    if (manifest) {
      await writeJson(this.paths.manifestPath, {
        ...manifest,
        lastSuccessfulOperationId: undefined,
      });
    }

    await this.scanEnvironment();
    return rollbackExecution;
  }

  private async persistOperationPlan(plan: OperationPlan): Promise<void> {
    const planPath = path.join(this.paths.operationsRoot, `${plan.operationId}.plan.json`);
    const backupPath = path.join(this.paths.backupsRoot, plan.operationId, "snapshot.json");
    const manifest = await this.loadManifest();
    await writeJson(planPath, plan);
    await writeJson(backupPath, {
      operationId: plan.operationId,
      createdAt: plan.createdAt,
      manifest,
    });
  }

  private async persistOperationExecution(result: BatchExecutionResult, markAsLatestSuccess: boolean): Promise<void> {
    const resultPath = path.join(this.paths.operationsRoot, `${result.operationId}.result.json`);
    await writeJson(resultPath, result);

    const manifest = await this.loadManifest();
    if (manifest) {
      await writeJson(this.paths.manifestPath, {
        ...manifest,
        lastSuccessfulOperationId: markAsLatestSuccess ? result.operationId : manifest.lastSuccessfulOperationId,
      });
    }
  }

  private async rollbackCompletedItems(completed: PreviewItem[]): Promise<OperationResultItem[]> {
    const reversed = [...completed].reverse();
    const results: OperationResultItem[] = [];
    for (const item of reversed) {
      try {
        await this.moveDirectoryFn(item.targetPath, item.sourcePath);
        results.push({ ...item, success: false, error: "已执行自动回滚。" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "自动回滚失败";
        results.push({ ...item, success: false, error: `自动回滚失败：${message}` });
      }
    }
    return results;
  }

  private async rollbackCompletedProjectItems(
    action: ProjectBatchAction,
    completed: ProjectPreviewItem[],
  ): Promise<ProjectOperationResultItem[]> {
    const reversed = [...completed].reverse();
    const results: ProjectOperationResultItem[] = [];

    for (const item of reversed) {
      try {
        if (action === "copy-to-project") {
          await removePath(item.targetPath);
        } else {
          await this.copyDirectoryFn(item.sourcePath, item.targetPath);
        }
        results.push({ ...item, success: false, error: "已执行自动回滚。" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "自动回滚失败";
        results.push({ ...item, success: false, error: `自动回滚失败：${message}` });
      }
    }

    return results;
  }

  private async ensureRoots(): Promise<void> {
    await Promise.all([
      ensureDirectory(this.paths.operationsRoot),
      ensureDirectory(this.paths.backupsRoot),
      ensureDirectory(path.dirname(this.paths.projectsPath)),
      ensureDirectory(this.paths.hosts.codex.activeRoot),
      ensureDirectory(this.paths.hosts.codex.libraryRoot),
      ensureDirectory(this.paths.hosts.claude.activeRoot),
      ensureDirectory(this.paths.hosts.claude.libraryRoot),
    ]);
  }

  private async loadManifest(): Promise<ScanManifest | undefined> {
    return readJson<ScanManifest>(this.paths.manifestPath);
  }

  private async loadTranslations(): Promise<SkillTranslationsFile | undefined> {
    return readJson<SkillTranslationsFile>(this.paths.translationsPath);
  }

  private async loadUserTags(): Promise<SkillUserTagsFile | undefined> {
    const stored = await readJson<SkillUserTagsFile>(this.paths.tagsPath);
    if (!stored) {
      return undefined;
    }

    return {
      version: 1,
      updatedAt: stored.updatedAt,
      entries: Object.fromEntries(
        Object.entries(stored.entries ?? {}).map(([skillId, tags]) => [skillId, normalizeUserTags(tags ?? [])]),
      ),
    };
  }

  private async loadRecentEnvironmentScan(): Promise<ScanResult | null> {
    if (this.recentEnvironmentBaseSnapshot) {
      return this.buildEnvironmentScanFromBaseSnapshot(this.recentEnvironmentBaseSnapshot);
    }

    const manifest = await this.loadManifest();
    if (!this.isUsableManifest(manifest)) {
      return null;
    }

    this.recentEnvironmentBaseSnapshot = {
      scannedAt: manifest.lastScannedAt,
      records: manifest.records,
    };
    return this.buildEnvironmentScanFromBaseSnapshot(this.recentEnvironmentBaseSnapshot);
  }

  private async loadRecentEnvironmentScanOrScan(): Promise<ScanResult> {
    const recentScan = await this.loadRecentEnvironmentScan();
    return recentScan ?? await this.scanEnvironment();
  }

  private async buildEnvironmentScanFromBaseSnapshot(snapshot: EnvironmentBaseSnapshot): Promise<ScanResult> {
    const [translations, userTags] = await Promise.all([
      this.loadTranslations(),
      this.loadUserTags(),
    ]);
    const records = this.applyCurrentOverlays(snapshot.records, translations, userTags);
    return this.buildScanResult(records, snapshot.scannedAt);
  }

  private async loadProjectsState(): Promise<ProjectSelectionState> {
    const stored = await readJson<ProjectSelectionState>(this.paths.projectsPath);
    if (stored) {
      return {
        version: 1,
        currentProjectId: stored.currentProjectId,
        records: stored.records ?? [],
        hostStates: Object.fromEntries(
          Object.entries(stored.hostStates ?? {}).map(([projectId, hostState]) => [
            projectId,
            {
              codex: {
                skillIds: hostState.codex?.skillIds ?? [],
                managedSkillIds: hostState.codex?.managedSkillIds ?? [],
              },
              claude: {
                skillIds: hostState.claude?.skillIds ?? [],
                managedSkillIds: hostState.claude?.managedSkillIds ?? [],
              },
            },
          ]),
        ) as Record<string, ProjectHostState>,
      };
    }

    return {
      version: 1,
      records: [],
      hostStates: {},
    };
  }

  private async persistProjectsState(state: ProjectSelectionState): Promise<void> {
    await writeJson(this.paths.projectsPath, state);
  }

  private async getCurrentProject(): Promise<ProjectRecord | undefined> {
    const projects = await this.loadProjectsState();
    return projects.records.find((item) => item.projectId === projects.currentProjectId);
  }

  private isUsableManifest(manifest: ScanManifest | undefined): manifest is ScanManifest {
    return Boolean(
      manifest &&
      manifest.version === 1 &&
      manifest.projectRoot === this.paths.projectRoot &&
      Array.isArray(manifest.records),
    );
  }

  private applyCurrentOverlays(
    records: SkillRecord[],
    translations: SkillTranslationsFile | undefined,
    userTags: SkillUserTagsFile | undefined,
  ): SkillRecord[] {
    return records.map((record) => {
      const translatedRecord = applyTranslations(record, translations?.entries[record.skillId]);
      const mergedUserTags = userTags?.entries[translatedRecord.skillId] ?? [];
      return {
        ...translatedRecord,
        userTags: mergedUserTags,
        hasUserTags: mergedUserTags.length > 0,
      };
    });
  }

  private buildScanResult(records: SkillRecord[], scannedAt: string): ScanResult {
    const normalizedRecords = records.map((record) => ({
      ...record,
      lastScannedAt: scannedAt,
    }));

    return {
      scannedAt,
      records: normalizedRecords,
      overview: this.buildOverview(normalizedRecords),
      manifestPath: this.paths.manifestPath,
      projectRoot: this.paths.projectRoot,
    };
  }

  private buildProjectScanFromHostState(
    project: ProjectRecord,
    hostStates: ProjectHostState,
    records: SkillRecord[],
  ): ProjectScanResult {
    return {
      currentProject: project,
      hostStates,
      records: records.map((record) => ({
        ...record,
        projectStatus: this.buildProjectSkillStatus(record, project.projectPath, hostStates),
      })),
    };
  }

  private async buildCachedProjectScanFromRecords(records: SkillRecord[]): Promise<ProjectScanResult | null> {
    const projectsState = await this.loadProjectsState();
    const project = projectsState.records.find((item) => item.projectId === projectsState.currentProjectId);
    if (!project) {
      return null;
    }

    const hostStates = projectsState.hostStates[project.projectId] ?? {
      codex: { skillIds: [], managedSkillIds: [] },
      claude: { skillIds: [], managedSkillIds: [] },
    };
    return this.buildProjectScanFromHostState(project, hostStates, records);
  }

  private async buildFreshProjectScanFromRecords(records: SkillRecord[]): Promise<ProjectScanResult | null> {
    const projectsState = await this.loadProjectsState();
    const project = projectsState.records.find((item) => item.projectId === projectsState.currentProjectId);
    if (!project) {
      return null;
    }

    const hostStates = await this.buildProjectHostState(project.projectPath, projectsState.hostStates[project.projectId]);
    await this.updateStoredProjectHostState(project.projectId, hostStates);
    return this.buildProjectScanFromHostState(project, hostStates, records);
  }

  private async buildProjectHostState(projectPath: string, previousState?: ProjectHostState): Promise<ProjectHostState> {
    const codexSkillDirs = await listDirectories(this.getProjectSkillsRoot(projectPath, "codex"));
    const claudeSkillDirs = await listDirectories(this.getProjectSkillsRoot(projectPath, "claude"));
    const codexSkillIds = codexSkillDirs.map((directoryName) => createSkillId("codex", directoryName));
    const claudeSkillIds = claudeSkillDirs.map((directoryName) => createSkillId("claude", directoryName));
    return {
      codex: {
        skillIds: codexSkillIds,
        managedSkillIds: (previousState?.codex.managedSkillIds ?? []).filter((skillId) => codexSkillIds.includes(skillId)),
      },
      claude: {
        skillIds: claudeSkillIds,
        managedSkillIds: (previousState?.claude.managedSkillIds ?? []).filter((skillId) => claudeSkillIds.includes(skillId)),
      },
    };
  }

  private async updateStoredProjectHostState(projectId: string, hostState: ProjectHostState): Promise<void> {
    const projects = await this.loadProjectsState();
    await this.persistProjectsState({
      ...projects,
      hostStates: {
        ...projects.hostStates,
        [projectId]: hostState,
      },
    });
  }

  private async updateManagedProjectSkills(
    projectId: string,
    host: SkillHost,
    skillIds: string[],
    action: ProjectBatchAction,
    rollback: boolean,
  ): Promise<void> {
    if (skillIds.length === 0) {
      return;
    }

    const projects = await this.loadProjectsState();
    const currentState = projects.hostStates[projectId] ?? {
      codex: { skillIds: [], managedSkillIds: [] },
      claude: { skillIds: [], managedSkillIds: [] },
    };
    const managed = new Set(currentState[host].managedSkillIds ?? []);

    for (const skillId of skillIds) {
      if (action === "copy-to-project") {
        if (rollback) {
          managed.delete(skillId);
        } else {
          managed.add(skillId);
        }
        continue;
      }

      if (rollback) {
        managed.add(skillId);
      } else {
        managed.delete(skillId);
      }
    }

    await this.persistProjectsState({
      ...projects,
      hostStates: {
        ...projects.hostStates,
        [projectId]: {
          ...currentState,
          [host]: {
            ...currentState[host],
            managedSkillIds: [...managed].sort((left, right) => left.localeCompare(right)),
          },
        },
      },
    });
  }

  private buildOverview(records: SkillRecord[]): HostSummary[] {
    return (["codex", "claude"] as const).map((host) => {
      const hostRecords = records.filter((record) => record.host === host);
      return {
        host,
        counts: {
          active: hostRecords.filter((record) => record.status === "active").length,
          inactive: hostRecords.filter((record) => record.status === "inactive").length,
          conflict: hostRecords.filter((record) => record.status === "conflict").length,
          readonly: hostRecords.filter((record) => record.status === "readonly").length,
        },
        totalBytes: hostRecords.reduce((total, record) => total + record.sizeTotalBytes, 0),
        readonlyBytes: hostRecords
          .filter((record) => record.status === "readonly")
          .reduce((total, record) => total + record.sizeTotalBytes, 0),
      };
    });
  }

  private toPreviewItem(action: PreviewAction, record: SkillRecord): PreviewItem | undefined {
    if (record.status === "readonly" || record.status === "conflict") {
      return undefined;
    }

    if (action === "enable" && record.status === "inactive") {
      return {
        skillId: record.skillId,
        host: record.host,
        directoryName: record.directoryName,
        sourcePath: record.expectedLibraryPath,
        targetPath: record.expectedActivePath,
        sizeTotalBytes: record.sizeTotalBytes,
        statusBefore: record.status,
        statusAfter: "active",
      };
    }

    if (action === "disable" && record.status === "active") {
      return {
        skillId: record.skillId,
        host: record.host,
        directoryName: record.directoryName,
        sourcePath: record.expectedActivePath,
        targetPath: record.expectedLibraryPath,
        sizeTotalBytes: record.sizeTotalBytes,
        statusBefore: record.status,
        statusAfter: "inactive",
      };
    }

    return undefined;
  }

  private buildProjectSkillStatus(
    record: SkillRecord,
    projectPath: string,
    hostStates: ProjectHostState,
  ): ProjectSkillStatus {
    const projectTargetPath = path.join(this.getProjectSkillsRoot(projectPath, record.host), record.directoryName);
    const enabledIds = new Set(hostStates[record.host].skillIds);
    const managedIds = new Set(hostStates[record.host].managedSkillIds ?? []);
    const isEnabledInProject = enabledIds.has(record.skillId);
    return {
      isEnabledInProject,
      projectTargetPath,
      projectConflict: isEnabledInProject && !managedIds.has(record.skillId),
    };
  }

  private toProjectPreviewItem(
    action: ProjectBatchAction,
    record: ProjectSkillRecord,
  ): ProjectPreviewItem | undefined {
    if (record.status === "readonly" || record.status === "conflict") {
      return undefined;
    }

    if (action === "copy-to-project") {
      if (record.projectStatus.isEnabledInProject || record.projectStatus.projectConflict) {
        return undefined;
      }
      return {
        skillId: record.skillId,
        host: record.host,
        directoryName: record.directoryName,
        sourcePath: resolveRecordSourcePath(record),
        targetPath: record.projectStatus.projectTargetPath,
        sizeTotalBytes: record.sizeTotalBytes,
        isEnabledInProjectBefore: false,
        isEnabledInProjectAfter: true,
      };
    }

    if (!record.projectStatus.isEnabledInProject) {
      return undefined;
    }

    return {
      skillId: record.skillId,
      host: record.host,
      directoryName: record.directoryName,
      sourcePath: resolveRecordSourcePath(record),
      targetPath: record.projectStatus.projectTargetPath,
      sizeTotalBytes: record.sizeTotalBytes,
      isEnabledInProjectBefore: true,
      isEnabledInProjectAfter: false,
    };
  }

  private getProjectSkillsRoot(projectPath: string, host: SkillHost): string {
    return host === "codex"
      ? path.join(projectPath, ".agents", "skills")
      : path.join(projectPath, ".claude", "skills");
  }

  private async assertProjectExecutable(action: ProjectBatchAction, item: ProjectPreviewItem): Promise<void> {
    if (action === "copy-to-project") {
      if (!(await pathExists(item.sourcePath))) {
        throw new Error(`源目录不存在：${item.sourcePath}`);
      }
      if (await pathExists(item.targetPath)) {
        throw new Error(`项目目标目录已存在：${item.targetPath}`);
      }
      return;
    }

    if (!(await pathExists(item.targetPath))) {
      throw new Error(`项目副本不存在：${item.targetPath}`);
    }
  }

  private async assertExecutable(item: PreviewItem): Promise<void> {
    if (!(await pathExists(item.sourcePath))) {
      throw new Error(`源目录不存在：${item.sourcePath}`);
    }
    if (await pathExists(item.targetPath)) {
      throw new Error(`目标目录已存在：${item.targetPath}`);
    }
  }
}

export async function removePath(targetPath: string): Promise<void> {
  if (await pathExists(targetPath)) {
    await fs.rm(targetPath, { recursive: true, force: true });
  }
}
