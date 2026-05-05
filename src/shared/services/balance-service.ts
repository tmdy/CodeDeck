import type { Profile } from "../profile/types.js";
import type { BalanceCheckItem, BalanceCheckState } from "../balance/types.js";
import {
  normalizeBalanceBaseUrl,
  type SiteBalanceSession,
} from "../balance/site-balance-sessions.js";

export { normalizeBalanceBaseUrl } from "../balance/site-balance-sessions.js";

type PlatformFamily =
  | "new_api_family"
  | "one_api"
  | "one_hub_family"
  | "veloera"
  | "sub2api"
  | "official_unsupported"
  | "unknown";

type ManagementFamily = Extract<
  PlatformFamily,
  "new_api_family" | "one_api" | "one_hub_family" | "veloera"
>;

type ManagementAuthMode = "bearer" | "session_cookie";
type QuotaMode = "remaining" | "total";

interface BalanceContext {
  provider: string;
  profile_name: string;
  base_url: string;
}

interface RequestResult {
  ok: boolean;
  status: number;
  payload: unknown;
  bodyText: string;
  error: string;
}

interface RequestJsonOptions {
  includeAuthorization?: boolean;
}

interface ManagementInspectionResult {
  family: ManagementFamily | null;
  state: BalanceCheckState | null;
  shouldRetryWithUserId: boolean;
}

const OFFICIAL_UNSUPPORTED_PATTERNS = [
  "openai.com",
  "anthropic.com",
  "googleapis.com",
  "generativelanguage.googleapis.com",
  "gemini",
  "moonshot.cn",
  "kimi",
  "bigmodel.cn",
  "glm",
];

const NEED_USER_ID_MESSAGE = "该站点需要用户 ID（平台用户 ID），当前未能自动解析";
const AUTH_FAILURE_MESSAGE = "余额接口鉴权失败，请检查 API Key";
const ACCESS_TOKEN_REQUIRED_MESSAGE = "该站点余额接口需要后台 Access Token 或已登录 Session（通常还需要 User ID），sk- API Key 无法直接查询";
const SESSION_EXPIRED_MESSAGE = "当前会话可能已过期，请重新获取后台 Session";
const CHALLENGE_MESSAGE = "该站点返回了登录挑战页面，请重新获取后台 Session";
const NOT_SUPPORTED_MESSAGE = "该站点暂未适配余额接口";

const RECURSIVE_KEYS = [
  "data",
  "item",
  "result",
  "payload",
  "user",
  "account",
  "summary",
  "subscriptionSummary",
  "subscription_summary",
];

const NEW_API_USER_HEADER_NAMES = [
  "New-API-User",
  "Veloera-User",
  "voapi-user",
  "User-id",
  "Rix-Api-User",
  "neo-api-user",
];

const EXPLICIT_REMAINING_KEYS = [
  "remain_quota",
  "remainQuota",
  "remaining_quota",
  "remainingQuota",
  "quotaRemaining",
];

const QUOTA_KEYS = ["quota"];

const USED_KEYS = [
  "used_quota",
  "usedQuota",
  "used",
  "quota_used",
  "quotaUsed",
];

const TOTAL_KEYS = [
  "total_quota",
  "totalQuota",
  "quota_total",
  "quotaTotal",
];

const BALANCE_KEYS = [
  "balance",
  "remaining_balance",
  "remainingBalance",
];

const UNLIMITED_KEYS = [
  "unlimited_quota",
  "unlimitedQuota",
  "is_unlimited",
  "isUnlimited",
];

function buildContext(profile: Pick<Profile, "provider" | "name" | "url">): BalanceContext {
  return {
    provider: profile.provider,
    profile_name: profile.name,
    base_url: normalizeBalanceBaseUrl(profile.url),
  };
}

function baseState(context: BalanceContext): BalanceCheckState {
  return {
    provider: context.provider,
    profile_name: context.profile_name,
    base_url: context.base_url,
    running: false,
    supported: false,
    success: false,
    message: "",
    items: [],
    endpoint: "",
    finished_at_display: "",
  };
}

function successState(
  context: BalanceContext,
  endpoint: string,
  items: BalanceCheckItem[],
  message: string = "余额已更新",
): BalanceCheckState {
  return {
    ...baseState(context),
    supported: true,
    success: true,
    message,
    items,
    endpoint,
  };
}

function supportedFailureState(
  context: BalanceContext,
  endpoint: string,
  message: string,
): BalanceCheckState {
  return {
    ...baseState(context),
    supported: true,
    success: false,
    message,
    endpoint,
  };
}

