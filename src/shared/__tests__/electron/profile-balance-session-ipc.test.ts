import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

describe("profile balance session IPC", () => {
  it("keeps the profile binding channel synchronized across main, preload, and renderer types", async () => {
    const [mainSource, preloadSource, envSource] = await Promise.all([
      readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8"),
      readFile(path.join(process.cwd(), "electron", "preload.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src", "env.d.ts"), "utf8"),
    ]).then((sources) => sources.map(normalizeNewlines));

    expect(mainSource).toContain('"profile:bind-site-balance-session"');
    expect(mainSource).toContain(
      "getProfileService().bindProfileSiteBalanceSession(profileKey, baseUrl, sessionId)",
    );
    expect(preloadSource).toContain("bindProfileSiteBalanceSession: (");
    expect(preloadSource).toContain(
      'ipcRenderer.invoke(\n    "profile:bind-site-balance-session",\n    profileKey,\n    baseUrl,\n    sessionId,\n  )',
    );
    expect(envSource).toContain("bindProfileSiteBalanceSession?: (");
  });

  it("routes Profile URL opening through an internal browser with the selected browser account", async () => {
    const [mainSource, preloadSource, envSource, appSource] = await Promise.all([
      readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8"),
      readFile(path.join(process.cwd(), "electron", "preload.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src", "env.d.ts"), "utf8"),
      readFile(path.join(process.cwd(), "src", "App.tsx"), "utf8"),
    ]).then((sources) => sources.map(normalizeNewlines));

    expect(mainSource).toContain("await openProfileSiteBrowser(baseUrl, balanceSessionId);");
    expect(mainSource).toContain("getBrowserAccountSessionManager().getPartitionName(selectedAccount)");
    expect(mainSource).toContain("DEFAULT_PROFILE_BROWSER_PARTITION");
    expect(mainSource).toContain("configureInteractiveWindow: installBrowserNavigationMenu");
    expect(mainSource).toContain("runBrowserNavigationAction(browserWindow.webContents, action)");
    expect(mainSource).toContain('{ label: "后退", accelerator: "Alt+Left"');
    expect(mainSource).toContain('{ label: "前进", accelerator: "Alt+Right"');
    expect(mainSource).not.toContain("shell.openExternal");
    expect(preloadSource).toContain(
      'openBaseUrl: (baseUrl: string, balanceSessionId?: string): Promise<void> =>\n    ipcRenderer.invoke("profile:open-base-url", baseUrl, balanceSessionId)',
    );
    expect(envSource).toContain(
      "openBaseUrl: (baseUrl: string, balanceSessionId?: string) => Promise<void>;",
    );
    expect(appSource).toContain("session.auth_kind === \"browser_session\"");
    expect(appSource).toContain(
      "window.profileManager.openBaseUrl(draftUrl, selectedBrowserAccount?.id)",
    );
  });
});
