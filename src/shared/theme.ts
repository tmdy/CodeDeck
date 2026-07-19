export type ThemeMode = "system" | "light" | "dark";
export type EffectiveTheme = "light" | "dark";

export const DEFAULT_THEME_MODE: ThemeMode = "system";

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === "light" || value === "dark" || value === "system"
    ? value
    : DEFAULT_THEME_MODE;
}

export function resolveEffectiveTheme(
  mode: ThemeMode,
  systemPrefersDark: boolean,
): EffectiveTheme {
  if (mode === "dark") return "dark";
  if (mode === "light") return "light";
  return systemPrefersDark ? "dark" : "light";
}