function unsupportedState(context: BalanceContext, message: string): BalanceCheckState {
  return {
    ...baseState(context),
    supported: false,
    success: false,
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeHost(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return value.toLowerCase();
  }
}

function normalizeUrlForMatching(value: string): string {
  return `${normalizeHost(value)} ${value}`.toLowerCase();
}

function normalizeUserIdValue(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return String(Math.trunc(value));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
}

function normalizeNeedUserIdMessage(body: string): string {
  if (
    /new-api-user|veloera-user|voapi-user|neo-api-user|rix-api-user|user[-_\s]*id|platform user id|missing user/i.test(
      body,
    )
  ) {
    return NEED_USER_ID_MESSAGE;
  }
  return body;
}

function shouldRetryWithManagementUserId(message: string): boolean {
  return normalizeNeedUserIdMessage(message) === NEED_USER_ID_MESSAGE;
}

function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function coerceBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value !== 0;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }
    if (["true", "1", "yes", "y", "on", "unlimited", "infinite", "无限"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no", "n", "off", "limited", "finite", "有限"].includes(normalized)) {
      return false;
    }
  }
  return null;
}

function collectObjectCandidates(
  payload: unknown,
  recursiveKeys: readonly string[] = RECURSIVE_KEYS,
): Record<string, unknown>[] {
  const queue: unknown[] = [payload];
  const seen = new Set<object>();
  const results: Record<string, unknown>[] = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!isRecord(current) || seen.has(current)) {
      continue;
    }
    seen.add(current);
    results.push(current);

    for (const key of recursiveKeys) {
      const nested = current[key];
      if (isRecord(nested)) {
        queue.push(nested);
      }
    }
  }

  return results;
}

function extractResponseMessage(payload: unknown): string {
  for (const candidate of collectObjectCandidates(payload)) {
    for (const key of ["message", "msg", "detail", "reason"] as const) {
      if (typeof candidate[key] === "string" && candidate[key].trim()) {
        return candidate[key].trim();
      }
    }

    const error = candidate.error;
    if (typeof error === "string" && error.trim()) {
      return error.trim();
    }
    if (isRecord(error) && typeof error.message === "string" && error.message.trim()) {
      return error.message.trim();
    }
  }

  return "";
}

function payloadSignalsFailure(payload: unknown): boolean {
  return isRecord(payload) && payload.success === false;
}

