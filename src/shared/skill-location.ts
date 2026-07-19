import type { SkillLocation, SkillRecord, SkillStatus } from "./types.js";

export function resolveSkillPlacement(params: {
  inActive: boolean;
  inLibrary: boolean;
  isReadonly: boolean;
}): {
  status: SkillStatus;
  location: SkillLocation;
} {
  const { inActive, inLibrary, isReadonly } = params;

  if (isReadonly) {
    return {
      status: "readonly",
      location: "readonly",
    };
  }

  if (inActive && inLibrary) {
    return {
      status: "conflict",
      location: "conflict",
    };
  }

  if (inLibrary) {
    return {
      status: "inactive",
      location: "library-root",
    };
  }

  return {
    status: "active",
    location: "active-root",
  };
}

export function resolveRecordSourcePath(record: Pick<SkillRecord, "location" | "expectedActivePath" | "expectedLibraryPath" | "sourcePath">): string {
  if (record.location === "active-root") {
    return record.expectedActivePath;
  }

  if (record.location === "library-root") {
    return record.expectedLibraryPath;
  }

  return record.sourcePath;
}

export function formatSkillLocationLabel(location: SkillLocation): string {
  switch (location) {
    case "active-root":
      return "宿主目录";
    case "library-root":
      return "中央仓";
    case "conflict":
      return "冲突目录";
    case "readonly":
      return "只读目录";
    default:
      return location;
  }
}
