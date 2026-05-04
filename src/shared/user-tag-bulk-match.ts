import type { SkillRecord } from "./types.js";

export interface BulkTagMatchIssue {
  line: string;
  normalizedName: string;
}

export interface BulkTagAmbiguousIssue extends BulkTagMatchIssue {
  candidateSkillIds: string[];
}

export interface BulkTagPlan {
  matchedSkillIds: string[];
  unmatchedItems: string[];
  ambiguousItems: BulkTagAmbiguousIssue[];
}

interface MatchCandidate {
  normalizedName: string;
  compactName: string;
  tokenSignature: string;
  tokenSet: Set<string>;
}

function singularizeToken(token: string): string {
  if (token.length > 3 && token.endsWith("s")) {
    return token.slice(0, -1);
  }
  return token;
}

function buildTokenSignature(value: string): string {
  const tokens = value
    .split(" ")
    .map((token) => singularizeToken(token.trim()))
    .filter(Boolean);

  return [...new Set(tokens)].sort().join(" ");
}

function buildTokenSet(value: string): Set<string> {
  return new Set(
    value
      .split(" ")
      .map((token) => singularizeToken(token.trim()))
      .filter(Boolean),
  );
}

function compactSkillMatchName(value: string): string {
  return value.replace(/\s+/g, "");
}

export function normalizeSkillMatchName(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[()[\]{}]/g, " ")
    .replace(/[–—_/\\:+.,'"]/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\u4e00-\u9fff\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildLineCandidates(line: string): MatchCandidate[] {
  const label = line.split(/\s+[—-]\s+/u, 1)[0]?.trim() ?? line.trim();
  const variants = new Set<string>();

  if (label) {
    variants.add(label);
    variants.add(label.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim());
  }

  return [...variants]
    .map((variant) => normalizeSkillMatchName(variant))
    .filter(Boolean)
    .map((normalizedName) => ({
      normalizedName,
      compactName: compactSkillMatchName(normalizedName),
      tokenSignature: buildTokenSignature(normalizedName),
      tokenSet: buildTokenSet(normalizedName),
    }));
}

function shouldSkipLine(line: string): boolean {
  if (!line) {
    return true;
  }

  if (/\s+[—-]\s+/u.test(line)) {
    return false;
  }

  return /\(\d+\s+skills?\)\s*$/iu.test(line);
}

function buildRecordCandidates(record: SkillRecord): MatchCandidate[] {
  const variants = new Set<string>([
    record.directoryName,
    record.displayName,
    record.skillId.replace(/^[^:]+:/, ""),
  ]);

  return [...variants]
    .map((variant) => normalizeSkillMatchName(variant))
    .filter(Boolean)
    .map((normalizedName) => ({
      normalizedName,
      compactName: compactSkillMatchName(normalizedName),
      tokenSignature: buildTokenSignature(normalizedName),
      tokenSet: buildTokenSet(normalizedName),
    }));
}

function isUniqueSubsetMatch(lineTokenSet: Set<string>, recordTokenSet: Set<string>): boolean {
  if (lineTokenSet.size === 0 || lineTokenSet.size > recordTokenSet.size) {
    return false;
  }

  for (const token of lineTokenSet) {
    if (!recordTokenSet.has(token)) {
      return false;
    }
  }

  return true;
}

function matchLineToRecords(records: SkillRecord[], line: string): {
  matches: SkillRecord[];
  normalizedName: string;
} {
  const lineCandidates = buildLineCandidates(line);
  const normalizedName = lineCandidates[0]?.normalizedName ?? "";

  const matches = records.filter((record) => {
    const recordCandidates = buildRecordCandidates(record);
    return lineCandidates.some((lineCandidate) => recordCandidates.some((recordCandidate) => (
      lineCandidate.normalizedName === recordCandidate.normalizedName
      || lineCandidate.compactName === recordCandidate.compactName
      || lineCandidate.tokenSignature === recordCandidate.tokenSignature
      || isUniqueSubsetMatch(lineCandidate.tokenSet, recordCandidate.tokenSet)
    )));
  });

  return {
    matches,
    normalizedName,
  };
}

export function buildAiResearchTagPlan(records: SkillRecord[], rawLines: string[]): BulkTagPlan {
  const matchedSkillIds = new Set<string>();
  const unmatchedItems: string[] = [];
  const ambiguousItems: BulkTagAmbiguousIssue[] = [];

  for (const rawLine of rawLines) {
    const line = rawLine.trim();
    if (shouldSkipLine(line)) {
      continue;
    }

    const { matches, normalizedName } = matchLineToRecords(records, line);
    if (matches.length === 1) {
      matchedSkillIds.add(matches[0].skillId);
      continue;
    }
    if (matches.length > 1) {
      ambiguousItems.push({
        line,
        normalizedName,
        candidateSkillIds: matches.map((record) => record.skillId).sort(),
      });
      continue;
    }
    unmatchedItems.push(line);
  }

  return {
    matchedSkillIds: [...matchedSkillIds].sort(),
    unmatchedItems,
    ambiguousItems,
  };
}
