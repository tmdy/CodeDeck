// 加密配置存取 — 等价于 Go encryptedconfig.Store + Python load/save_profiles

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  type Envelope,
  decryptProfileConfig,
  encryptProfileConfig,
  ConfigLoadError,
} from "./envelope.js";
import {
  emptyEncryptedProfileConfig,
  normalizeEncryptedProfileConfig,
  type EncryptedProfileConfig,
} from "../balance/site-balance-sessions.js";

export class EncryptedConfigStore {
  private filePath: string;
  private legacyPaths: string[];

  constructor(filePath: string, legacyPaths: string[] = []) {
    this.filePath = filePath;
    this.legacyPaths = [...legacyPaths];
  }

  /** 检查加密配置文件是否存在 */
  exists(): boolean {
    return existsSync(this.filePath);
  }

  /**
   * 加载 profiles
   * 优先读取加密文件，找不到时回退到明文遗留文件
   */
  async load(passphrase: string): Promise<EncryptedProfileConfig> {
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
      return await decryptProfileConfig(envelope, passphrase);
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
        return normalizeEncryptedProfileConfig(JSON.parse(raw));
      } catch {
        // 跳过无法读取的遗留文件
      }
    }

    return emptyEncryptedProfileConfig();
  }

  /**
   * 保存 profiles 到加密文件
   */
  async save(config: EncryptedProfileConfig, passphrase: string): Promise<void> {
    const envelope = await encryptProfileConfig(config, passphrase);

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

  async changePassphrase(currentPassphrase: string, nextPassphrase: string): Promise<void> {
    const config = await this.load(currentPassphrase);
    await this.save(config, nextPassphrase);
  }
}
