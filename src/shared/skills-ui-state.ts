import { projectStatusLabels, resolveProjectStatusKey } from "./project-status.js";
import type { ProjectScanResult, ScanResult } from "./skills-service.js";
import { matchesSkillSearch, sortRecordsByUserTagsFirst } from "./record-search.js";
import type { ProjectSkillRecord, SkillHost, SkillRecord, SkillStatus } from "./types.js";

export interface SkillsViewFilters {
  host: SkillHost | "all";
  statuses: SkillStatus[];
  query: string;
  selectedTag: string;
  onlyTagged: boolean;
  includeReadonlyOnly: boolean;
}

export interface SkillsRowActions {
  canEnable: boolean;
  canDisable: boolean;
  canAddToProject: boolean;
  canRemoveFromProject: boolean;
}

export interface SkillsRowView {
  skillId: string;
  host: SkillHost;
  status: SkillStatus;
  record: ProjectSkillRecord;
  tags: string[];
  projectStatusKey: ReturnType<typeof resolveProjectStatusKey>;
  projectStatusLabel: string;
  actions: SkillsRowActions;
  isEnvironmentBlocked: boolean;
  isProjectBlocked: boolean;
}

export interface SkillsViewState {
  overview: ScanResult["overview"];
  visibleRecords: SkillsRowView[];
  availableTags: string[];
  project: {
    hasProject: boolean;
    currentProjectName: string;
    currentProjectPath: string;
  };
  selection: {
    blockedEnvironmentSkillIds: string[];
    blockedProjectSkillIds: string[];
  };
}

function mergeProjectState(scan: ScanResult, projectScan: ProjectScanResult | null): ProjectSkillRecord[] {
  if (!projectScan) {
    return scan.records.map((record) => ({
      ...record,
      projectStatus: {
        isEnabledInProject: false,
        projectConflict: false,
        projectTargetPath: "",
      },
    }));
  }

  const projectMap = new Map(projectScan.records.map((record) => [record.skillId, record] as const));
  return scan.records.map((record) => projectMap.get(record.skillId) ?? {
    ...record,
    projectStatus: {
      isEnabledInProject: false,
      projectConflict: false,
      projectTargetPath: "",
    },
  });
}

function collectTags(records: ProjectSkillRecord[]): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const record of records) {
    for (const tag of record.userTags) {
      if (!tag || seen.has(tag)) {
        continue;
      }
      seen.add(tag);
      tags.push(tag);
    }
  }

  return tags.sort((left, right) => left.localeCompare(right, "zh-CN"));
}

function recordMatchesTag(record: Pick<SkillRecord, "userTags">, selectedTag: string): boolean {
  if (!selectedTag.trim()) {
    return true;
  }
  return record.userTags.includes(selectedTag.trim());
}

function isEnvironmentBlocked(record: SkillRecord): boolean {
  return record.status === "readonly" || record.status === "conflict";
}

function isProjectBlocked(record: ProjectSkillRecord): boolean {
  return isEnvironmentBlocked(record) || record.projectStatus.projectConflict;
}

function buildActions(record: ProjectSkillRecord, hasProject: boolean): SkillsRowActions {
  const envBlocked = isEnvironmentBlocked(record);
  const projectBlocked = isProjectBlocked(record);

  return {
    canEnable: record.status === "inactive" && !envBlocked,
    canDisable: record.status === "active" && !envBlocked,
    canAddToProject: hasProject && !record.projectStatus.isEnabledInProject && !projectBlocked,
    canRemoveFromProject: hasProject && record.projectStatus.isEnabledInProject && !projectBlocked,
  };
}

function matchesFilters(record: ProjectSkillRecord, filters: SkillsViewFilters): boolean {
  if (filters.includeReadonlyOnly) {
    return record.status === "readonly";
  }

  if (filters.host !== "all" && record.host !== filters.host) {
    return false;
  }

  if (filters.statuses.length > 0 && !filters.statuses.includes(record.status)) {
    return false;
  }

  if (filters.onlyTagged && !record.hasUserTags) {
    return false;
  }

  if (!recordMatchesTag(record, filters.selectedTag)) {
    return false;
  }

  return matchesSkillSearch(record, filters.query);
}

function sortRows(records: ProjectSkillRecord[]): ProjectSkillRecord[] {
  return [...sortRecordsByUserTagsFirst(records)].sort((left, right) => {
    const tagPriority = Number(right.hasUserTags) - Number(left.hasUserTags);
    if (tagPriority !== 0) {
      return tagPriority;
    }
    const hostCompare = left.host.localeCompare(right.host);
    if (hostCompare !== 0) {
      return hostCompare;
    }
    return left.displayName.localeCompare(right.displayName, "zh-CN");
  });
}

export function buildSkillsViewState(params: {
  scan: ScanResult;
  projectScan: ProjectScanResult | null;
  filters: SkillsViewFilters;
}): SkillsViewState {
  const merged = mergeProjectState(params.scan, params.projectScan);
  const hasProject = Boolean(params.projectScan?.currentProject.projectId);
  const sorted = sortRows(merged);
  const visibleRecords = sorted
    .filter((record) => matchesFilters(record, params.filters))
    .map<SkillsRowView>((record) => {
      const projectStatusKey = resolveProjectStatusKey(hasProject ? record.projectStatus : undefined);

      return {
        skillId: record.skillId,
        host: record.host,
        status: record.status,
        record,
        tags: [...record.userTags],
        projectStatusKey,
        projectStatusLabel: projectStatusLabels[projectStatusKey],
        actions: buildActions(record, hasProject),
        isEnvironmentBlocked: isEnvironmentBlocked(record),
        isProjectBlocked: isProjectBlocked(record),
      };
    });

  return {
    overview: params.scan.overview,
    visibleRecords,
    availableTags: collectTags(sorted),
    project: {
      hasProject,
      currentProjectName: params.projectScan?.currentProject.projectName ?? "",
      currentProjectPath: params.projectScan?.currentProject.projectPath ?? "",
    },
    selection: {
      blockedEnvironmentSkillIds: merged
        .filter((record) => isEnvironmentBlocked(record))
        .map((record) => record.skillId)
        .sort(),
      blockedProjectSkillIds: merged
        .filter((record) => isProjectBlocked(record))
        .map((record) => record.skillId)
        .sort(),
    },
  };
}
