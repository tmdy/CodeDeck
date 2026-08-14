interface ParsedCliArg {
  value: string;
  start: number;
  end: number;
}

function parseCliArgSpans(input: string): ParsedCliArg[] {
  const args: ParsedCliArg[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  let tokenStarted = false;
  let tokenStart = 0;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (!tokenStarted && !quote && !/\s/.test(char)) tokenStart = index;
    if (escaping) {
      current += char;
      tokenStarted = true;
      escaping = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaping = true;
      tokenStarted = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = null;
      else current += char;
      tokenStarted = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (tokenStarted) {
        args.push({ value: current, start: tokenStart, end: index });
        current = "";
        tokenStarted = false;
      }
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      tokenStarted = true;
      continue;
    }
    current += char;
    tokenStarted = true;
  }
  if (escaping) current += "\\";
  if (tokenStarted) args.push({ value: current, start: tokenStart, end: input.length });
  return args;
}

export function parseCliArgs(input: string): string[] {
  return parseCliArgSpans(input).map((arg) => arg.value);
}

export function renderPreviewCommand(commandBase: string, args: string[]): string {
  return [formatPreviewToken(commandBase), ...args.map((arg) => formatPreviewToken(arg))]
    .filter(Boolean)
    .join(" ");
}

export function formatPreviewToken(value: string, forceQuote = false): string {
  if (!value) return "";
  if (!forceQuote && !/[\s,]/.test(value)) return value;
  return `"${value.replace(/"/g, "\\\"")}"`;
}

function argumentTokens(value: string): string[] {
  try {
    return parseCliArgs(value);
  } catch {
    return value.trim() ? value.trim().split(/\s+/) : [];
  }
}

export function hasSavedArgText(current: string, savedValue: string): boolean {
  const currentTokens = argumentTokens(current);
  const savedTokens = argumentTokens(savedValue);
  if (savedTokens.length === 0) return false;
  return currentTokens.some((_, index) =>
    currentTokens.slice(index, index + savedTokens.length).every(
      (token, tokenIndex) => token === savedTokens[tokenIndex],
    )
  );
}

export function toggleSavedArgText(current: string, savedValue: string): string {
  const currentArgs = parseCliArgSpans(current);
  const currentTokens = currentArgs.map((arg) => arg.value);
  const savedTokens = argumentTokens(savedValue);
  if (savedTokens.length === 0) return current;
  const index = currentTokens.findIndex((_, tokenIndex) =>
    currentTokens.slice(tokenIndex, tokenIndex + savedTokens.length).every(
      (token, savedIndex) => token === savedTokens[savedIndex],
    )
  );
  if (index < 0) {
    return [current.trim(), savedValue.trim()].filter(Boolean).join(" ");
  }
  const start = currentArgs[index].start;
  const end = currentArgs[index + savedTokens.length - 1].end;
  const before = current.slice(0, start).replace(/\s+$/, "");
  const after = current.slice(end).replace(/^\s+/, "");
  return [before, after].filter(Boolean).join(" ").trim();
}
