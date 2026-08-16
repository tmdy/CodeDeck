import os from "node:os";
import path from "node:path";

export function resolveCanonicalCodexHome(homeDirectory = os.homedir()): string {
  return path.join(homeDirectory, ".codex");
}
