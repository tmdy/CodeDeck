// Profile Key 内部实现 — 翻译自 Go internal/domain/profile/keys.go

import {
  KEY_SEPARATOR,
  DEFAULT_PROVIDER,
  normalizeProvider,
  type ProfileKey,
  type ProviderID,
} from "./types.js";

export function buildKey(providerID: string, name: string): ProfileKey {
  const trimmedName = name.trim();
  if (!trimmedName) return "";
  return `${normalizeProvider(providerID)}${KEY_SEPARATOR}${trimmedName}`;
}

export function splitKey(key: ProfileKey): [ProviderID, string] {
  const text = key.trim();
  if (!text) return [DEFAULT_PROVIDER, ""];
  if (!text.includes(KEY_SEPARATOR)) return [DEFAULT_PROVIDER, text];

  const idx = text.indexOf(KEY_SEPARATOR);
  const provider = normalizeProvider(text.slice(0, idx));
  const name = text.slice(idx + KEY_SEPARATOR.length).trim();
  return [provider, name];
}

export function normalizeKeyWithFallback(rawKey: string, fallbackProviderID: string): ProfileKey {
  const trimmed = rawKey.trim();
  if (!trimmed) return "";

  if (trimmed.includes(KEY_SEPARATOR)) {
    const [providerID, name] = splitKey(trimmed);
    return buildKey(providerID, name);
  }

  return buildKey(fallbackProviderID, trimmed);
}

/** 从 Profile 对象生成 Key */
export function itemKey(profile: { provider: string; name: string }): ProfileKey {
  return buildKey(profile.provider, profile.name);
}