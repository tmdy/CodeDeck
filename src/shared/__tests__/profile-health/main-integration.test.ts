import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("profile health Electron integration", () => {
  it("binds passive health only to monitored terminal lifecycle completion", async () => {
    const source = await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf-8");

    expect(source).toContain('if (event.reason === "turn_completed")');
    expect(source).toContain("terminalProfileHealthTargets.get(event.sessionId)");
    expect(source).toContain("terminalProfileHealthTargets.set(snapshot.sessionId, healthTarget)");
    expect(source).toContain("terminalProfileHealthTargets.delete(event.sessionId)");
    expect(source.indexOf("terminalProfileHealthTargets.set(snapshot.sessionId, healthTarget)"))
      .toBeGreaterThan(source.indexOf('if (plan.terminalMode === "monitored")'));
  });

  it("runs active probes through a fresh hidden monitored CLI session", async () => {
    const [mainSource, preloadSource, serviceSource] = await Promise.all([
      readFile(path.join(process.cwd(), "electron", "main.ts"), "utf-8"),
      readFile(path.join(process.cwd(), "electron", "preload.ts"), "utf-8"),
      readFile(path.join(process.cwd(), "src", "shared", "profile-health", "service.ts"), "utf-8"),
    ]);

    expect(mainSource).toContain('"profile-health:test"');
    expect(mainSource).toContain("{ includeArgs: false }");
    expect(mainSource).toContain("runProfileHealthCliProbe");
    expect(mainSource).toContain("launch_mode: \"new\"");
    expect(mainSource).toContain("showWindow: false");
    expect(mainSource).toContain("buildProfileHealthPrompt(options.previous?.checkpoint)");
    expect(mainSource).toContain("waitForProfileHealthTurn");
    expect(mainSource).toContain("completedTerminalTurnFiles");
    expect(mainSource).toContain("completedTerminalTurnFiles.get(sessionId)");
    expect(mainSource).toContain('snapshot.status !== "running"');
    expect(mainSource).toContain("profileHealthCliQueue");
    expect(mainSource).toContain("enqueueProfileHealthCliProbe");
    expect(mainSource).toContain("ensureProfileHealthCodexHome(runtime.cwd)");
    expect(mainSource).toContain("codexHomeOverride: profileHealthCodexHome");
    expect(mainSource).toContain("codexHome: options.codexHomeOverride");
    expect(mainSource).toContain("codexHome: plan.env.CODEX_HOME");
    expect(mainSource).toContain("readProfileHealthAssistantText");
    expect(mainSource).toContain('closeSession(terminalSessionId, "profile_health_completed")');
    expect(mainSource).not.toContain("new ProfileHealthService");
    expect(mainSource).not.toContain("transientProfileHealthByTarget");
    expect(serviceSource).not.toContain("fetch(");
    expect(serviceSource).not.toContain("/responses");
    expect(serviceSource).not.toContain("chat/completions");
    expect(serviceSource).not.toContain("/messages");
    expect(preloadSource).toContain('ipcRenderer.invoke("profile-health:test", request)');
    expect(preloadSource).toContain('ipcRenderer.on("profile-health:progress", handler)');
  });

  it("gates the renderer action on a saved clean editor and persists progress only", async () => {
    const appSource = await readFile(path.join(process.cwd(), "src", "App.tsx"), "utf-8");

    expect(appSource).toContain("profileHealthDraftIsClean");
    expect(appSource).toContain("!hasProfileDraftChanges(currentDraftSnapshot(), editorBaseline)");
    expect(appSource).toContain('!draftCwd.trim() || !draftCommandBase.trim()');
    expect(appSource).toContain("onProfileHealthProgress");
    expect(appSource).not.toContain("draftHealthResult");
  });
});
