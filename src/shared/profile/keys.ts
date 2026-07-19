// Profile Key 管理 — 翻译自 Go internal/domain/profile/keys.go
// 格式：provider::name（如 "claude::Official"、"codex::OpenAI"）

export {
  buildKey,
  splitKey,
  normalizeKeyWithFallback,
} from "./keys-internal.js";

// 重新导出以保持与 Go 版本一致的 API 命名
export {
  KEY_SEPARATOR,
  normalizeProvider,
  DEFAULT_PROVIDER,
} from "./types.js";

export type { ProfileKey } from "./types.js";

/**
 * 使用 fallback provider 标准化 key
 * 等价于 Go NormalizeKeyWithFallback
 */
export { normalizeKeyWithFallback as normalizeKey } from "./keys-internal.js";