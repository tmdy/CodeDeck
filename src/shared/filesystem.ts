import { promises as fs } from "node:fs";
import path from "node:path";

export interface DirectorySizeStats {
  skillMdBytes: number;
  bodyBytes: number;
  totalBytes: number;
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

export async function computeDirectorySizeStats(root: string): Promise<DirectorySizeStats> {
  let skillMdBytes = 0;
  let bodyBytes = 0;

  async function walk(currentPath: string): Promise<void> {
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

    const fileStats = await Promise.all(files.map(async (file) => ({
      name: file.name,
      stat: await fs.stat(file.absolute),
    })));

    for (const { name, stat } of fileStats) {
      if (name === "SKILL.md") {
        skillMdBytes += stat.size;
      } else {
        bodyBytes += stat.size;
      }
    }

    await Promise.all(childDirectories.map((absolute) => walk(absolute)));
  }

  await walk(root);
  return {
    skillMdBytes,
    bodyBytes,
    totalBytes: skillMdBytes + bodyBytes,
  };
}

export async function moveDirectory(sourcePath: string, targetPath: string): Promise<void> {
  await ensureDirectory(path.dirname(targetPath));
  await fs.rename(sourcePath, targetPath);
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
