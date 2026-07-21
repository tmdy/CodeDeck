import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { atomicWriteJson, recoverAtomicWrite } from "../atomic-file.js";
import { ConfigLoadError } from "./envelope.js";

const AUTO_UNLOCK_KEY_VERSION = 1;

interface AutoUnlockKeyEnvelope {
  version: number;
  protected_key: string;
}

export interface SecretProtector {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}

function parseKeyEnvelope(raw: string): AutoUnlockKeyEnvelope {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ConfigLoadError("免口令密钥文件不是有效 JSON");
  }
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || (value as Partial<AutoUnlockKeyEnvelope>).version !== AUTO_UNLOCK_KEY_VERSION
    || typeof (value as Partial<AutoUnlockKeyEnvelope>).protected_key !== "string"
    || !(value as AutoUnlockKeyEnvelope).protected_key
  ) {
    throw new ConfigLoadError("免口令密钥文件格式无效");
  }
  return value as AutoUnlockKeyEnvelope;
}

export class AutoUnlockKeyStore {
  constructor(
    private readonly filePath: string,
    private readonly protector: SecretProtector,
  ) {}

  async exists(): Promise<boolean> {
    await recoverAtomicWrite(this.filePath);
    return existsSync(this.filePath);
  }

  async createOrLoad(): Promise<string> {
    const existing = await this.load();
    if (existing) {
      return existing;
    }
    this.assertEncryptionAvailable();
    const passphrase = randomBytes(32).toString("base64url");
    const protectedKey = this.protector.encryptString(passphrase).toString("base64");
    await atomicWriteJson(this.filePath, {
      version: AUTO_UNLOCK_KEY_VERSION,
      protected_key: protectedKey,
    });
    const verified = await this.loadRequired();
    if (verified !== passphrase) {
      throw new ConfigLoadError("免口令密钥写入校验失败");
    }
    return passphrase;
  }

  async load(): Promise<string | null> {
    await recoverAtomicWrite(this.filePath);
    if (!existsSync(this.filePath)) {
      return null;
    }
    this.assertEncryptionAvailable();
    const envelope = parseKeyEnvelope(await fs.readFile(this.filePath, "utf8"));
    let passphrase: string;
    try {
      passphrase = this.protector.decryptString(Buffer.from(envelope.protected_key, "base64"));
    } catch {
      throw new ConfigLoadError("免口令密钥无法由当前系统账户解密");
    }
    if (!passphrase) {
      throw new ConfigLoadError("免口令密钥内容为空");
    }
    return passphrase;
  }

  async loadRequired(): Promise<string> {
    const passphrase = await this.load();
    if (!passphrase) {
      throw new ConfigLoadError("免口令密钥不存在");
    }
    return passphrase;
  }

  async remove(): Promise<void> {
    await recoverAtomicWrite(this.filePath);
    await fs.rm(this.filePath, { force: true });
  }

  private assertEncryptionAvailable(): void {
    if (!this.protector.isEncryptionAvailable()) {
      throw new ConfigLoadError("当前系统无法安全保存免口令密钥");
    }
  }
}
