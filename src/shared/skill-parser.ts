import { buildSummary } from "./summary.js";

export interface ParsedSkillMd {
  displayName: string;
  description: string;
  summary: string;
  tags: string[];
  title: string;
  body: string;
}

function coerceString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function coerceTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => coerceString(item)).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function extractTitle(content: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  return match?.[1]?.trim() ?? "";
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function parseLenientFrontmatter(markdown: string): { data: Record<string, unknown>; body: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { data: {}, body: markdown };
  }

  const [, rawFrontmatter, body] = match;
  const data: Record<string, unknown> = {};
  let currentArrayKey: string | null = null;
  const lines = rawFrontmatter.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      continue;
    }

    const arrayMatch = line.match(/^\s*-\s*(.+)\s*$/);
    if (arrayMatch && currentArrayKey) {
      const current = Array.isArray(data[currentArrayKey]) ? (data[currentArrayKey] as string[]) : [];
      current.push(stripQuotes(arrayMatch[1]));
      data[currentArrayKey] = current;
      continue;
    }

    const keyValueMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyValueMatch) {
      currentArrayKey = null;
      continue;
    }

    const [, key, rawValue] = keyValueMatch;
    if (["|", "|-", "|+", ">", ">-", ">+"].includes(rawValue.trim())) {
      const blockLines: string[] = [];
      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        if (nextLine.trim() && !/^\s/.test(nextLine)) {
          break;
        }
        blockLines.push(nextLine.replace(/^\s{2}/, ""));
        index += 1;
      }
      data[key] = rawValue.trim().startsWith(">")
        ? blockLines.map((item) => item.trim()).filter(Boolean).join(" ")
        : blockLines.join("\n").trim();
      currentArrayKey = null;
      continue;
    }

    if (!rawValue) {
      data[key] = [];
      currentArrayKey = key;
      continue;
    }

    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      data[key] = rawValue
        .slice(1, -1)
        .split(",")
        .map((item) => stripQuotes(item))
        .filter(Boolean);
      currentArrayKey = null;
      continue;
    }

    data[key] = stripQuotes(rawValue);
    currentArrayKey = null;
  }

  return { data, body };
}

export function parseSkillMarkdown(directoryName: string, markdown: string): ParsedSkillMd {
  const parsed = parseLenientFrontmatter(markdown);
  const displayName = coerceString(parsed.data.name) || directoryName;
  const description = coerceString(parsed.data.description);
  const tags = coerceTags(parsed.data.tags);
  const body = parsed.body.trim();
  const title = extractTitle(body);

  return {
    displayName,
    description,
    tags,
    title,
    body,
    summary: buildSummary({
      directoryName,
      description,
      tags,
      title,
      body,
    }),
  };
}
