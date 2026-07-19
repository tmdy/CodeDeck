import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveElectronRuntimePaths } from "./electron-runtime-paths.js";

describe("resolveElectronRuntimePaths", () => {
  it("uses appRoot instead of workspaceRoot for dev preload and dist paths", () => {
    const appRoot = "C:/repo/codedeck";
    const workspaceRoot = "C:/Users/test/.codedeck/workspace";

    const resolved = resolveElectronRuntimePaths({
      appRoot,
      workspaceRoot,
      isPackaged: false,
      mainDirname: path.join(appRoot, "dist-electron", "electron"),
      resourcesPath: "C:/unused/resources",
    });

    expect(resolved.preloadPath).toBe(path.join(appRoot, "dist-electron", "electron", "preload.js"));
    expect(resolved.distIndexPath).toBe(path.join(appRoot, "dist", "index.html"));
    expect(resolved.iconCandidates[0]).toBe(path.join(appRoot, "build", "icon.png"));
    expect(resolved.iconCandidates[1]).toBe(path.join(appRoot, "src", "assets", "hero.png"));
    expect(resolved.preloadPath).not.toContain(workspaceRoot);
  });

  it("uses packaged relative paths and resources when packaged", () => {
    const mainDirname = "C:/Program Files/CodeDeck/resources/app.asar/dist-electron/electron";
    const resolved = resolveElectronRuntimePaths({
      appRoot: "C:/repo/codedeck",
      workspaceRoot: "C:/Users/test/AppData/Roaming/CodeDeck/workspace",
      isPackaged: true,
      mainDirname,
      resourcesPath: "C:/Program Files/CodeDeck/resources",
    });

    expect(resolved.preloadPath).toBe(path.join(mainDirname, "preload.js"));
    expect(resolved.distIndexPath).toBe(path.join(mainDirname, "..", "..", "dist", "index.html"));
    expect(resolved.iconCandidates).toEqual([
      path.join("C:/Program Files/CodeDeck/resources", "icon.png"),
    ]);
  });
});
