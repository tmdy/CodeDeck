import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import {
  type Envelope,
  decryptProfileConfig,
  encryptProfileConfig,
  ConfigLoadError,
  ENVELOPE_VERSION,
} from "./envelope.js";
import {
  emptyEncryptedProfileConfig,
  normalizeEncryptedProfileConfig,
  type EncryptedProfileConfig,
} from "../balance/site-balance-sessions.js";
import { atomicWriteJson, recoverAtomicWrite } from "../atomic-file.js";
import type { EncryptionSetupStatus } from "../encryption-status.js";

export interface EncryptedConfigStoreOptions {
  legacyEncryptedPaths?: string[];
  legacyPlaintextPaths?: string[];
  onLegacyCleanupError?: (legacyPath: string, error: unknown) => void;
}

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

function isNonEmptyBase64Url(value: string): boolean {
  return /^[A-Za-z0-9_-]+={0,2}$/.test(value)
    && Buffer.from(value, "base64url").length > 0;
}

function parseEnvelope(raw: string, sourceLabel: string): Envelope {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ConfigLoadError(`${sourceLabel}不是有效 JSON`);
  }
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || typeof (value as Partial<Envelope>).version !== "number"
    || typeof (value as Partial<Envelope>).salt !== "string"
    || typeof (value as Partial<Envelope>).token !== "string"
  ) {
    throw new ConfigLoadError(`${sourceLabel}不是有效的加密配置`);
  }
  if ((value as Envelope).version !== ENVELOPE_VERSION) {
    throw new ConfigLoadError(`${sourceLabel}版本不受支持`);
  }
  if (
    !isNonEmptyBase64Url((value as Envelope).salt)
    || !isNonEmptyBase64Url((value as Envelope).token)
  ) {
    throw new ConfigLoadError(`${sourceLabel}不是有效的加密配置`);
  }
  return value as Envelope;
}

function parsePlaintextConfig(raw: string): EncryptedProfileConfig {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ConfigLoadError("旧明文 Profile 配置不是有效 JSON");
  }
  if (
    !Array.isArray(value)
    && (!value || typeof value !== "object" || !Array.isArray((value as { profiles?: unknown }).profiles))
  ) {
    throw new ConfigLoadError("旧明文 Profile 配置格式无效");
  }
  return normalizeEncryptedProfileConfig(value);
}

export class EncryptedConfigStore {
  private readonly legacyEncryptedPaths: string[];
  private readonly legacyPlaintextPaths: string[];
  private readonly onLegacyCleanupError?: (legacyPath: string, error: unknown) => void;

  constructor(
    private readonly filePath: string,
    options: EncryptedConfigStoreOptions = {},
  ) {
    this.legacyEncryptedPaths = [...(options.legacyEncryptedPaths ?? [])];
    this.legacyPlaintextPaths = [...(options.legacyPlaintextPaths ?? [])];
    this.onLegacyCleanupError = options.onLegacyCleanupError;
  }

  exists(): boolean {
    return existsSync(this.filePath);
  }

  async getStatus(): Promise<EncryptionSetupStatus> {
    await recoverAtomicWrite(this.filePath);
    if (existsSync(this.filePath)) {
      return { mode: "unlock", source: "canonical" };
    }
    const legacyEncryptedPath = this.legacyEncryptedPaths.find((candidate) => existsSync(candidate));
    if (legacyEncryptedPath) {
      return { mode: "unlock", source: "legacy-encrypted" };
    }
    const legacyPlaintextPath = this.legacyPlaintextPaths.find((candidate) => existsSync(candidate));
    if (legacyPlaintextPath) {
      return { mode: "migrate-plaintext", source: "legacy-plaintext" };
    }
    return { mode: "create", source: "none" };
  }

  async load(passphrase: string): Promise<EncryptedProfileConfig> {
    const status = await this.getStatus();
    if (status.mode === "create") {
      return emptyEncryptedProfileConfig();
    }
    if (status.mode === "migrate-plaintext") {
      return this.loadPlaintextSource();
    }

    const sourcePath = status.source === "canonical"
      ? this.filePath
      : this.legacyEncryptedPaths.find((candidate) => existsSync(candidate));
    if (!sourcePath) {
      throw new ConfigLoadError("加密配置文件不存在");
    }
    const config = await this.readEncryptedFile(sourcePath, passphrase);
    if (status.source === "legacy-encrypted") {
      await this.save(config, passphrase);
      await this.removeLegacyFiles([sourcePath]);
    }
    return config;
  }

  async initialize(
    passphrase: string,
    secrets: Pick<EncryptedProfileConfig, "runtime_env_by_profile" | "global_proxy"> = {},
  ): Promise<EncryptedProfileConfig> {
    const status = await this.getStatus();
    if (status.mode === "unlock") {
      throw new Error("加密配置已存在，请使用解锁流程。");
    }
    const base = status.mode === "migrate-plaintext"
      ? await this.loadPlaintextSource()
      : emptyEncryptedProfileConfig();
    const config = normalizeEncryptedProfileConfig({
      ...base,
      runtime_env_by_profile: secrets.runtime_env_by_profile ?? {},
      global_proxy: secrets.global_proxy ?? "",
      protected_settings_version: 1,
    });
    await this.save(config, passphrase);
    if (status.mode === "migrate-plaintext") {
      await this.removeLegacyFiles(this.legacyPlaintextPaths);
    }
    return config;
  }

  async save(config: EncryptedProfileConfig, passphrase: string): Promise<void> {
    const normalized = normalizeEncryptedProfileConfig(config);
    const envelope = await encryptProfileConfig(normalized, passphrase);
    await atomicWriteJson(this.filePath, envelope);
    await this.readEncryptedFile(this.filePath, passphrase);
  }

  async changePassphrase(currentPassphrase: string, nextPassphrase: string): Promise<void> {
    const config = await this.load(currentPassphrase);
    await this.save(config, nextPassphrase);
  }

  private async readEncryptedFile(sourcePath: string, passphrase: string): Promise<EncryptedProfileConfig> {
    let raw: string;
    try {
      raw = await fs.readFile(sourcePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        throw new ConfigLoadError("加密配置文件不存在");
      }
      throw error;
    }
    return decryptProfileConfig(parseEnvelope(raw, "加密配置文件"), passphrase);
  }

  private async loadPlaintextSource(): Promise<EncryptedProfileConfig> {
    const sourcePath = this.legacyPlaintextPaths.find((candidate) => existsSync(candidate));
    if (!sourcePath) {
      throw new ConfigLoadError("旧明文 Profile 配置不存在");
    }
    return parsePlaintextConfig(await fs.readFile(sourcePath, "utf8"));
  }

  private async removeLegacyFiles(paths: string[]): Promise<void> {
    for (const legacyPath of paths) {
      if (!legacyPath || legacyPath === this.filePath) {
        continue;
      }
      try {
        await fs.rm(legacyPath, { force: true });
      } catch (error) {
        try {
          this.onLegacyCleanupError?.(legacyPath, error);
        } catch {
          // Cleanup reporting must not invalidate an already committed encrypted file.
        }
      }
    }
  }
}
