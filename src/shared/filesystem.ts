import { promises as fs } from "node:fs";
import path from "node:path";

type FileSystemError = Error & {
  code?: string;
};

interface MoveDirectoryFileSystem {
  access: typeof fs.access;
  cp: typeof fs.cp;
  mkdir: typeof fs.mkdir;
  rename: typeof fs.rename;
  rm: typeof fs.rm;
}

export interface DirectorySizeStats {
  skillMdBytes: number;
  bodyBytes: number;
  totalBytes: number;
  truncated: boolean;
  filesVisited: number;
  directoriesVisited: number;
}

export interface DirectorySizeStatsOptions {
  maxFiles?: number;
  maxDirectories?: number;
}

export async function ensureDirectory(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function pathExistsWithFileSystem(fileSystem: Pick<MoveDirectoryFileSystem, "access">, targetPath: string): Promise<boolean> {
  try {
    await fileSystem.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function shouldFallbackToCopyRemove(error: unknown): boolean {
  const code = (error as FileSystemError | undefined)?.code;
  return code === "EXDEV" || code === "EPERM" || code === "EACCES";
}

function formatMoveError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readUtf8IfExists(targetPath: string): Promise<string | undefined> {
  if (!(await pathExists(targetPath))) {
    return undefined;
  }
  return fs.readFile(targetPath, "utf8");
}

export async function listDirectories(root: string): Promise<string[]> {
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await fs.readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort((left, right) => left.localeCompare(right));
}

export async function computeDirectorySizeStats(root: string, options: DirectorySizeStatsOptions = {}): Promise<DirectorySizeStats> {
  const maxFiles = options.maxFiles ?? 5000;
  const maxDirectories = options.maxDirectories ?? 1000;
  let skillMdBytes = 0;
  let bodyBytes = 0;
  let filesVisited = 0;
  let directoriesVisited = 0;
  let truncated = false;
  const pendingDirectories = [root];

  while (pendingDirectories.length > 0 && !truncated) {
    if (directoriesVisited >= maxDirectories) {
      truncated = true;
      break;
    }

    const currentPath = pendingDirectories.shift()!;
    directoriesVisited += 1;
    const entries = await fs.readdir(currentPath, { withFileTypes: true });
    const childDirectories: string[] = [];
    const files: Array<{ name: string; absolute: string }> = [];

    for (const entry of entries) {
      const absolute = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        childDirectories.push(absolute);
        continue;
      }

      files.push({ name: entry.name, absolute });
    }

    files.sort((left, right) => {
      if (left.name === "SKILL.md") {
        return -1;
      }
      if (right.name === "SKILL.md") {
        return 1;
      }
      return left.name.localeCompare(right.name);
    });

    const childFileStats: Array<{ name: string; size: number }> = [];
    for (const file of files) {
      if (filesVisited >= maxFiles) {
        truncated = true;
        break;
      }

      childFileStats.push({
        name: file.name,
        size: (await fs.stat(file.absolute)).size,
      });
      filesVisited += 1;
    }

    for (const { name, size } of childFileStats) {
      if (name === "SKILL.md") {
        skillMdBytes += size;
      } else {
        bodyBytes += size;
      }
    }

    if (!truncated) {
      pendingDirectories.push(...childDirectories.sort((left, right) => left.localeCompare(right)));
    }
  }

  return {
    skillMdBytes,
    bodyBytes,
    totalBytes: skillMdBytes + bodyBytes,
    truncated,
    filesVisited,
    directoriesVisited,
  };
}

export async function moveDirectory(sourcePath: string, targetPath: string): Promise<void> {
  await moveDirectoryWithFileSystem(fs, sourcePath, targetPath);
}

export async function moveDirectoryWithFileSystem(
  fileSystem: MoveDirectoryFileSystem,
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await fileSystem.mkdir(path.dirname(targetPath), { recursive: true });
  try {
    await fileSystem.rename(sourcePath, targetPath);
    return;
  } catch (error) {
    if (!shouldFallbackToCopyRemove(error)) {
      throw error;
    }

    if (await pathExistsWithFileSystem(fileSystem, targetPath)) {
      throw new Error(`无法移动目录，目标路径已存在：${targetPath}`);
    }

    await fileSystem.cp(sourcePath, targetPath, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });

    try {
      await fileSystem.rm(sourcePath, { recursive: true, force: false });
    } catch (removeError) {
      await fileSystem.rm(targetPath, { recursive: true, force: true });
      throw new Error(
        `目录已复制但删除源目录失败，已清理目标目录。原始移动错误：${formatMoveError(error)}；删除错误：${formatMoveError(removeError)}`,
      );
    }
  }
}

export async function copyDirectory(sourcePath: string, targetPath: string): Promise<void> {
  await ensureDirectory(path.dirname(targetPath));
  await fs.cp(sourcePath, targetPath, { recursive: true });
}

export async function writeJson(targetPath: string, value: unknown): Promise<void> {
  await ensureDirectory(path.dirname(targetPath));
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function readJson<T>(targetPath: string): Promise<T | undefined> {
  if (!(await pathExists(targetPath))) {
    return undefined;
  }
  const content = await fs.readFile(targetPath, "utf8");
  return JSON.parse(content) as T;
}
