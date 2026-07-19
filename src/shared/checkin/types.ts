export type CheckinResultStatus =
  | "success"
  | "already_checked"
  | "manual_required"
  | "unsupported"
  | "failed";

export type CheckinDisplayStatus = CheckinResultStatus | "scheduled" | "running" | "verifying";
export type CheckinTrigger = "automatic" | "manual";
export type CheckinVerificationCookieMode = "raw" | "session_wrapped" | "token_wrapped";
export interface CheckinVerificationMetadata {
  cookie_mode?: CheckinVerificationCookieMode;
}

export type CheckinVerificationResultStatus =
  | "success"
  | "already_checked"
  | "canceled"
  | "timeout"
  | "account_mismatch"
  | "failed";
export type CheckinErrorCode =
  | "auth_not_logged_in"
  | "access_token_invalid"
  | "user_id_missing"
  | "user_id_mismatch"
  | "business_rejected"
  | "turnstile_required"
  | "endpoint_missing"
  | "rate_limited"
  | "network_error"
  | "server_error"
  | "unknown_failure";

export interface CheckinResult {
  status: CheckinResultStatus;
  success: boolean;
  message: string;
  endpoint: string;
  reward?: string;
  manual_url?: string;
  error_code?: CheckinErrorCode;
  diagnostic_run_id?: string;
  verification?: CheckinVerificationMetadata;
}

export interface CheckinVerificationResult {
  status: CheckinVerificationResultStatus;
  success: boolean;
  message: string;
  endpoint: string;
  reward?: string;
  error_code?: CheckinErrorCode;
  verification?: CheckinVerificationMetadata;
}

export interface CheckinAccountState {
  status: CheckinDisplayStatus;
  trigger?: CheckinTrigger;
  message: string;
  endpoint?: string;
  reward?: string;
  manual_url?: string;
  error_code?: CheckinErrorCode;
  diagnostic_run_id?: string;
  verification?: CheckinVerificationMetadata;
  last_attempt_at?: string;
  last_auto_attempt_local_date?: string;
  satisfied_local_date?: string;
}

export type CheckinStatesByAccount = Record<string, CheckinAccountState>;

export interface CheckinSnapshot {
  states_by_account: CheckinStatesByAccount;
  next_scheduled_at: string;
}

export interface CheckinBatchSummary {
  total: number;
  success: number;
  already_checked: number;
  manual_required: number;
  unsupported: number;
  failed: number;
}

export function buildCheckinAccountKey(baseUrl: string, sessionId: string): string {
  return `${baseUrl.trim().replace(/\/+$/, "")}::${sessionId.trim()}`;
}

export function localDateKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeCheckinStatesByAccount(value: unknown): CheckinStatesByAccount {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const allowedStatuses = new Set<CheckinDisplayStatus>([
    "success",
    "already_checked",
    "manual_required",
    "unsupported",
    "failed",
    "scheduled",
    "running",
    "verifying",
  ]);
  const result: CheckinStatesByAccount = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!key || !raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }
    const record = raw as Record<string, unknown>;
    if (!allowedStatuses.has(record.status as CheckinDisplayStatus)) {
      continue;
    }
    const trigger = record.trigger === "automatic" || record.trigger === "manual"
      ? record.trigger
      : undefined;
    const interruptedVerification = record.status === "verifying";
    const verification = normalizeCheckinVerificationMetadata(record.verification);
    result[key] = {
      status: interruptedVerification ? "manual_required" : record.status as CheckinDisplayStatus,
      ...(trigger ? { trigger } : {}),
      message: interruptedVerification
        ? "上次人工验证已中断，请重新打开验证窗口"
        : typeof record.message === "string" ? record.message : "",
      ...(typeof record.endpoint === "string" ? { endpoint: record.endpoint } : {}),
      ...(typeof record.reward === "string" ? { reward: record.reward } : {}),
      ...(typeof record.manual_url === "string" ? { manual_url: record.manual_url } : {}),
      ...(isCheckinErrorCode(record.error_code)
        ? { error_code: record.error_code }
        : {}),
      ...(typeof record.diagnostic_run_id === "string"
        ? { diagnostic_run_id: record.diagnostic_run_id }
        : {}),
      ...(verification ? { verification } : {}),
      ...(typeof record.last_attempt_at === "string" ? { last_attempt_at: record.last_attempt_at } : {}),
      ...(typeof record.last_auto_attempt_local_date === "string"
        ? { last_auto_attempt_local_date: record.last_auto_attempt_local_date }
        : {}),
      ...(typeof record.satisfied_local_date === "string"
        ? { satisfied_local_date: record.satisfied_local_date }
        : {}),
    };
  }
  return result;
}

function normalizeCheckinVerificationMetadata(value: unknown): CheckinVerificationMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const cookieMode = (value as { cookie_mode?: unknown }).cookie_mode;
  return cookieMode === "raw" || cookieMode === "session_wrapped" || cookieMode === "token_wrapped"
    ? { cookie_mode: cookieMode }
    : null;
}

function isCheckinErrorCode(value: unknown): value is CheckinErrorCode {
  return typeof value === "string" && new Set<CheckinErrorCode>([
    "auth_not_logged_in",
    "access_token_invalid",
    "user_id_missing",
    "user_id_mismatch",
    "business_rejected",
    "turnstile_required",
    "endpoint_missing",
    "rate_limited",
    "network_error",
    "server_error",
    "unknown_failure",
  ]).has(value as CheckinErrorCode);
}
