import { describe, expect, it } from "vitest";
import {
  CODEX_DESKTOP_HANDOFF_MARKER,
  buildCodexAppServerArgs,
  buildCodexDesktopThreadStartRequest,
  buildCodexDesktopNewThreadUrl,
  buildCodexDesktopThreadUrl,
  hasCodexDesktopHandoffMarker,
  validateCodexDesktopHandoffLaunch,
  validateCodexDesktopThreadProvider,
} from "./codex-desktop-handoff.js";

describe("Codex Desktop handoff", () => {
  it("supports new and explicit selected sessions only", () => {
    expect(validateCodexDesktopHandoffLaunch("new")).toBeUndefined();
    expect(validateCodexDesktopHandoffLaunch("resume_selected", " session-1 "))
      .toBe("session-1");
    expect(() => validateCodexDesktopHandoffLaunch("continue_last"))
      .toThrow("仅支持“直接启动”或“恢复选中”");
  });

  it("appends the app-server transport after existing profile arguments", () => {
    expect(buildCodexAppServerArgs(
      ["--profile", "site_test", "--sandbox", "danger-full-access", "--disable", "hooks"],
      "site_provider_test",
    )).toEqual([
      "--disable",
      "hooks",
      "-c",
      'model_provider="site_provider_test"',
      "app-server",
      "--stdio",
    ]);
  });

  it("pins the selected provider on the thread/start request", () => {
    expect(buildCodexDesktopThreadStartRequest(7, {
      cwd: "D:\\CodeDeck",
      model: " gpt-test ",
      modelProvider: " site_provider_test ",
    })).toEqual({
      method: "thread/start",
      id: 7,
      params: {
        cwd: "D:\\CodeDeck",
        serviceName: "codedeck_desktop_handoff",
        model: "gpt-test",
        modelProvider: "site_provider_test",
      },
    });
  });

  it("fails closed when app-server returns a different or missing provider", () => {
    expect(() => validateCodexDesktopThreadProvider(
      "site_provider_test",
      "openai_http",
    )).toThrow("expected site_provider_test, got openai_http");
    expect(() => validateCodexDesktopThreadProvider(
      "site_provider_test",
      undefined,
    )).toThrow("expected site_provider_test, got unknown");
    expect(() => validateCodexDesktopThreadProvider(
      "site_provider_test",
      "site_provider_test",
    )).not.toThrow();
  });

  it("accepts only the exact TUI Desktop-open acknowledgement", () => {
    expect(hasCodexDesktopHandoffMarker(`\u001b[2m${CODEX_DESKTOP_HANDOFF_MARKER}\u001b[0m`))
      .toBe(true);
    expect(hasCodexDesktopHandoffMarker("Opening desktop"))
      .toBe(false);
    expect(hasCodexDesktopHandoffMarker("codex://threads/session-1"))
      .toBe(false);
  });

  it("builds encoded workspace and exact-thread routes", () => {
    expect(buildCodexDesktopNewThreadUrl("D:\\hermes android"))
      .toBe("codex://threads/new?path=D%3A%5Chermes+android");
    expect(buildCodexDesktopThreadUrl(" 01a0-test "))
      .toBe("codex://threads/01a0-test");
  });
});
