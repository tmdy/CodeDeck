import { describe, expect, it } from "vitest";
import type { ProjectScanResult, ScanResult } from "./skills-service.js";
import type {
  ProjectHostState,
  ProjectRecord,
  ProjectSkillRecord,
  SkillHost,
  SkillRecord,
  SkillStatus,
} from "./types.js";
import { buildSkillsViewState, NO_USER_TAGS_FILTER_VALUE } from "./skills-ui-state.js";

function createRecord(overrides: Partial<SkillRecord> = {}): SkillRecord {
  const host = overrides.host ?? "codex";
  const directoryName = overrides.directoryName ?? "writer";

  return {
    host,
    skillId: overrides.skillId ?? `${host}:${directoryName}`,
    directoryName,
    displayName: overrides.displayName ?? directoryName,
    description: overrides.description ?? `${directoryName} description`,
    summary: overrides.summary ?? `${directoryName} summary`,
    tags: overrides.tags ?? [],
    userTags: overrides.userTags ?? [],
    hasUserTags: overrides.hasUserTags ?? false,
    originalDescription: overrides.originalDescription,
    originalSummary: overrides.originalSummary,
    originalTags: overrides.originalTags,
    hasSkillMd: overrides.hasSkillMd ?? true,
    isSpecialDir: overrides.isSpecialDir ?? false,
    status: overrides.status ?? "active",
    location: overrides.location ?? (overrides.status === "inactive" ? "library-root" : "active-root"),
    sourcePath: overrides.sourcePath ?? `C:/skills/${directoryName}`,
    expectedActivePath: overrides.expectedActivePath ?? `C:/hosts/${host}/${directoryName}`,
    expectedLibraryPath: overrides.expectedLibraryPath ?? `C:/library/${host}/${directoryName}`,
    sizeSkillMdBytes: overrides.sizeSkillMdBytes ?? 100,
    sizeBodyBytes: overrides.sizeBodyBytes ?? 200,
    sizeTotalBytes: overrides.sizeTotalBytes ?? 300,
    lastScannedAt: overrides.lastScannedAt ?? "2026-05-04T00:00:00.000Z",
    notes: overrides.notes ?? [],
  };
}

function createProjectRecord(record: SkillRecord, overrides: Partial<ProjectSkillRecord> = {}): ProjectSkillRecord {
  return {
    ...record,
    projectStatus: overrides.projectStatus ?? {
      isEnabledInProject: false,
      projectConflict: false,
      projectTargetPath: `C:/project/.${record.host}/skills/${record.directoryName}`,
    },
  };
}

function createOverview(host: SkillHost, counts: Partial<Record<SkillStatus, number>>, totalBytes = 0) {
  return {
    host,
    counts: {
      active: counts.active ?? 0,
      inactive: counts.inactive ?? 0,
      conflict: counts.conflict ?? 0,
      readonly: counts.readonly ?? 0,
    },
    totalBytes,
    readonlyBytes: 0,
    conflictBytes: 0,
  };
}

function createScan(records: SkillRecord[]): ScanResult {
  return {
    scannedAt: "2026-05-04T00:00:00.000Z",
    records,
    overview: [
      createOverview("codex", {
        active: records.filter((item) => item.host === "codex" && item.status === "active").length,
        inactive: records.filter((item) => item.host === "codex" && item.status === "inactive").length,
        conflict: records.filter((item) => item.host === "codex" && item.status === "conflict").length,
        readonly: records.filter((item) => item.host === "codex" && item.status === "readonly").length,
      }),
      createOverview("claude", {
        active: records.filter((item) => item.host === "claude" && item.status === "active").length,
        inactive: records.filter((item) => item.host === "claude" && item.status === "inactive").length,
        conflict: records.filter((item) => item.host === "claude" && item.status === "conflict").length,
        readonly: records.filter((item) => item.host === "claude" && item.status === "readonly").length,
      }),
    ],
    manifestPath: "C:/app-data/manifest.json",
    projectRoot: "C:/workspace",
  };
}

function createProjectScan(project: ProjectRecord, records: ProjectSkillRecord[]): ProjectScanResult {
  const hostStates: ProjectHostState = {
    codex: {
      skillIds: records.filter((item) => item.host === "codex" && item.projectStatus.isEnabledInProject).map((item) => item.skillId),
      managedSkillIds: [],
    },
    claude: {
      skillIds: records.filter((item) => item.host === "claude" && item.projectStatus.isEnabledInProject).map((item) => item.skillId),
      managedSkillIds: [],
    },
  };

  return {
    currentProject: project,
    hostStates,
    records,
  };
}