function readRecordNumber(
  record: Record<string, unknown>,
  keys: readonly string[],
): number | null {
  for (const key of keys) {
    if (!(key in record)) {
      continue;
    }
    const value = coerceNumber(record[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function readRecordBoolean(
  record: Record<string, unknown>,
  keys: readonly string[],
): boolean | null {
  for (const key of keys) {
    if (!(key in record)) {
      continue;
    }
    const value = coerceBoolean(record[key]);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function looksLikeExpiredSessionMessage(message: string): boolean {
  return /not logged in|未登录|access token expired|token expired|session expired|登录过期|会话过期|未提供 access token|forbidden|expired session/i
    .test(message);
}

function looksLikeAuthFailureMessage(message: string): boolean {
  return /unauthorized|forbidden|invalid token|invalid credentials|invalid api key|access token|未登录|鉴权|无权|令牌|密钥|token/i
    .test(message);
}

function looksLikeHtmlDocument(bodyText: string): boolean {
  return /<!doctype html|<html|<body|<\/html>/i.test(bodyText);
}

function looksLikeChallengeHtml(bodyText: string): boolean {
  return looksLikeHtmlDocument(bodyText)
    && /challenge|captcha|cloudflare|just a moment|cf-browser-verification|acw_sc__v2|cdn_sec_tc/i
      .test(bodyText);
}

function explainSkApiKeyMismatch(apiKey: string, message: string): string {
  if (apiKey.trim().startsWith("sk-") && /invalid access token/i.test(message)) {
    return ACCESS_TOKEN_REQUIRED_MESSAGE;
  }
  return "";
}

function formatManagementFailureMessage(
  message: string,
  apiKey: string,
  authMode: ManagementAuthMode,
  preferSessionMessage: boolean,
): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return "";
  }

  const normalizedUserId = normalizeNeedUserIdMessage(trimmed);
  if (normalizedUserId !== trimmed) {
    return normalizedUserId;
  }

  const specificMessage = explainSkApiKeyMismatch(apiKey, trimmed);
  if (specificMessage) {
    return specificMessage;
  }

  if (looksLikeChallengeHtml(trimmed)) {
    return CHALLENGE_MESSAGE;
  }

  if (looksLikeExpiredSessionMessage(trimmed) && (preferSessionMessage || authMode === "session_cookie")) {
    return SESSION_EXPIRED_MESSAGE;
  }

  if (looksLikeAuthFailureMessage(trimmed)) {
    return AUTH_FAILURE_MESSAGE;
  }

  return trimmed;
}

function buildNewApiUserHeadersFromValue(
  userId: string | number | null | undefined,
): Record<string, string> {
  const value = normalizeUserIdValue(userId);
  if (!value) {
    return {};
  }

  const headers: Record<string, string> = {};
  for (const headerName of NEW_API_USER_HEADER_NAMES) {
    headers[headerName] = value;
  }
  return headers;
}

function extractJwtUserId(token: string): number | null {
  const parts = token.trim().split(".");
  if (parts.length !== 3) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8")) as {
      id?: unknown;
      sub?: unknown;
    };
    const id = coerceNumber(payload.id ?? payload.sub);
    if (id === null || !Number.isInteger(id) || id <= 0) {
      return null;
    }
    return id;
  } catch {
    return null;
  }
}

function buildCookieCandidates(token: string): string[] {
  const trimmed = token.trim();
  if (!trimmed) {
    return [];
  }

  const raw = trimmed.startsWith("Bearer ") ? trimmed.slice(7).trim() : trimmed;
  const candidates: string[] = [];
  if (/^session=/i.test(raw) || raw.includes(";")) {
    candidates.push(raw);
  }
  candidates.push(`session=${raw}`);
  if (raw.includes("=") && !/^session=/i.test(raw)) {
    candidates.push(raw);
  }
  return Array.from(new Set(candidates.filter(Boolean)));
}

function decodeBase64BufferLoose(value: string): Buffer | null {
  if (!value) {
    return null;
  }
  try {
    return Buffer.from(value, "base64");
  } catch {
    // Fall through to url-safe normalization.
  }
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    return Buffer.from(normalized, "base64");
  } catch {
    return null;
  }
}

function decodeGobSignedInt(encoded: Buffer): number | null {
  if (!encoded.length) {
    return null;
  }

  let unsigned = 0n;
  if (encoded[0] < 0x80) {
    unsigned = BigInt(encoded[0]);
  } else {
    const width = 0x100 - encoded[0];
    if (width <= 0 || encoded.length !== width + 1) {
      return null;
    }
    for (let index = 1; index < encoded.length; index += 1) {
      unsigned = (unsigned << 8n) | BigInt(encoded[index]);
    }
  }

  const signed = (unsigned & 1n) === 0n
    ? unsigned >> 1n
    : -((unsigned >> 1n) + 1n);
  if (signed <= 0n || signed > BigInt(Number.MAX_SAFE_INTEGER)) {
    return null;
  }
  return Number(signed);
}

function extractGobFieldInts(payload: Buffer, fieldName: string): number[] {
  const ids: number[] = [];
  const push = (value: number | null) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return;
    }
    if (value <= 0 || value > 10_000_000 || ids.includes(value)) {
      return;
    }
    ids.push(value);
  };

  const marker = Buffer.concat([
    Buffer.from(fieldName, "utf8"),
    Buffer.from([0x03]),
    Buffer.from("int", "utf8"),
    Buffer.from([0x04]),
  ]);

  let start = 0;
  while (start < payload.length) {
    const position = payload.indexOf(marker, start);
    if (position < 0) {
      break;
    }

    const encodedLength = payload[position + marker.length];
    const delimiter = payload[position + marker.length + 1];
    if (typeof encodedLength === "number" && delimiter === 0x00) {
      const byteLength = encodedLength - 1;
      const valueStart = position + marker.length + 2;
      const valueEnd = valueStart + byteLength;
      if (byteLength > 0 && valueEnd <= payload.length) {
        push(decodeGobSignedInt(payload.subarray(valueStart, valueEnd)));
      }
    }

    start = position + marker.length;
  }

  return ids;
}

function extractLikelyUserIds(token: string): number[] {
  const ids: number[] = [];
  const push = (value: unknown) => {
    const numberValue = Number.parseInt(String(value), 10);
    if (Number.isNaN(numberValue) || numberValue <= 0 || numberValue > 10_000_000) {
      return;
    }
    if (!ids.includes(numberValue)) {
      ids.push(numberValue);
    }
  };

  const raw = token.trim();
  if (!raw) {
    return ids;
  }

  const sessionValues = new Set<string>();
  for (const candidate of buildCookieCandidates(raw)) {
    const match = candidate.match(/(?:^|;\s*)session=([^;]+)/i);
    if (match?.[1]) {
      sessionValues.add(match[1].trim());
    }
  }
  if (raw && !raw.includes("=")) {
    sessionValues.add(raw.startsWith("Bearer ") ? raw.slice(7).trim() : raw);
  }

  for (const sessionValue of sessionValues) {
    const decodedBuffer = decodeBase64BufferLoose(sessionValue);
    if (!decodedBuffer) {
      continue;
    }

    const decoded = decodedBuffer.toString("utf8");
    const payloadCandidates: string[] = [decoded];
    const payloadBuffers: Buffer[] = [decodedBuffer];

    const parts = decoded.split("|");
    if (parts.length >= 2) {
      const innerBuffer = decodeBase64BufferLoose(parts[1]);
      if (innerBuffer) {
        payloadCandidates.push(innerBuffer.toString("utf8"));
        payloadBuffers.push(innerBuffer);
      }
    }

    for (const payload of payloadCandidates) {
      for (const match of payload.matchAll(/_(\d{4,8})(?!\d)/g)) {
        push(match[1]);
      }
      for (const match of payload.matchAll(/(?:user(?:name)?|uid|id)[^\d]{0,16}(\d{4,8})(?!\d)/gi)) {
        push(match[1]);
      }
    }

    for (const payload of payloadBuffers) {
      for (const value of extractGobFieldInts(payload, "id")) {
        push(value);
      }
    }
  }

  return ids;
}

