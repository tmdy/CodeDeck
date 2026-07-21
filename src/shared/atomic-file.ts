import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const writeQueues = new Map<string, Promise<void>>();

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function backupPathFor(targetPath: string): string {
  return `${targetPath}.bak`;
}

/** Recover the only interrupted state where the target was moved aside. */
export async function recoverAtomicWrite(targetPath: string): Promise<void> {
  const backupPath = backupPathFor(targetPath);
  const [hasTarget, hasBackup] = await Promise.all([
    pathExists(targetPath),
    pathExists(backupPath),
  ]);
  if (!hasBackup) {
    return;
  }
  if (hasTarget) {
    await fs.rm(backupPath, { force: true });
    return;
  }
  await fs.rename(backupPath, targetPath);
}

async function writeFileAtomically(targetPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await recoverAtomicWrite(targetPath);

  const backupPath = backupPathFor(targetPath);
  const tempPath = `${targetPath}.tmp-${process.pid}-${crypto.randomBytes(8).toString("hex")}`;
  let movedExistingTarget = false;

  const handle = await fs.open(tempPath, "wx");
  try {
    try {
      await handle.writeFile(content, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }

  try {
    if (await pathExists(targetPath)) {
      await fs.rm(backupPath, { force: true });
      await fs.rename(targetPath, backupPath);
      movedExistingTarget = true;
    }
    await fs.rename(tempPath, targetPath);
    if (movedExistingTarget) {
      await fs.rm(backupPath, { force: true });
    }
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
    if (movedExistingTarget && !(await pathExists(targetPath)) && await pathExists(backupPath)) {
      await fs.rename(backupPath, targetPath).catch(() => undefined);
    }
    throw error;
  }
}

export function atomicWriteText(targetPath: string, content: string): Promise<void> {
  const resolvedPath = path.resolve(targetPath);
  const previous = writeQueues.get(resolvedPath) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(() => writeFileAtomically(resolvedPath, content));
  writeQueues.set(resolvedPath, current);
  return current.finally(() => {
    if (writeQueues.get(resolvedPath) === current) {
      writeQueues.delete(resolvedPath);
    }
  });
}

export function atomicWriteJson(targetPath: string, value: unknown): Promise<void> {
  return atomicWriteText(targetPath, `${JSON.stringify(value, null, 2)}\n`);
}
