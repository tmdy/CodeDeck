import type { SkillRecord } from "./types.js";

export function normalizeUserTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawTag of tags) {
    const tag = rawTag.trim();
    if (!tag) {
      continue;
    }
    if (seen.has(tag)) {
      continue;
    }
    seen.add(tag);
    normalized.push(tag);
  }

  return normalized;
}

export function sortRecordsByUserTagsFirst<T extends Pick<SkillRecord, "hasUserTags">>(records: T[]): T[] {
  return [...records].sort((left, right) => Number(right.hasUserTags) - Number(left.hasUserTags));
}

export function matchesSkillSearch(record: Pick<SkillRecord, "displayName" | "directoryName" | "summary" | "sourcePath" | "tags" | "userTags">, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  const searchableParts = [
    record.displayName,
    record.directoryName,
    record.summary,
    record.sourcePath,
    ...record.userTags,
  ];

  return searchableParts.some((part) => part.toLowerCase().includes(normalizedQuery));
}
