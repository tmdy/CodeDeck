import type { SkillRecord } from "./types.js";

interface ParsedSearchTerms {
  include: string[];
  exclude: string[];
}

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

function parseSearchTerms(query: string): ParsedSearchTerms {
  const include: string[] = [];
  const exclude: string[] = [];

  for (const rawToken of query.trim().toLowerCase().split(/\s+/)) {
    const token = rawToken.trim();
    if (!token) {
      continue;
    }
    if (token.startsWith("-") && token.length > 1) {
      exclude.push(token.slice(1));
      continue;
    }
    if (token !== "-") {
      include.push(token);
    }
  }

  return { include, exclude };
}

export function matchesSkillSearch(record: Pick<SkillRecord, "displayName" | "directoryName" | "summary" | "sourcePath" | "tags" | "userTags">, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  const { include, exclude } = parseSearchTerms(normalizedQuery);

  const searchableParts = [
    record.displayName,
    record.directoryName,
    record.summary,
    record.sourcePath,
    ...record.userTags,
  ].map((part) => part.toLowerCase());

  const includesAllKeywords = include.every((keyword) => (
    searchableParts.some((part) => part.includes(keyword))
  ));
  if (!includesAllKeywords) {
    return false;
  }

  const matchesExcludedKeyword = exclude.some((keyword) => (
    searchableParts.some((part) => part.includes(keyword))
  ));
  return !matchesExcludedKeyword;
}
