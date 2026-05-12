import { describe, expect, it } from "vitest";
import {
  normalizeThemeMode,
  resolveEffectiveTheme,
} from "./theme.js";

describe("theme helpers", () => {
  it("should normalize invalid theme modes to system", () => {
    expect(normalizeThemeMode("light")).toBe("light");
    expect(normalizeThemeMode("dark")).toBe("dark");
    expect(normalizeThemeMode("system")).toBe("system");
    expect(normalizeThemeMode("unknown")).toBe("system");
    expect(normalizeThemeMode(undefined)).toBe("system");
  });

  it("should resolve system theme from OS preference", () => {
    expect(resolveEffectiveTheme("system", true)).toBe("dark");
    expect(resolveEffectiveTheme("system", false)).toBe("light");
    expect(resolveEffectiveTheme("dark", false)).toBe("dark");
    expect(resolveEffectiveTheme("light", true)).toBe("light");
  });
});
