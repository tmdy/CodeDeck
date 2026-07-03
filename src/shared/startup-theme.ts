import {
  normalizeThemeMode,
  resolveEffectiveTheme,
  type EffectiveTheme,
  type ThemeMode,
} from "./theme.js";

export interface StartupTheme {
  themeMode: ThemeMode;
  effectiveTheme: EffectiveTheme;
}

export function createStartupTheme(
  mode: unknown,
  systemPrefersDark: boolean,
): StartupTheme {
  const themeMode = normalizeThemeMode(mode);
  return {
    themeMode,
    effectiveTheme: resolveEffectiveTheme(themeMode, systemPrefersDark),
  };
}

export function parseStartupTheme(value: unknown): StartupTheme | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as { themeMode?: unknown; effectiveTheme?: unknown };
  const themeMode = normalizeThemeMode(record.themeMode);
  const effectiveTheme = record.effectiveTheme === "dark" || record.effectiveTheme === "light"
    ? record.effectiveTheme
    : null;
  if (!effectiveTheme) {
    return null;
  }
  return { themeMode, effectiveTheme };
}

export function serializeStartupTheme(theme: StartupTheme): string {
  return encodeURIComponent(JSON.stringify(theme));
}

export function parseSerializedStartupTheme(value: string | undefined): StartupTheme | null {
  if (!value) {
    return null;
  }
  try {
    return parseStartupTheme(JSON.parse(decodeURIComponent(value)));
  } catch {
    return null;
  }
}
