import { describe, expect, it } from "vitest";
import {
  defaultParameterSettings,
  normalizeParameterSettings,
} from "./types.js";

describe("normalizeParameterSettings auto-continue intervals", () => {
  it("migrates an existing interval to fixed mode with the default standard deviation", () => {
    const legacyTerminal = { ...defaultParameterSettings().terminal };
    delete (legacyTerminal as Partial<typeof legacyTerminal>).auto_continue_interval_mode;
    delete (legacyTerminal as Partial<typeof legacyTerminal>).auto_continue_interval_stddev_ms;
    legacyTerminal.auto_continue_interval_ms = 2_500;
    const settings = normalizeParameterSettings({
      terminal: legacyTerminal,
    });

    expect(settings.terminal).toMatchObject({
      auto_continue_interval_ms: 2_500,
      auto_continue_interval_mode: "fixed",
      auto_continue_interval_stddev_ms: 1_000,
    });
  });

  it("normalizes invalid random interval values to non-negative milliseconds", () => {
    const settings = normalizeParameterSettings({
      terminal: {
        ...defaultParameterSettings().terminal,
        auto_continue_interval_mode: "normal",
        auto_continue_interval_ms: -500,
        auto_continue_interval_stddev_ms: Number.NaN,
      },
    });

    expect(settings.terminal).toMatchObject({
      auto_continue_interval_mode: "normal",
      auto_continue_interval_ms: 0,
      auto_continue_interval_stddev_ms: 0,
    });
  });
});

describe("saved extra arguments", () => {
  it("defaults missing provider lists and normalizes malformed entries", () => {
    const settings = normalizeParameterSettings({
      cli_settings: {
        claude: {
          setting_sources: "project,local",
          saved_extra_args: [
            { id: " keep ", value: " --one ", enabled: false },
            { value: "--two" },
            null,
          ] as never,
        },
      } as never,
    });

    expect(settings.cli_settings.claude.saved_extra_args).toEqual([
      { id: "keep", value: " --one ", enabled: false },
      { id: "saved-extra-arg-2", value: "--two", enabled: true },
    ]);
    expect(settings.cli_settings.codex.saved_extra_args).toEqual([]);
  });
});
