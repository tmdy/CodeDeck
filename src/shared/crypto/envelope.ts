// 加密配置封包格式 — 等价于 Go Envelope 结构
// 格式: { version: 1, salt: "base64url", token: "fernet_token" }

import type { Profile } from "../profile/types.js";
import { extractSyncedProfile } from "../profile/types.js";
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

/**
 * 加密 profiles 列表
 * 等价于 Go encryptProfiles() + Python encrypt_profiles()
 */
export function encryptProfiles(profiles: Profile[], passphrase: string): Envelope {
  if (!passphrase) {
    throw new ConfigPasswordError("配置口令不能为空");
  }

  const salt = generateSalt();
  const derived = deriveKey(passphrase, salt);
  const { signingKey, encryptionKey } = splitDerivedKey(derived);

  // 只加密可同步字段
  const synced = profiles.map(extractSyncedProfile);
  const payload = Buffer.from(JSON.stringify(synced, null, 2), "utf-8");
  const token = encryptFernet(payload, signingKey, encryptionKey);

  return {
    version: ENVELOPE_VERSION,
    salt: salt.toString("base64url"),
    token,
  };
}

/**
 * 解密 profiles 列表
 * 等价于 Go decryptProfiles() + Python decrypt_profiles()
 */
export function decryptProfiles(envelope: Envelope, passphrase: string): Profile[] {
  if (!passphrase) {
    throw new ConfigPasswordError("配置口令不能为空");
  }

  let salt: Buffer;
  try {
    salt = Buffer.from(envelope.salt, "base64url");
  } catch (err) {
    throw new ConfigLoadError("加密配置文件盐值格式无效");
  }

  const derived = deriveKey(passphrase, salt);
  const { signingKey, encryptionKey } = splitDerivedKey(derived);

  const payload = decryptFernet(envelope.token, signingKey, encryptionKey);
  if (payload === null) {
    throw new ConfigPasswordError("配置口令不正确，或配置文件已损坏");
  }

  let profiles: Profile[];
  try {
    profiles = JSON.parse(payload.toString("utf-8"));
  } catch (err) {
    throw new ConfigLoadError("加密配置文件内容格式无效");
  }

  if (!Array.isArray(profiles)) {
    throw new ConfigLoadError("加密配置文件内容不是有效的 profiles 列表");
  }

  return profiles.map((p) => ({
    provider: p.provider ?? "claude",
    name: p.name?.trim() ?? "",
    url: p.url?.trim() ?? "",
    key: p.key?.trim() ?? "",
  }));
}