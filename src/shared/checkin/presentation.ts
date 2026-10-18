import { getSiteBalanceSessionsForBaseUrl, normalizeBalanceBaseUrl, type SiteBalanceSessionsByBaseUrl } from "../balance/site-balance-sessions.js";
import { itemKey } from "../profile/keys-internal.js";
import type { Profile, ProfileKey } from "../profile/types.js";
import { buildCheckinAccountKey, type CheckinAccountState, type CheckinStatesByAccount } from "./types.js";

const DEFAULT_QUOTA_PER_USD = 500_000;

export interface CheckinAttentionEntry {
  label: string;
  variant: "danger" | "warning";
  title: string;
}

export function summarizeCheckinState(state: CheckinAccountState | null | undefined): string {
  if (!state) return "";
  if (state.status === "running") return "签到中";
  if (state.status === "verifying") return "等待人工验证";
  if (state.status === "scheduled") return "已安排";
  if (state.status === "success") return "签到成功";
  if (state.status === "already_checked") return "今日已签到";
  if (state.status === "manual_required") return "需人工验证";
  if (state.status === "login_required") return "需重新登录";
  if (state.status === "unsupported") return "暂不支持签到";
  return "签到失败";
}

export function checkinStateVariant(state: CheckinAccountState | null | undefined): "success" | "danger" | "warning" | "info" | "muted" {
  if (!state) return "muted";
  if (state.status === "success" || state.status === "already_checked") return "success";
  if (state.status === "failed") return "danger";
  if (state.status === "manual_required" || state.status === "login_required" || state.status === "unsupported") return "warning";
  return "info";
}

export function isFailedCheckinState(state: CheckinAccountState): boolean {
  return state.status === "failed" || state.status === "login_required" || state.status === "unsupported" || state.status === "manual_required";
}

export function formatCheckinDateTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

export function formatCheckinDiagnosticId(value: string): string {
  return value.length <= 12 ? value : value.slice(0, 8);
}

export function buildCheckinTitle(state: CheckinAccountState | null | undefined): string {
  if (!state) return "";
  const triggerLabel = state.trigger === "automatic" ? "最近自动签到" : state.trigger === "manual" ? "最近手动签到" : "最近签到";
  return [
    state.message,
    state.reward ? `奖励：${formatCheckinReward(state.reward)}` : "",
    state.last_attempt_at ? `${triggerLabel}：${formatCheckinDateTime(state.last_attempt_at)}` : "",
    state.diagnostic_run_id ? `诊断编号：${formatCheckinDiagnosticId(state.diagnostic_run_id)}` : "",
  ].filter(Boolean).join(" · ");
}

export function buildProfileCheckinEntries(
  profiles: Profile[],
  sessions: SiteBalanceSessionsByBaseUrl,
  states: CheckinStatesByAccount,
): Record<ProfileKey, CheckinAttentionEntry> {
  const entries: Record<ProfileKey, CheckinAttentionEntry> = {};
  for (const profile of profiles) {
    if (!profile.balance_session_id) continue;
    const account = getSiteBalanceSessionsForBaseUrl(sessions, profile.url)
      .find((candidate) => candidate.id === profile.balance_session_id);
    if (!account?.auto_checkin_enabled) continue;
    const state = states[buildCheckinAccountKey(normalizeBalanceBaseUrl(account.base_url), account.id)];
    if (!state || !isFailedCheckinState(state)) continue;
    entries[itemKey(profile)] = {
      label: summarizeCheckinState(state),
      variant: state.status === "failed" ? "danger" : "warning",
      title: buildCheckinTitle(state),
    };
  }
  return entries;
}

export function formatCheckinReward(
  value: string,
  quotaPerUsd: number = DEFAULT_QUOTA_PER_USD,
): string {
  const trimmed = value.trim();
  const rawQuota = Number(trimmed);
  if (!trimmed || !Number.isFinite(rawQuota) || rawQuota < 0 || quotaPerUsd <= 0) {
    return trimmed;
  }

  const amount = rawQuota / quotaPerUsd;
  const maximumFractionDigits = Math.abs(amount) >= 1 ? 2 : 6;
  return `$${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  }).format(amount)}`;
}
