import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";

const PROFILE_HEALTH_CODEX_HOME_SEGMENTS = [
  ".codedeck",
  "profile-health",
  "codex-home",
] as const;

export function resolveCanonicalCodexHome(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, ".codex");
}

export function resolveProfileHealthCodexHome(cwd: string): string {
  return path.join(resolveProfileHealthCwd(cwd), ...PROFILE_HEALTH_CODEX_HOME_SEGMENTS);
}

export async function ensureProfileHealthCodexHome(cwd: string): Promise<string> {
  const resolvedCwd = resolveProfileHealthCwd(cwd);
  let cwdStat;
  try {
    cwdStat = await fs.stat(resolvedCwd);
  } catch {
    throw new Error(`Codex 健康检测工作目录不存在：${resolvedCwd}`);
  }
  if (!cwdStat.isDirectory()) {
    throw new Error(`Codex 健康检测工作目录不是目录：${resolvedCwd}`);
  }
  const codexHome = path.join(resolvedCwd, ...PROFILE_HEALTH_CODEX_HOME_SEGMENTS);
  try {
    await fs.mkdir(codexHome, { recursive: true });
  } catch (error) {
    const detail = error instanceof Error && error.message.trim()
      ? `：${error.message.trim()}`
      : "";
    throw new Error(`无法创建 Codex 健康检测专用目录 ${codexHome}${detail}`);
  }
  return codexHome;
}

function resolveProfileHealthCwd(cwd: string): string {
  const normalizedCwd = cwd.trim();
  if (!normalizedCwd) {
    throw new Error("Codex 健康检测需要已保存的工作目录");
  }
  return path.resolve(normalizedCwd);
}