function buildUserIdProbeCandidates(token: string, initialUserId?: string | null): string[] {
  const candidates: string[] = [];
  const push = (value: string | number | null | undefined) => {
    const normalized = normalizeUserIdValue(value);
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized);
    }
  };

  push(initialUserId ?? null);
  push(extractJwtUserId(token));
  for (const guessedUserId of extractLikelyUserIds(token)) {
    push(guessedUserId);
  }

  return candidates;
}

function isDeepSeekBaseUrl(baseUrl: string): boolean {
  return normalizeHost(baseUrl).includes("deepseek.com");
}

function isDoneHubBaseUrl(baseUrl: string): boolean {
  return /done[-\s]?hub/i.test(normalizeUrlForMatching(baseUrl));
}

function detectManagementFamilyByUrl(baseUrl: string): ManagementFamily | null {
  const haystack = normalizeUrlForMatching(baseUrl);
  if (haystack.includes("veloera")) {
    return "veloera";
  }
  if (/done[-\s]?hub|one[-\s]?hub/i.test(haystack)) {
    return "one_hub_family";
  }
  if (/one[-\s]?api/i.test(haystack)) {
    return "one_api";
  }
  if (/new[-\s]?api|anyrouter|voapi|neo[-\s]?api|rix[-\s]?api/i.test(haystack)) {
    return "new_api_family";
  }
  return null;
}

function detectManagementFamilyByText(bodyText: string): ManagementFamily | null {
  const haystack = bodyText.toLowerCase();
  if (haystack.includes("veloera")) {
    return "veloera";
  }
  if (/done[-\s]?hub|one[-\s]?hub/i.test(haystack)) {
    return "one_hub_family";
  }
  if (/one[-\s]?api/i.test(haystack)) {
    return "one_api";
  }
  if (
    /new[-\s]?api|anyrouter|voapi|neo[-\s]?api|rix[-\s]?api|new-api-user|veloera-user|user-id/i
      .test(haystack)
  ) {
    return "new_api_family";
  }
  return null;
}

function detectPlatformFamily(baseUrl: string): PlatformFamily {
  if (isDeepSeekBaseUrl(baseUrl)) {
    return "unknown";
  }

  const haystack = normalizeUrlForMatching(baseUrl);
  if (haystack.includes("sub2api")) {
    return "sub2api";
  }
  if (haystack.includes("veloera")) {
    return "veloera";
  }
  if (/done[-\s]?hub|one[-\s]?hub/i.test(haystack)) {
    return "one_hub_family";
  }
  if (/one[-\s]?api/i.test(haystack)) {
    return "one_api";
  }
  if (/new[-\s]?api|anyrouter|voapi|neo[-\s]?api|rix[-\s]?api/i.test(haystack)) {
    return "new_api_family";
  }
  if (OFFICIAL_UNSUPPORTED_PATTERNS.some((pattern) => normalizeHost(baseUrl).includes(pattern))) {
    return "official_unsupported";
  }
  return "unknown";
}

function recordHasAnyKey(record: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => key in record);
}

function managementPayloadHasBalanceKeys(payload: unknown): boolean {
  for (const candidate of collectObjectCandidates(payload)) {
    if (
      recordHasAnyKey(candidate, EXPLICIT_REMAINING_KEYS)
      || recordHasAnyKey(candidate, QUOTA_KEYS)
      || recordHasAnyKey(candidate, USED_KEYS)
      || recordHasAnyKey(candidate, TOTAL_KEYS)
      || recordHasAnyKey(candidate, BALANCE_KEYS)
      || recordHasAnyKey(candidate, UNLIMITED_KEYS)
    ) {
      return true;
    }
  }
  return false;
}

function sub2ApiPayloadLooksSupported(payload: unknown): boolean {
  for (const candidate of collectObjectCandidates(payload)) {
    if (
      recordHasAnyKey(candidate, BALANCE_KEYS)
      || "monthly_limit_usd" in candidate
      || "monthly_used_usd" in candidate
      || Array.isArray(candidate.subscriptions)
      || (typeof candidate.code === "number" && ("data" in candidate || "message" in candidate))
    ) {
      return true;
    }
  }
  return false;
}

