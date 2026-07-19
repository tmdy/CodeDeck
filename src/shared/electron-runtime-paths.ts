import path from "node:path";

export interface ElectronRuntimePathOptions {
  appRoot: string;
  workspaceRoot: string;
  isPackaged: boolean;
  mainDirname: string;
  resourcesPath: string;
}

export interface ElectronRuntimePaths {
  iconCandidates: string[];
  distIndexPath: string;
  preloadPath: string;
}

export function resolveElectronRuntimePaths(
  options: ElectronRuntimePathOptions,
): ElectronRuntimePaths {
  if (options.isPackaged) {
    return {
      iconCandidates: [path.join(options.resourcesPath, "icon.png")],
      distIndexPath: path.join(options.mainDirname, "..", "..", "dist", "index.html"),
      preloadPath: path.join(options.mainDirname, "preload.js"),
    };
  }

  return {
    iconCandidates: [
      path.join(options.appRoot, "build", "icon.png"),
      path.join(options.appRoot, "src", "assets", "hero.png"),
    ],
    distIndexPath: path.join(options.appRoot, "dist", "index.html"),
    preloadPath: path.join(options.appRoot, "dist-electron", "electron", "preload.js"),
  };
}
