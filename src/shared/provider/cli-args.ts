export function parseCliArgs(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  const args: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaping = false;
  let tokenStarted = false;

  for (const char of trimmed) {
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

    if (quote === "'") {
      if (char === "'") {
        quote = null;
      } else {
        current += char;
      }
      tokenStarted = true;
      continue;
    }

    if (quote === "\"") {
      if (char === "\"") {
        quote = null;
      } else {
        current += char;
      }
      tokenStarted = true;
      continue;
    }

    if (/\s/.test(char)) {
      if (tokenStarted) {
        args.push(current);
        current = "";
        tokenStarted = false;
      }
      continue;
    }

    if (char === "'" || char === "\"") {
      quote = char;
      tokenStarted = true;
      continue;
    }

    current += char;
    tokenStarted = true;
  }

  if (escaping) {
    current += "\\";
  }
  if (tokenStarted) {
    args.push(current);
  }

  return args;
}

export function renderPreviewCommand(commandBase: string, args: string[]): string {
  return [formatPreviewToken(commandBase), ...args.map((arg) => formatPreviewToken(arg))]
    .filter(Boolean)
    .join(" ");
}

export function formatPreviewToken(value: string, forceQuote = false): string {
  if (!value) {
    return "";
  }
  if (!forceQuote && !/[\s,]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, "\\\"")}"`;
}
