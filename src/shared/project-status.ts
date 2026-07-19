import type { ProjectSkillStatus } from "./types.js";

export const projectStatusLabels = {
  "no-project": "未选择项目",
  "not-in-project": "未加入当前项目",
  "enabled-in-project": "已加入当前项目",
  "project-conflict": "项目冲突",
} as const;

export type ProjectStatusKey = keyof typeof projectStatusLabels;

export function resolveProjectStatusKey(projectStatus?: ProjectSkillStatus): ProjectStatusKey {
  if (!projectStatus) {
    return "no-project";
  }
  if (projectStatus.projectConflict) {
    return "project-conflict";
  }
  if (projectStatus.isEnabledInProject) {
    return "enabled-in-project";
  }
  return "not-in-project";
}
