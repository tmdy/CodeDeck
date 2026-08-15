import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

describe("Electron main tray lifecycle", () => {
  it("syncs the persisted preference and only intercepts main-window close", async () => {
    const source = normalizeNewlines(await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8"));
    const mainWindowStart = source.indexOf("async function createMainWindow");
    const mainWindowEnd = source.indexOf("async function createTerminalWindow", mainWindowStart);
    const mainWindowBlock = source.slice(mainWindowStart, mainWindowEnd);
    const terminalWindowStart = mainWindowEnd;
    const terminalWindowEnd = source.indexOf("async function reactivateMainWindow", terminalWindowStart);
    const terminalWindowBlock = source.slice(terminalWindowStart, terminalWindowEnd);

    expect(source).toContain("syncCloseToTraySetting(state.global_settings.close_to_tray)");
    expect(source).toContain("syncCloseToTraySetting(updated.close_to_tray)");
    expect(mainWindowBlock).toContain('browserWindow.on("close", (event) => {');
    expect(mainWindowBlock).toContain("event.preventDefault();");
    expect(mainWindowBlock).toContain("browserWindow.hide();");
    expect(terminalWindowBlock).not.toContain("closeToTrayEnabled");
    expect(terminalWindowBlock).not.toContain('browserWindow.on("close"');
  });

  it("reopens from the tray and lets explicit quit bypass hiding", async () => {
    const source = normalizeNewlines(await readFile(path.join(process.cwd(), "electron", "main.ts"), "utf8"));
    const trayStart = source.indexOf("function ensureAppTray");
    const trayEnd = source.indexOf("function syncCloseToTraySetting", trayStart);
    const trayBlock = source.slice(trayStart, trayEnd);
    const beforeQuitStart = source.indexOf('app.on("before-quit"');
    const beforeQuitEnd = source.indexOf('app.on("window-all-closed"', beforeQuitStart);
    const beforeQuitBlock = source.slice(beforeQuitStart, beforeQuitEnd);

    expect(trayBlock).toContain("new Tray(iconPath)");
    expect(trayBlock).toContain('label: "打开 CodeDeck"');
    expect(trayBlock).toContain('reactivateMainWindow("tray")');
    expect(trayBlock).toContain('{ label: "退出", click: requestExplicitQuit }');
    expect(source).toContain("isExplicitlyQuitting = true;\n  app.quit();");
    expect(beforeQuitBlock).toContain("isExplicitlyQuitting = true;");
    expect(beforeQuitBlock).toContain("destroyAppTray();");
  });
});
