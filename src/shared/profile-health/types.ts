import {
  getActiveProfileChannel,
  getProfileSelectedModelId,
  normalizeProvider,
  type Profile,
  type ProfileKey,
  type ProviderID,
} from "../profile/types.js";
import { itemKey } from "../profile/keys-internal.js";

export type ProfileHealthStatus =
  | "available"
  | "degraded"
  | "rate_limited"
  | "auth_failed"
  | "model_unavailable"
  | "network_error"
  | "unknown";

export type ProfileHealthSource = "active" | "passive";

export type ProfileHealthReasonCode =
  | "ok"
  | "continuity_invalid"
  | "empty_response"
  | "rate_limited"
  | "auth_failed"
  | "provider_error"
  | "timeout"
  | "network_error"
  | "not_checked";

export interface ProfileHealthTarget {
  provider: ProviderID;
  profile_key: ProfileKey;
  channel_id: string;
  base_url: string;
  model_id: string;
}

export interface ProfileHealthCheckpoint {
  sequence: number;
  carry_word: string;
  assistant_text: string;
}

export interface ProfileHealthState {
  target: ProfileHealthTarget;
  status: ProfileHealthStatus;
  reason_code: ProfileHealthReasonCode;
  source: ProfileHealthSource;
  running: boolean;
  latency_ms?: number;
  checked_at: string;
  verified_at: string;
  consecutive_successes: number;
  last_failure: string;
  http_status?: number;
  checkpoint?: ProfileHealthCheckpoint;
}

export type ProfileHealthByTarget = Record<string, ProfileHealthState>;

export interface ProfileHealthTestRequest {
  profile_key?: ProfileKey;
  profile: Profile;
}

export interface ProfileHealthTestResult {
  target_key: string;
  state: ProfileHealthState;
  persisted: boolean;
}

export interface ProfileHealthProgressEvent extends ProfileHealthTestResult {}

export function normalizeProfileHealthBaseUrl(value: string): string {
  const normalized = normalizeProfileHealthRequestBaseUrl(value);
  if (!normalized) {
    return "";
  }
  try {
    const url = new URL(normalized);
    url.username = "";
    url.password = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return normalized.replace(/^(https?:\/\/)[^/@]+@/i, "$1");
  }
}

export function normalizeProfileHealthRequestBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  try {
    const url = new URL(trimmed);
    url.hash = "";
    url.search = "";
    url.pathname = url.pathname.replace(/\/+$/, "");
    return url.toString().replace(/\/$/, "");
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

export function buildProfileHealthTarget(
  profile: Profile,
  profileKey: ProfileKey = "",
  modelOverride: string = "",
): ProfileHealthTarget {
  const channel = getActiveProfileChannel(profile);
  return {
    provider: normalizeProvider(profile.provider),
    profile_key: profileKey.trim(),
    channel_id: channel.id.trim(),
    base_url: normalizeProfileHealthBaseUrl(profile.url),
    model_id: modelOverride.trim() || getProfileSelectedModelId(profile).trim(),
  };
}

export function profileHealthTargetKey(target: ProfileHealthTarget): string {
  return [
    target.provider,
    target.profile_key,
    target.channel_id,
    target.base_url,
    target.model_id,
  ].map((part) => encodeURIComponent(part)).join("|");
}

export function sameProfileHealthTarget(
  left: ProfileHealthTarget,
  right: ProfileHealthTarget,
): boolean {
  return profileHealthTargetKey(left) === profileHealthTargetKey(right);
}

export function profileHealthRequestMatchesSavedProfile(
  saved: Profile,
  request: ProfileHealthTestRequest,
): boolean {
  const savedKey = itemKey(saved);
  const requestedKey = request.profile_key?.trim() ?? "";
  return Boolean(requestedKey)
    && requestedKey === savedKey
    && sameProfileHealthTarget(
      buildProfileHealthTarget(saved, savedKey),
      buildProfileHealthTarget(request.profile, requestedKey),
    )
    && normalizeProfileHealthRequestBaseUrl(saved.url)
      === normalizeProfileHealthRequestBaseUrl(request.profile.url)
    && getActiveProfileChannel(saved).key === getActiveProfileChannel(request.profile).key;
}

export function normalizeProfileHealthByTarget(value: unknown): ProfileHealthByTarget {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const result: ProfileHealthByTarget = {};
  for (const state of Object.values(value as Record<string, unknown>)) {
    const normalized = normalizeProfileHealthState(state);
    if (!normalized) continue;
    result[profileHealthTargetKey(normalized.target)] = normalized;
  }
  return result;
}

export function normalizeProfileHealthState(value: unknown): ProfileHealthState | null {
  const record = asRecord(value);
  const rawTarget = asRecord(record?.target);
  if (!record || !rawTarget) {
    return null;
  }
  const provider = rawTarget.provider === "codex" ? "codex" : rawTarget.provider === "claude" ? "claude" : "";
  const baseUrl = normalizeProfileHealthBaseUrl(stringValue(rawTarget.base_url));
  const channelId = stringValue(rawTarget.channel_id);
  const modelId = stringValue(rawTarget.model_id);
  if (!provider || !baseUrl || !channelId || !modelId) {
    return null;
  }
  const status = normalizeStatus(record.status);
  const reasonCode = normalizeReasonCode(record.reason_code, status);
  const checkpoint = normalizeCheckpoint(record.checkpoint);
  const latencyMs = finiteNonNegative(record.latency_ms);
  const httpStatus = finiteNonNegative(record.http_status);
  return {
    target: {
      provider,
      profile_key: stringValue(rawTarget.profile_key),
      channel_id: channelId,
      base_url: baseUrl,
      model_id: modelId,
    },
    status,
    reason_code: reasonCode,
    source: record.source === "passive" ? "passive" : "active",
    running: record.running === true,
    ...(latencyMs === undefined ? {} : { latency_ms: Math.round(latencyMs) }),
    checked_at: stringValue(record.checked_at),
    verified_at: stringValue(record.verified_at),
    consecutive_successes: Math.max(0, Math.floor(finiteNonNegative(record.consecutive_successes) ?? 0)),
    last_failure: boundedText(record.last_failure, 500),
    ...(httpStatus === undefined ? {} : { http_status: Math.round(httpStatus) }),
    ...(checkpoint ? { checkpoint } : {}),
  };
}

export function cloneProfileHealthByTarget(value: ProfileHealthByTarget): ProfileHealthByTarget {
  return Object.fromEntries(Object.entries(value).map(([key, state]) => [
    key,
    {
      ...state,
      target: { ...state.target },
      ...(state.checkpoint ? { checkpoint: { ...state.checkpoint } } : {}),
    },
  ]));
}

export function clearProfileHealthForProfile(
  value: ProfileHealthByTarget,
  profileKeys: Iterable<ProfileKey>,
): void {
  const keys = new Set(Array.from(profileKeys, (key) => key.trim()).filter(Boolean));
  if (keys.size === 0) return;
  for (const [targetKey, state] of Object.entries(value)) {
    if (keys.has(state.target.profile_key)) {
      delete value[targetKey];
    }
  }
}

function normalizeStatus(value: unknown): ProfileHealthStatus {
  switch (value) {
    case "available":
    case "degraded":
    case "rate_limited":
    case "auth_failed":
    case "model_unavailable":
    case "network_error":
      return value;
    default:
      return "unknown";
  }
}

function normalizeReasonCode(value: unknown, status: ProfileHealthStatus): ProfileHealthReasonCode {
  switch (value) {
    case "ok":
    case "continuity_invalid":
    case "empty_response":
    case "rate_limited":
    case "auth_failed":
    case "provider_error":
    case "timeout":
    case "network_error":
    case "not_checked":
      return value;
    default:
      return status === "available" ? "ok" : "not_checked";
  }
}

function normalizeCheckpoint(value: unknown): ProfileHealthCheckpoint | undefined {
  const record = asRecord(value);
  const sequence = finiteNonNegative(record?.sequence);
  const carryWord = stringValue(record?.carry_word);
  const assistantText = boundedText(record?.assistant_text, 4_000);
  if (!record || sequence === undefined || !carryWord || !assistantText) {
    return undefined;
  }
  return {
    sequence: Math.floor(sequence),
    carry_word: carryWord,
    assistant_text: assistantText,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boundedText(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function finiteNonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
