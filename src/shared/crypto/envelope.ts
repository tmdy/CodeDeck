import type { Profile } from "../profile/types.js";
import { extractSyncedProfile } from "../profile/types.js";
import {
  emptyEncryptedProfileConfig,
  normalizeEncryptedProfileConfig,
  cloneSiteBalanceSessionsByBaseUrl,
  type EncryptedProfileConfig,
} from "../balance/site-balance-sessions.js";
import { deriveKey, generateSalt } from "./pbkdf2.js";
import { encryptFernet, decryptFernet, splitDerivedKey } from "./fernet.js";

export const ENVELOPE_VERSION = 1;

export interface Envelope {
  version: number;
  salt: string;  // base64url 编码的盐
  token: string; // Fernet 令牌
}

/** 错误类型 */
export class ConfigPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigPasswordError";
  }
}

export class ConfigLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigLoadError";
  }
}

export async function encryptProfiles(profiles: Profile[], passphrase: string): Promise<Envelope> {
  return encryptPayload(profiles.map(extractSyncedProfile), passphrase);
}

export async function encryptProfileConfig(
  config: EncryptedProfileConfig,
  passphrase: string,
): Promise<Envelope> {
  const normalized = normalizeEncryptedProfileConfig(config);
  return encryptPayload({
    profiles: normalized.profiles.map(extractSyncedProfile),
    site_balance_sessions_by_base_url: cloneSiteBalanceSessionsByBaseUrl(
      normalized.site_balance_sessions_by_base_url,
    ),
  }, passphrase);
}

export async function decryptProfiles(envelope: Envelope, passphrase: string): Promise<Profile[]> {
  return (await decryptProfileConfig(envelope, passphrase)).profiles;
}

export async function decryptProfileConfig(
  envelope: Envelope,
  passphrase: string,
): Promise<EncryptedProfileConfig> {
  const payload = await decryptPayload(envelope, passphrase);
  let value: unknown;
  try {
    value = JSON.parse(payload.toString("utf-8"));
  } catch {
    throw new ConfigLoadError("加密配置文件内容格式无效");
  }

  const normalized = normalizeEncryptedProfileConfig(value);
  if (
    !Array.isArray(value)
    && (!value || typeof value !== "object" || !("profiles" in value))
  ) {
    throw new ConfigLoadError("加密配置文件内容不是有效的 profiles 配置");
  }

  return normalized ?? emptyEncryptedProfileConfig();
}

async function encryptPayload(value: unknown, passphrase: string): Promise<Envelope> {
  if (!passphrase) {
    throw new ConfigPasswordError("配置口令不能为空");
  }

  const salt = generateSalt();
  const derived = await deriveKey(passphrase, salt);
  const { signingKey, encryptionKey } = splitDerivedKey(derived);
  const payload = Buffer.from(JSON.stringify(value, null, 2), "utf-8");
  const token = encryptFernet(payload, signingKey, encryptionKey);

  return {
    version: ENVELOPE_VERSION,
    salt: salt.toString("base64url"),
    token,
  };
}

async function decryptPayload(envelope: Envelope, passphrase: string): Promise<Buffer> {
  if (!passphrase) {
    throw new ConfigPasswordError("配置口令不能为空");
  }

  let salt: Buffer;
  try {
    salt = Buffer.from(envelope.salt, "base64url");
  } catch {
    throw new ConfigLoadError("加密配置文件盐值格式无效");
  }

  const derived = await deriveKey(passphrase, salt);
  const { signingKey, encryptionKey } = splitDerivedKey(derived);
  const payload = decryptFernet(envelope.token, signingKey, encryptionKey);
  if (payload === null) {
    throw new ConfigPasswordError("配置口令不正确，或配置文件已损坏");
  }
  return payload;
}
