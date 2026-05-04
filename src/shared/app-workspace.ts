import path from "node:path";
import { promises as fs } from "node:fs";
import { copyDirectory, ensureDirectory, pathExists } from "./filesystem.js";

export interface WorkspaceLayoutOptions {
  cwd: string;
  envProjectRoot?: string;
  isPackaged: boolean;
  resourcesPath?: string;
  userDataPath?: string;
}

export interface WorkspaceLayout {
  workspaceRoot: string;
  seedRoot?: string;
}

interface InitializeWorkspaceOptions {
  copyDirectoryFn?: typeof copyDirectory;
}

export function resolveWorkspaceLayout(options: WorkspaceLayoutOptions): WorkspaceLayout {
  const envProjectRoot = options.envProjectRoot?.trim();
  if (envProjectRoot) {
    return {
      workspaceRoot: path.resolve(envProjectRoot),
    };
  }

  // 打包模式：使用 userData 作为固定工作区
  if (options.isPackaged) {
    if (!options.userDataPath || !options.resourcesPath) {
      throw new Error("打包模式下必须提供 userDataPath 和 resourcesPath。");
    }

    return {
      workspaceRoot: path.join(options.userDataPath, "workspace"),
      seedRoot: path.join(options.resourcesPath, "workspace-seed"),
    };
  }

  return {
    workspaceRoot: path.resolve(options.cwd),
  };
}

export async function initializeWorkspace(
  layout: WorkspaceLayout,
  options: InitializeWorkspaceOptions = {},
): Promise<void> {
  const copyDirectoryFn = options.copyDirectoryFn ?? copyDirectory;
  await ensureDirectory(layout.workspaceRoot);
  await ensureDirectory(path.join(layout.workspaceRoot, "app-data"));

  if (!layout.seedRoot || !(await pathExists(layout.seedRoot))) {
    return;
  }

  const seedLibraryPath = path.join(layout.seedRoot, "library");
  const workspaceLibraryPath = path.join(layout.workspaceRoot, "library");
  if ((await pathExists(seedLibraryPath)) && !(await pathExists(workspaceLibraryPath))) {
    await copyDirectoryFn(seedLibraryPath, workspaceLibraryPath);
  }

  const seedTranslationsPath = path.join(layout.seedRoot, "app-data", "translations.json");
  const workspaceTranslationsPath = path.join(layout.workspaceRoot, "app-data", "translations.json");
  if ((await pathExists(seedTranslationsPath)) && !(await pathExists(workspaceTranslationsPath))) {
    await fs.copyFile(seedTranslationsPath, workspaceTranslationsPath);
  }
}