describe("buildSkillsViewState", () => {
  it("maps scan and project scan into host summaries and visible records", () => {
    const writer = createRecord({
      host: "codex",
      directoryName: "writer",
      displayName: "Writer",
      tags: ["builtin"],
      userTags: ["科研写作"],
      hasUserTags: true,
      status: "inactive",
    });
    const video = createRecord({
      host: "claude",
      directoryName: "video",
      displayName: "Video",
      status: "active",
    });
    const project: ProjectRecord = {
      projectId: "p1",
      projectName: "demo",
      projectPath: "C:/demo",
      createdAt: "2026-05-04T00:00:00.000Z",
      lastUsedAt: "2026-05-04T00:00:00.000Z",
    };

    const state = buildSkillsViewState({
      scan: createScan([writer, video]),
      projectScan: createProjectScan(project, [
        createProjectRecord(writer, {
          projectStatus: {
            isEnabledInProject: true,
            projectConflict: false,
            projectTargetPath: "C:/demo/.codex/skills/writer",
          },
        }),
        createProjectRecord(video),
      ]),
      filters: {
        host: "all",
        statuses: [],
        query: "",
        selectedTag: "",
        onlyTagged: false,
        includeReadonlyOnly: false,
      },
    });

    expect(state.project.currentProjectName).toBe("demo");
    expect(state.overview.find((item) => item.host === "codex")?.counts.inactive).toBe(1);
    expect(state.visibleRecords).toHaveLength(2);
    expect(state.visibleRecords[0]?.projectStatusLabel).toBe("已加入当前项目");
    expect(state.visibleRecords[0]?.tags).toEqual(["科研写作"]);
    expect(state.availableTags).toEqual(["科研写作"]);
  });

  it("filters by host, status, search, readonly-only and selected user tag", () => {
    const writer = createRecord({
      host: "codex",
      directoryName: "writer",
      displayName: "Research Writer",
      status: "inactive",
      userTags: ["科研写作"],
      hasUserTags: true,
    });
    const readonlyItem = createRecord({
      host: "codex",
      directoryName: "_shared",
      displayName: "Shared",
      status: "readonly",
      isSpecialDir: true,
    });
    const video = createRecord({
      host: "claude",
      directoryName: "video",
      displayName: "Video Research",
      status: "active",
      tags: ["内置标签"],
    });

    const state = buildSkillsViewState({
      scan: createScan([writer, readonlyItem, video]),
      projectScan: null,
      filters: {
        host: "codex",
        statuses: ["inactive"],
        query: "writer",
        selectedTag: "科研写作",
        onlyTagged: true,
        includeReadonlyOnly: false,
      },
    });

    expect(state.visibleRecords.map((item) => item.skillId)).toEqual(["codex:writer"]);
    expect(state.availableTags).toEqual(["科研写作"]);

    const readonlyState = buildSkillsViewState({
      scan: createScan([writer, readonlyItem, video]),
      projectScan: null,
      filters: {
        host: "all",
        statuses: [],
        query: "",
        selectedTag: "",
        onlyTagged: false,
        includeReadonlyOnly: true,
      },
    });

    expect(readonlyState.visibleRecords.map((item) => item.skillId)).toEqual(["codex:_shared"]);
  });

  it("filters records without user tags without adding a synthetic tag option", () => {
    const tagged = createRecord({
      host: "codex",
      directoryName: "tagged",
      displayName: "Tagged",
      userTags: ["科研写作"],
      hasUserTags: true,
    });
    const untagged = createRecord({
      host: "claude",
      directoryName: "untagged",
      displayName: "Untagged",
    });

    const state = buildSkillsViewState({
      scan: createScan([tagged, untagged]),
      projectScan: null,
      filters: {
        host: "all",
        statuses: [],
        query: "",
        selectedTag: NO_USER_TAGS_FILTER_VALUE,
        onlyTagged: false,
        includeReadonlyOnly: false,
      },
    });

    expect(state.visibleRecords.map((item) => item.skillId)).toEqual(["claude:untagged"]);
    expect(state.availableTags).toEqual(["科研写作"]);
  });

  it("hides special directories by default while keeping them available in readonly diagnostics", () => {
    const writer = createRecord({
      host: "codex",
      directoryName: "writer",
      displayName: "Writer",
      status: "inactive",
      userTags: ["科研写作"],
      hasUserTags: true,
    });
    const shared = createRecord({
      host: "codex",
      directoryName: "_shared",
      displayName: "Shared",
      status: "readonly",
      isSpecialDir: true,
    });

    const defaultState = buildSkillsViewState({
      scan: createScan([writer, shared]),
      projectScan: null,
      filters: {
        host: "all",
        statuses: [],
        query: "",
        selectedTag: "",
        onlyTagged: false,
        includeReadonlyOnly: false,
      },
    });

    expect(defaultState.visibleRecords.map((item) => item.skillId)).toEqual(["codex:writer"]);
    expect(defaultState.availableTags).toEqual(["科研写作"]);
    expect(defaultState.overview.find((item) => item.host === "codex")?.counts.readonly).toBe(1);

    const readonlyState = buildSkillsViewState({
      scan: createScan([writer, shared]),
      projectScan: null,
      filters: {
        host: "all",
        statuses: [],
        query: "",
        selectedTag: "",
        onlyTagged: false,
        includeReadonlyOnly: true,
      },
    });

    expect(readonlyState.visibleRecords.map((item) => item.skillId)).toEqual(["codex:_shared"]);
  });

  it("marks blocked environment and project actions for readonly, conflict and project-conflict items", () => {
    const readonlyItem = createRecord({
      host: "codex",
      directoryName: "_shared",
      status: "readonly",
      isSpecialDir: true,
    });
    const conflictItem = createRecord({
      host: "claude",
      directoryName: "broken",
      status: "conflict",
    });
    const project: ProjectRecord = {
      projectId: "p2",
      projectName: "demo",
      projectPath: "C:/demo",
      createdAt: "2026-05-04T00:00:00.000Z",
      lastUsedAt: "2026-05-04T00:00:00.000Z",
    };

    const state = buildSkillsViewState({
      scan: createScan([readonlyItem, conflictItem]),
      projectScan: createProjectScan(project, [
        createProjectRecord(readonlyItem),
        createProjectRecord(conflictItem, {
          projectStatus: {
            isEnabledInProject: false,
            projectConflict: true,
            projectTargetPath: "C:/demo/.claude/skills/broken",
          },
        }),
      ]),
      filters: {
        host: "all",
        statuses: [],
        query: "",
        selectedTag: "",
        onlyTagged: false,
        includeReadonlyOnly: false,
      },
    });

    expect(state.selection.blockedEnvironmentSkillIds).toEqual(["claude:broken", "codex:_shared"]);
    expect(state.selection.blockedProjectSkillIds).toEqual(["claude:broken", "codex:_shared"]);
    expect(state.visibleRecords.find((item) => item.skillId === "codex:_shared")).toBeUndefined();
    expect(state.visibleRecords.find((item) => item.skillId === "claude:broken")?.actions.canAddToProject).toBe(false);
  });

  it("drops project context cleanly when current project is cleared", () => {
    const writer = createRecord({
      host: "codex",
      directoryName: "writer",
      status: "inactive",
    });

    const state = buildSkillsViewState({
      scan: createScan([writer]),
      projectScan: null,
      filters: {
        host: "all",
        statuses: [],
        query: "",
        selectedTag: "",
        onlyTagged: false,
        includeReadonlyOnly: false,
      },
    });

    expect(state.project.hasProject).toBe(false);
    expect(state.project.currentProjectName).toBe("");
    expect(state.visibleRecords[0]?.projectStatusLabel).toBe("未选择项目");
  });

  it("preserves service-provided inactive location semantics for details and actions", () => {
    const inactiveRecord = createRecord({
      host: "codex",
      directoryName: "writer",
      status: "inactive",
      location: "library-root",
      sourcePath: "C:/library/codex/writer",
    });

    const state = buildSkillsViewState({
      scan: createScan([inactiveRecord]),
      projectScan: null,
      filters: {
        host: "all",
        statuses: [],
        query: "",
        selectedTag: "",
        onlyTagged: false,
        includeReadonlyOnly: false,
      },
    });

    expect(state.visibleRecords[0]?.record.location).toBe("library-root");
    expect(state.visibleRecords[0]?.record.sourcePath).toBe("C:/library/codex/writer");
    expect(state.visibleRecords[0]?.actions.canEnable).toBe(true);
    expect(state.visibleRecords[0]?.actions.canDisable).toBe(false);
  });
});