function resolveManagementFamily(
  payload: unknown,
  bodyText: string,
  familyHint: ManagementFamily | null,
  authMode: ManagementAuthMode,
  preferNewApi: boolean,
): ManagementFamily | null {
  if (familyHint) {
    return familyHint;
  }

  const combinedText = `${extractResponseMessage(payload)} ${bodyText}`.trim();
  const textFamily = detectManagementFamilyByText(combinedText);
  if (textFamily) {
    return textFamily;
  }

  if (managementPayloadHasBalanceKeys(payload)) {
    if (authMode === "session_cookie" || preferNewApi) {
      return "new_api_family";
    }
    return "one_hub_family";
  }

  return null;
}

function resolveQuotaConfig(
  family: ManagementFamily,
  baseUrl: string,
  evidenceText: string,
): { factor: number; mode: QuotaMode } {
  if (family === "veloera") {
    return { factor: 1_000_000, mode: "remaining" };
  }
  if (family === "new_api_family") {
    return { factor: 500_000, mode: "remaining" };
  }
  if (family === "one_api") {
    return { factor: 500_000, mode: "total" };
  }
  if (
    isDoneHubBaseUrl(baseUrl)
    || /done[-\s]?hub/i.test(evidenceText)
  ) {
    return { factor: 500_000, mode: "remaining" };
  }
  return { factor: 500_000, mode: "total" };
}

function buildUsdItem(
  remaining: number | null,
  total: number | null,
  used: number | null,
  label: string = "USD",
): BalanceCheckItem {
  return {
    label,
    remaining,
    total,
    used,
    unit: "$",
  };
}

function parseManagementBalanceState(
  context: BalanceContext,
  endpoint: string,
  payload: unknown,
  family: ManagementFamily,
  evidenceText: string,
): BalanceCheckState {
  const { factor, mode } = resolveQuotaConfig(family, context.base_url, evidenceText);

  for (const candidate of collectObjectCandidates(payload)) {
    const remainingQuota = readRecordNumber(candidate, EXPLICIT_REMAINING_KEYS);
    const quota = readRecordNumber(candidate, QUOTA_KEYS);
    const usedQuota = readRecordNumber(candidate, USED_KEYS);
    const totalQuota = readRecordNumber(candidate, TOTAL_KEYS);
    const balance = readRecordNumber(candidate, BALANCE_KEYS);
    const unlimitedQuota = readRecordBoolean(candidate, UNLIMITED_KEYS);

    if (unlimitedQuota === true) {
      return successState(context, endpoint, [], "无限额度");
    }

    if (remainingQuota !== null) {
      const remaining = remainingQuota / factor;
      const used = usedQuota !== null ? usedQuota / factor : null;
      const total = totalQuota !== null
        ? totalQuota / factor
        : quota !== null
          ? quota / factor
          : used !== null
            ? remaining + used
            : null;
      return successState(context, endpoint, [buildUsdItem(remaining, total, used)]);
    }

    if (quota !== null) {
      const used = usedQuota !== null ? usedQuota / factor : null;
      if (mode === "remaining") {
        const remaining = quota / factor;
        const total = totalQuota !== null
          ? totalQuota / factor
          : used !== null
            ? remaining + used
            : null;
        return successState(context, endpoint, [buildUsdItem(remaining, total, used)]);
      }

      const total = quota / factor;
      const remaining = used !== null ? Math.max(0, total - used) : total;
      return successState(context, endpoint, [buildUsdItem(remaining, total, used)]);
    }

    if (totalQuota !== null && usedQuota !== null) {
      const total = totalQuota / factor;
      const used = usedQuota / factor;
      return successState(
        context,
        endpoint,
        [buildUsdItem(Math.max(0, total - used), total, used)],
      );
    }

    if (balance !== null) {
      return successState(context, endpoint, [buildUsdItem(balance, null, null)]);
    }
  }

  return supportedFailureState(context, endpoint, "站点返回了非预期格式，暂未识别余额字段");
}

function parseSub2ApiBalanceState(
  context: BalanceContext,
  endpoint: string,
  payload: unknown,
): BalanceCheckState {
  for (const candidate of collectObjectCandidates(payload)) {
    const balance = readRecordNumber(candidate, BALANCE_KEYS);
    if (balance !== null) {
      return successState(context, endpoint, [buildUsdItem(balance, null, null)]);
    }
  }

  for (const candidate of collectObjectCandidates(payload)) {
    const rawSubscriptions = Array.isArray(candidate.subscriptions)
      ? candidate.subscriptions
      : null;
    if (!rawSubscriptions) {
      continue;
    }

    const items = rawSubscriptions.flatMap((subscription): BalanceCheckItem[] => {
      if (!isRecord(subscription)) {
        return [];
      }

      const total = coerceNumber(
        subscription.monthly_limit_usd
        ?? subscription.limit_usd
        ?? subscription.total_limit_usd,
      );
      const used = coerceNumber(
        subscription.monthly_used_usd
        ?? subscription.used_usd
        ?? subscription.total_used_usd,
      );
      if (total === null && used === null) {
        return [];
      }

      const label = typeof subscription.group_name === "string" && subscription.group_name.trim()
        ? subscription.group_name.trim()
        : typeof subscription.name === "string" && subscription.name.trim()
          ? subscription.name.trim()
          : "Subscription";

      return [{
        label,
        remaining: total !== null && used !== null ? Math.max(0, total - used) : total,
        total,
        used,
        unit: "$",
      }];
    });

    if (items.length > 0) {
      return successState(context, endpoint, items);
    }
  }

  return supportedFailureState(context, endpoint, "站点返回了非预期格式，暂未识别余额字段");
}

