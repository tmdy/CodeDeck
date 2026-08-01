export interface RuntimeEnvTextParseResult {
  values: Record<string, string>;
  invalidLineNumbers: number[];
}

export function parseRuntimeEnvText(text: string): RuntimeEnvTextParseResult {
  const entries = new Map<string, string>();
  const invalidLineNumbers: number[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");

  lines.forEach((line, index) => {
    if (!line.trim()) {
      return;
    }

    const separatorIndex = line.indexOf("=");
    const key = separatorIndex >= 0 ? line.slice(0, separatorIndex).trim() : "";
    if (separatorIndex < 0 || !key) {
      invalidLineNumbers.push(index + 1);
      return;
    }

    entries.set(key, line.slice(separatorIndex + 1));
  });

  return {
    values: Object.fromEntries(entries),
    invalidLineNumbers,
  };
}
