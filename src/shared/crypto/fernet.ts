// Fernet 加密/解密实现 — 兼容 Python cryptography.fernet.Fernet
// 基于 Fernet 规范: https://github.com/fernet/spec
// 使用 Node.js 原生 crypto 模块，零外部依赖

import crypto from "node:crypto";

const FERNET_VERSION: number = 0x80;
const AES_BLOCK_SIZE: number = 16;
const HMAC_SIZE: number = 32;
const TIMESTAMP_SIZE: number = 8;

// ---- PKCS#7 填充 ----

function pkcs7Pad(data: Buffer, blockSize: number): Buffer {
  const padLen = blockSize - (data.length % blockSize);
  const padding = Buffer.alloc(padLen, padLen);
  return Buffer.concat([data, padding]);
}

function pkcs7Unpad(data: Buffer): Buffer {
  if (data.length === 0) return data;
  const padLen = data[data.length - 1];
  if (padLen === 0 || padLen > AES_BLOCK_SIZE || padLen > data.length) {
    return data; // 无法去除填充，返回原数据
  }
  // 验证所有填充字节
  for (let i = 0; i < padLen; i++) {
    if (data[data.length - 1 - i] !== padLen) return data;
  }
  return data.subarray(0, data.length - padLen);
}

// ---- 密钥派生 ----

/**
 * 从密码和盐派生 Fernet 密钥
 * @returns [signingKey (前16字节), encryptionKey (后16字节)]
 */
export function deriveFernetKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 480000, 32, "sha256");
}

/**
 * 将 32 字节派生密钥拆分为签名密钥和加密密钥
 */
export function splitDerivedKey(derived: Buffer): { signingKey: Buffer; encryptionKey: Buffer } {
  return {
    signingKey: derived.subarray(0, 16),
    encryptionKey: derived.subarray(16, 32),
  };
}

// ---- Fernet 令牌操作 ----

export interface FernetEncryptOptions {
  /** 可选的自定义时间（用于测试） */
  currentTime?: Date;
}

/**
 * 使用 Fernet 加密数据
 * @param payload 要加密的明文
 * @param signingKey 16 字节 HMAC-SHA256 签名密钥
 * @param encryptionKey 16 字节 AES-128-CBC 加密密钥
 * @returns base64url 编码的 Fernet 令牌
 */
export function encryptFernet(
  payload: Buffer,
  signingKey: Buffer,
  encryptionKey: Buffer,
  options: FernetEncryptOptions = {},
): string {
  const now = options.currentTime ?? new Date();
  const timestamp = Buffer.alloc(TIMESTAMP_SIZE);
  timestamp.writeBigUInt64BE(BigInt(Math.floor(now.getTime() / 1000)));

  const iv = crypto.randomBytes(AES_BLOCK_SIZE);
  const padded = pkcs7Pad(payload, AES_BLOCK_SIZE);

  const cipher = crypto.createCipheriv("aes-128-cbc", encryptionKey, iv);
  cipher.setAutoPadding(false);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);

  // HMAC 覆盖: version || timestamp || iv || ciphertext
  const hmacInput = Buffer.concat([
    Buffer.from([FERNET_VERSION]),
    timestamp,
    iv,
    ciphertext,
  ]);
  const hmac = crypto.createHmac("sha256", signingKey).update(hmacInput).digest();

  return Buffer.concat([
    Buffer.from([FERNET_VERSION]),
    timestamp,
    iv,
    ciphertext,
    hmac,
  ]).toString("base64url");
}

export interface FernetDecryptOptions {
  /** TTL 秒数，0 表示不检查过期 */
  ttlSeconds?: number;
}

/**
 * 验证并解密 Fernet 令牌
 * @param token base64url 编码的 Fernet 令牌
 * @returns 解密后的明文，验证失败返回 null
 */
export function decryptFernet(
  token: string,
  signingKey: Buffer,
  encryptionKey: Buffer,
  options: FernetDecryptOptions = {},
): Buffer | null {
  const ttlSeconds = options.ttlSeconds ?? 0;

  let raw: Buffer;
  try {
    raw = Buffer.from(token, "base64url");
  } catch {
    return null;
  }

  if (raw.length < 1 + TIMESTAMP_SIZE + AES_BLOCK_SIZE + HMAC_SIZE) return null;
  if (raw[0] !== FERNET_VERSION) return null;

  const timestamp = raw.subarray(1, 1 + TIMESTAMP_SIZE);
  const iv = raw.subarray(1 + TIMESTAMP_SIZE, 1 + TIMESTAMP_SIZE + AES_BLOCK_SIZE);
  const hmacEnd = raw.length - HMAC_SIZE;
  const ciphertext = raw.subarray(1 + TIMESTAMP_SIZE + AES_BLOCK_SIZE, hmacEnd);
  const expectedHmac = raw.subarray(hmacEnd);

  // 验证 HMAC
  const hmacInput = raw.subarray(0, hmacEnd);
  const computedHmac = crypto.createHmac("sha256", signingKey).update(hmacInput).digest();

  if (!crypto.timingSafeEqual(expectedHmac, computedHmac)) return null;

  // 检查 TTL
  if (ttlSeconds > 0) {
    const tokenTime = Number(timestamp.readBigUInt64BE());
    const now = Math.floor(Date.now() / 1000);
    if (now - tokenTime > ttlSeconds) return null;
  }

  const decipher = crypto.createDecipheriv("aes-128-cbc", encryptionKey, iv);
  decipher.setAutoPadding(false);
  let padded: Buffer;
  try {
    padded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    return null;
  }

  return pkcs7Unpad(padded);
}