function shouldRetryWithManagementSessionCookie(
  response: RequestResult,
  authToken: string,
  resolvedSession: SiteBalanceSession | null,
): boolean {
  const rawMessage = extractResponseMessage(response.payload) || response.bodyText;
  if (!/invalid access token|未提供 access token|not logged in|access token 无效/i.test(rawMessage)) {
    return false;
  }
  return !!resolvedSession || !authToken.trim().startsWith("sk-");
}

async function readResponseBody(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

export class BalanceService {
  constructor(private fetchImpl: typeof fetch = fetch) {}

  async query(
    profile: Pick<Profile, "provider" | "name" | "url" | "key">,
    timeoutMs: number = 8000,
    resolvedSession: SiteBalanceSession | null = null,
  ): Promise<BalanceCheckState> {
    const context = buildContext(profile);
    const apiKey = profile.key.trim();
    if (!apiKey && !resolvedSession) {
      return supportedFailureState(context, "", AUTH_FAILURE_MESSAGE);
    }

    if (isDeepSeekBaseUrl(context.base_url)) {
      return this.queryDeepSeek(context, apiKey, timeoutMs);
    }

    const familyHint = detectPlatformFamily(context.base_url);
    if (familyHint === "official_unsupported") {
      return unsupportedState(context, "官方兼容接口不提供公开余额查询");
    }
    if (familyHint === "sub2api") {
      return (await this.querySub2Api(context, apiKey, timeoutMs, true))
        ?? unsupportedState(context, NOT_SUPPORTED_MESSAGE);
    }
    if (familyHint !== "unknown") {
      return (await this.queryManagementFamily(
        context,
        apiKey,
        timeoutMs,
        resolvedSession,
        familyHint,
        true,
      )) ?? unsupportedState(context, NOT_SUPPORTED_MESSAGE);
    }

    const sub2ApiResult = await this.querySub2Api(context, apiKey, timeoutMs, false);
    if (sub2ApiResult) {
      return sub2ApiResult;
    }

    const managementResult = await this.queryManagementFamily(
      context,
      apiKey,
      timeoutMs,
      resolvedSession,
      null,
      false,
    );
    if (managementResult) {
      return managementResult;
    }

    return unsupportedState(context, NOT_SUPPORTED_MESSAGE);
  }

  private async requestJson(
    endpoint: string,
    apiKey: string,
    timeoutMs: number,
    extraHeaders: Record<string, string> = {},
    options: RequestJsonOptions = {},
  ): Promise<RequestResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        ...extraHeaders,
      };
      if (options.includeAuthorization !== false) {
        headers.Authorization = `Bearer ${apiKey}`;
      }
      const response = await this.fetchImpl(endpoint, {
        method: "GET",
        headers,
        signal: controller.signal,
      });

      const bodyText = await readResponseBody(response);
      let payload: unknown = null;
      if (bodyText) {
        try {
          payload = JSON.parse(bodyText);
        } catch {
          payload = null;
        }
      }

      return {
        ok: response.ok,
        status: response.status,
        payload,
        bodyText,
        error: "",
      };
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "网络错误 / 超时"
        : error instanceof Error
          ? error.message
          : String(error);
      return {
        ok: false,
        status: 0,
        payload: null,
        bodyText: "",
        error: message,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async queryDeepSeek(
    context: BalanceContext,
    apiKey: string,
    timeoutMs: number,
  ): Promise<BalanceCheckState> {
    const endpoint = `${context.base_url}/user/balance`;
    const response = await this.requestJson(endpoint, apiKey, timeoutMs);

    if (response.error) {
      return supportedFailureState(context, endpoint, response.error);
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        return supportedFailureState(context, endpoint, AUTH_FAILURE_MESSAGE);
      }
      return supportedFailureState(
        context,
        endpoint,
        `余额接口请求失败（HTTP ${response.status}）`,
      );
    }

    const payload = response.payload;
    const itemsSource = payload
      && typeof payload === "object"
      && "balance_infos" in payload
      && Array.isArray((payload as { balance_infos?: unknown[] }).balance_infos)
      ? (payload as { balance_infos: unknown[] }).balance_infos
      : [];

    const items = itemsSource.flatMap((item): BalanceCheckItem[] => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const currency = typeof (item as { currency?: unknown }).currency === "string"
        ? (item as { currency: string }).currency.trim() || "balance"
        : "balance";
      const total = coerceNumber(
        (item as { total_balance?: unknown }).total_balance
        ?? (item as { balance?: unknown }).balance,
      );
      if (total === null) {
        return [];
      }
      return [{
        label: currency,
        remaining: total,
        total,
        used: null,
        unit: currency.toUpperCase() === "USD" ? "$" : currency,
      }];
    });

    if (items.length === 0) {
      return supportedFailureState(context, endpoint, "站点返回了非预期格式，暂未识别余额字段");
    }
    return successState(context, endpoint, items);
  }

  private async querySub2Api(
    context: BalanceContext,
    apiKey: string,
    timeoutMs: number,
    assumeFamily: boolean,
  ): Promise<BalanceCheckState | null> {
    const endpoint = `${context.base_url}/api/v1/auth/me`;
    const response = await this.requestJson(endpoint, apiKey, timeoutMs);
    const matched = assumeFamily || sub2ApiPayloadLooksSupported(response.payload);

    if (response.error) {
      return matched ? supportedFailureState(context, endpoint, response.error) : null;
    }

    if (!response.ok) {
      if (!matched && [400, 401, 403, 404, 405].includes(response.status)) {
        return null;
      }
      if (response.status === 401 || response.status === 403) {
        return supportedFailureState(context, endpoint, AUTH_FAILURE_MESSAGE);
      }
      if (!matched && (response.status === 404 || response.status === 405)) {
        return null;
      }
      return supportedFailureState(
        context,
        endpoint,
        `余额接口请求失败（HTTP ${response.status}）`,
      );
    }

    if (!matched && !sub2ApiPayloadLooksSupported(response.payload)) {
      return null;
    }

    return parseSub2ApiBalanceState(context, endpoint, response.payload);
  }

  private async queryManagementFamily(
    context: BalanceContext,
    apiKey: string,
    timeoutMs: number,
    resolvedSession: SiteBalanceSession | null,
    familyHint: PlatformFamily | null,
    assumeFamily: boolean,
  ): Promise<BalanceCheckState | null> {
    const endpoint = `${context.base_url}/api/user/self`;
    const authToken = (resolvedSession?.access_token ?? apiKey).trim();
    if (!authToken) {
      return familyHint ? supportedFailureState(context, endpoint, AUTH_FAILURE_MESSAGE) : null;
    }

    const hintedManagementFamily: ManagementFamily | null = familyHint === "new_api_family"
      || familyHint === "one_api"
      || familyHint === "one_hub_family"
      || familyHint === "veloera"
      ? familyHint
      : detectManagementFamilyByUrl(context.base_url);
    const explicitUserId = normalizeUserIdValue(resolvedSession?.user_id);
    const userIdCandidates = buildUserIdProbeCandidates(authToken, explicitUserId);
    const preferNewApi = !!resolvedSession;

    let lastState: BalanceCheckState | null = null;
    const rememberState = (state: BalanceCheckState | null) => {
      if (state) {
        lastState = state;
      }
    };

    const bearerResponse = await this.requestJson(
      endpoint,
      authToken,
      timeoutMs,
      buildNewApiUserHeadersFromValue(explicitUserId),
    );
    const firstInspection = this.inspectManagementResponse(
      context,
      endpoint,
      authToken,
      bearerResponse,
      hintedManagementFamily,
      assumeFamily,
      "bearer",
      preferNewApi,
    );
    rememberState(firstInspection.state);
    if (firstInspection.state?.success) {
      return firstInspection.state;
    }

    if (firstInspection.shouldRetryWithUserId) {
      const triedUserIds = new Set<string>();
      if (explicitUserId) {
        triedUserIds.add(explicitUserId);
      }

      for (const userId of userIdCandidates) {
        if (triedUserIds.has(userId)) {
          continue;
        }
        triedUserIds.add(userId);

        const retryResponse = await this.requestJson(
          endpoint,
          authToken,
          timeoutMs,
          buildNewApiUserHeadersFromValue(userId),
        );
        const retryInspection = this.inspectManagementResponse(
          context,
          endpoint,
          authToken,
          retryResponse,
          hintedManagementFamily,
          assumeFamily,
          "bearer",
          preferNewApi,
        );
        rememberState(retryInspection.state);
        if (retryInspection.state?.success) {
          return retryInspection.state;
        }
        if (!retryInspection.shouldRetryWithUserId) {
          break;
        }
      }
    }

    if (shouldRetryWithManagementSessionCookie(bearerResponse, authToken, resolvedSession)) {
      const cookieHeader = buildCookieCandidates(authToken)[0];
      if (cookieHeader) {
        const triedUserIds = new Set<string>();
        const tryCookieProbe = async (userId: string | null): Promise<ManagementInspectionResult> => {
          const response = await this.requestJson(
            endpoint,
            authToken,
            timeoutMs,
            {
              ...buildNewApiUserHeadersFromValue(userId),
              Cookie: cookieHeader,
            },
            { includeAuthorization: false },
          );
          return this.inspectManagementResponse(
            context,
            endpoint,
            authToken,
            response,
            hintedManagementFamily ?? "new_api_family",
            true,
            "session_cookie",
            true,
          );
        };

        const firstCookieInspection = await tryCookieProbe(explicitUserId);
        rememberState(firstCookieInspection.state);
        if (firstCookieInspection.state?.success) {
          return firstCookieInspection.state;
        }
        if (explicitUserId) {
          triedUserIds.add(explicitUserId);
        }

        if (firstCookieInspection.shouldRetryWithUserId) {
          for (const userId of userIdCandidates) {
            if (triedUserIds.has(userId)) {
              continue;
            }
            triedUserIds.add(userId);

            const retryInspection = await tryCookieProbe(userId);
            rememberState(retryInspection.state);
            if (retryInspection.state?.success) {
              return retryInspection.state;
            }
            if (!retryInspection.shouldRetryWithUserId) {
              break;
            }
          }
        }
      }
    }

    return lastState;
  }

  private inspectManagementResponse(
    context: BalanceContext,
    endpoint: string,
    apiKey: string,
    response: RequestResult,
    familyHint: ManagementFamily | null,
    assumeFamily: boolean,
    authMode: ManagementAuthMode,
    preferNewApi: boolean,
  ): ManagementInspectionResult {
    const bodyMessage = extractResponseMessage(response.payload) || response.bodyText;
    const family = resolveManagementFamily(
      response.payload,
      response.bodyText,
      familyHint,
      authMode,
      preferNewApi,
    );

    if (looksLikeChallengeHtml(response.bodyText)) {
      if (!family && !assumeFamily) {
        return { family: null, state: null, shouldRetryWithUserId: false };
      }
      return {
        family: family ?? familyHint,
        state: supportedFailureState(context, endpoint, CHALLENGE_MESSAGE),
        shouldRetryWithUserId: false,
      };
    }

    if (response.error) {
      if (!family && !assumeFamily) {
        return { family: null, state: null, shouldRetryWithUserId: false };
      }
      return {
        family: family ?? familyHint,
        state: supportedFailureState(context, endpoint, response.error),
        shouldRetryWithUserId: false,
      };
    }

    if (!response.ok) {
      if (!family && !assumeFamily) {
        return { family: null, state: null, shouldRetryWithUserId: false };
      }

      if (response.status === 401 || response.status === 403) {
        const message = bodyMessage
          ? formatManagementFailureMessage(bodyMessage, apiKey, authMode, preferNewApi)
          : (authMode === "session_cookie" || preferNewApi ? SESSION_EXPIRED_MESSAGE : AUTH_FAILURE_MESSAGE);
        return {
          family: family ?? familyHint,
          state: supportedFailureState(context, endpoint, message),
          shouldRetryWithUserId: shouldRetryWithManagementUserId(bodyMessage),
        };
      }

      if (response.status === 404 || response.status === 405) {
        return assumeFamily
          ? {
            family: family ?? familyHint,
            state: supportedFailureState(
              context,
              endpoint,
              `余额接口请求失败（HTTP ${response.status}）`,
            ),
            shouldRetryWithUserId: false,
          }
          : { family: null, state: null, shouldRetryWithUserId: false };
      }

      const message = bodyMessage
        ? formatManagementFailureMessage(bodyMessage, apiKey, authMode, preferNewApi)
        : `余额接口请求失败（HTTP ${response.status}）`;
      return {
        family: family ?? familyHint,
        state: supportedFailureState(context, endpoint, message),
        shouldRetryWithUserId: shouldRetryWithManagementUserId(bodyMessage),
      };
    }

    if (payloadSignalsFailure(response.payload)) {
      const message = formatManagementFailureMessage(bodyMessage, apiKey, authMode, preferNewApi);
      if (!message && !family && !assumeFamily) {
        return { family: null, state: null, shouldRetryWithUserId: false };
      }
      return {
        family: family ?? familyHint,
        state: supportedFailureState(
          context,
          endpoint,
          message || "余额接口返回失败状态",
        ),
        shouldRetryWithUserId: shouldRetryWithManagementUserId(bodyMessage),
      };
    }

    const resolvedFamily = family ?? resolveManagementFamily(
      response.payload,
      bodyMessage,
      familyHint,
      authMode,
      preferNewApi,
    );
    if (!resolvedFamily) {
      return { family: null, state: null, shouldRetryWithUserId: false };
    }

    return {
      family: resolvedFamily,
      state: parseManagementBalanceState(
        context,
        endpoint,
        response.payload,
        resolvedFamily,
        `${bodyMessage} ${response.bodyText}`,
      ),
      shouldRetryWithUserId: false,
    };
  }
}
