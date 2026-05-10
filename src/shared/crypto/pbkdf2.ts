// PBKDF2 密钥派生 — 等价于 Python cryptography.hazmat PBKDF2HMAC(SHA256)
// 参数与 Go/Python 版本完全一致

import crypto from "node:crypto";

/** 迭代次数，与 Go/Python 版本一致 */
export const KDF_ITERATIONS = 480000;

/** 派生密钥长度（字节），与 Go/Python 版本一致 */
export const KDF_KEY_LENGTH = 32;

/** 盐长度（字节） */
export const SALT_LENGTH = 16;

/**
 * 从密码和盐派生加密密钥
 * 等价于 Python:
 *   PBKDF2HMAC(algorithm=SHA256(), length=32, salt=salt, iterations=480000)
 */
export function deriveKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, KDF_ITERATIONS, KDF_KEY_LENGTH, "sha256", (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey);
    });
  });
}

/**
 * 生成随机盐
 */
export function generateSalt(): Buffer {
  return crypto.randomBytes(SALT_LENGTH);
}

/**
 * 将派生密钥编码为 base64url
 * 等价于 Python: base64.urlsafe_b64encode(derived_key)
 */
export function encodeDerivedKey(derived: Buffer): string {
  return derived.toString("base64url");
}
