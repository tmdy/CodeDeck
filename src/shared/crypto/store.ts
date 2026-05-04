// 加密配置存取 — 等价于 Go encryptedconfig.Store + Python load/save_profiles

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Profile } from "../profile/types.js";
import { normalizeProfile } from "../profile/types.js";
import {
  type Envelope,
  encryptProfiles,
  decryptProfiles,
  ConfigLoadError,
} from "./envelope.js";

export class EncryptedConfigStore {
  private filePath: string;
  private legacyPaths: string[];

  constructor(filePath: string, legacyPaths: string[] = []) {
    this.filePath = filePath;
    this.legacyPaths = [...legacyPaths];
  }

  /** 检查加密配置文件是否存在 */
  exists(): boolean {
    try {
      return require("node:fs").existsSync(this.filePath);
    } catch {
      return false;
    }
  }

  /**
   * 加载 profiles
   * 优先读取加密文件，找不到时回退到明文遗留文件
   */
  async load(passphrase: string): Promise<Profile[]> {
    // 尝试读取加密配置
    try {
      await fs.access(this.filePath);
      const raw = await fs.readFile(this.filePath, "utf-8");
      let envelope: Envelope;
      try {
        envelope = JSON.parse(raw);
      } catch {
        throw new ConfigLoadError("加密配置文件不是有效 JSON");
      }
      return decryptProfiles(envelope, passphrase).map(normalizeProfile);
    } catch (err) {
      if (err instanceof ConfigLoadError) throw err;
      if (err instanceof Error && err.message.includes("配置口令")) throw err;
    }

    // 回退到明文遗留文件
    for (const legacyPath of this.legacyPaths) {
      if (!legacyPath) continue;
      try {
        await fs.access(legacyPath);
        const raw = await fs.readFile(legacyPath, "utf-8");
        const profiles: Profile[] = JSON.parse(raw);
        if (Array.isArray(profiles)) {
          return profiles.map(normalizeProfile);
        }
      } catch {
        // 跳过无法读取的遗留文件
      }
    }

    return [];
  }

  /**
   * 保存 profiles 到加密文件
   */
  async save(profiles: Profile[], passphrase: string): Promise<void> {
    const envelope = encryptProfiles(profiles, passphrase);

    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(
      this.filePath,
      JSON.stringify(envelope, null, 2),
      "utf-8",
    );

    // 清理遗留明文文件
    for (const legacyPath of this.legacyPaths) {
      if (!legacyPath) continue;
      try {
        await fs.unlink(legacyPath);
      } catch {
        // 忽略删除失败
      }
    }
  }
}