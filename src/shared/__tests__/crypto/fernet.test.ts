// Fernet 加密测试

import { describe, it, expect } from "vitest";
import { encryptFernet, decryptFernet, splitDerivedKey, deriveFernetKey } from "../../crypto/fernet.js";
import { deriveKey, generateSalt, resolveKdfIterations } from "../../crypto/pbkdf2.js";

describe("deriveFernetKey", () => {
  it("should derive 32-byte key", () => {
    const salt = Buffer.from("abcdefghijklmnop", "ascii");
    const derived = deriveFernetKey("test-password", salt);
    expect(derived.length).toBe(32);
  });

  it("should produce deterministic results", () => {
    const salt = Buffer.from("abcdefghijklmnop", "ascii");
    const d1 = deriveFernetKey("test-password", salt);
    const d2 = deriveFernetKey("test-password", salt);
    expect(d1.equals(d2)).toBe(true);
  });

  it("should produce different results for different passwords", () => {
    const salt = Buffer.from("abcdefghijklmnop", "ascii");
    const d1 = deriveFernetKey("password1", salt);
    const d2 = deriveFernetKey("password2", salt);
    expect(d1.equals(d2)).toBe(false);
  });
});

describe("encryptFernet / decryptFernet", () => {
  function makeKeys(password: string, saltStr: string) {
    const salt = Buffer.from(saltStr, "ascii");
    const derived = deriveFernetKey(password, salt);
    return splitDerivedKey(derived);
  }

  it("should encrypt and decrypt successfully", () => {
    const payload = Buffer.from(JSON.stringify({ hello: "world" }), "utf-8");
    const { signingKey, encryptionKey } = makeKeys("password", "abcdefghijklmnop");

    const token = encryptFernet(payload, signingKey, encryptionKey);
    expect(typeof token).toBe("string");
    expect(token.length).toBeGreaterThan(0);

    const decrypted = decryptFernet(token, signingKey, encryptionKey);
    expect(decrypted).not.toBeNull();
    expect(JSON.parse(decrypted!.toString("utf-8"))).toEqual({ hello: "world" });
  });

  it("should fail with wrong key", () => {
    const payload = Buffer.from("test data");
    const { signingKey, encryptionKey } = makeKeys("password", "abcdefghijklmnop");
    const { signingKey: wrongKey } = makeKeys("wrong-password", "abcdefghijklmnop");

    const token = encryptFernet(payload, signingKey, encryptionKey);
    const decrypted = decryptFernet(token, wrongKey, encryptionKey);
    expect(decrypted).toBeNull();
  });

  it("should fail with tampered token", () => {
    const payload = Buffer.from("test data");
    const { signingKey, encryptionKey } = makeKeys("password", "abcdefghijklmnop");

    const token = encryptFernet(payload, signingKey, encryptionKey);
    const tampered = token.slice(0, -4) + "XXXX";
    const decrypted = decryptFernet(tampered, signingKey, encryptionKey);
    expect(decrypted).toBeNull();
  });

  it("should handle unicode payload", () => {
    const payload = Buffer.from(JSON.stringify({ 名称: "测试" }), "utf-8");
    const { signingKey, encryptionKey } = makeKeys("密码", "1234567890abcdef");

    const token = encryptFernet(payload, signingKey, encryptionKey);
    const decrypted = decryptFernet(token, signingKey, encryptionKey);
    expect(decrypted).not.toBeNull();
    expect(JSON.parse(decrypted!.toString("utf-8"))).toEqual({ 名称: "测试" });
  });

  it("should encrypt deterministically with same time", () => {
    const payload = Buffer.from("test");
    const { signingKey, encryptionKey } = makeKeys("pw", "abcdefghijklmnop");
    const fakeTime = new Date("2026-01-01T00:00:00Z");

    const t1 = encryptFernet(payload, signingKey, encryptionKey, { currentTime: fakeTime });
    const t2 = encryptFernet(payload, signingKey, encryptionKey, { currentTime: fakeTime });
    // IV 随机，所以不同调用产生不同令牌
    expect(t1).not.toBe(t2);
    // 但两者都应该能正确解密
    expect(decryptFernet(t1, signingKey, encryptionKey)!.toString()).toBe("test");
    expect(decryptFernet(t2, signingKey, encryptionKey)!.toString()).toBe("test");
  });
});

describe("PBKDF2 key derivation", () => {
  it("should keep the production default when no override is configured", () => {
    expect(resolveKdfIterations(undefined)).toBe(480000);
    expect(resolveKdfIterations("")).toBe(480000);
  });

  it("should accept a positive integer iteration override", () => {
    expect(resolveKdfIterations("120000")).toBe(120000);
  });

  it("should reject unsafe or malformed iteration overrides", () => {
    expect(resolveKdfIterations("0")).toBe(480000);
    expect(resolveKdfIterations("-1")).toBe(480000);
    expect(resolveKdfIterations("abc")).toBe(480000);
    expect(resolveKdfIterations("120000.5")).toBe(480000);
  });

  it("should generate 16-byte salt", () => {
    const salt = generateSalt();
    expect(salt.length).toBe(16);
  });

  it("should derive the key asynchronously", async () => {
    const salt = generateSalt();
    const keyPromise = deriveKey("password", salt);
    expect(keyPromise).toBeInstanceOf(Promise);
    const key = await keyPromise;
    expect(key.length).toBe(32);
  });
});
