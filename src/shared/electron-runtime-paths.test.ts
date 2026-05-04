import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveElectronRuntimePaths } from "./electron-runtime-paths.js";

describe("resolveElectronRuntimePaths", () => {
  it("uses appRoot instead of workspaceRoot for dev preload and dist paths", () => {
    const appRoot = "C:/repo/skills-manager";
    const workspaceRoot = "C:/Users/test/.skills-manager/workspace";

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
    const mainDirname = "C:/Program Files/Skills Manager/resources/app.asar/dist-electron/electron";
    const resolved = resolveElectronRuntimePaths({
      appRoot: "C:/repo/skills-manager",
      workspaceRoot: "C:/Users/test/AppData/Roaming/Skills Manager/workspace",
      isPackaged: true,
      mainDirname,
      resourcesPath: "C:/Program Files/Skills Manager/resources",
    });

    expect(resolved.preloadPath).toBe(path.join(mainDirname, "preload.js"));
    expect(resolved.distIndexPath).toBe(path.join(mainDirname, "..", "..", "dist", "index.html"));
    expect(resolved.iconCandidates).toEqual([
      path.join("C:/Program Files/Skills Manager/resources", "icon.png"),
    ]);
  });
});
