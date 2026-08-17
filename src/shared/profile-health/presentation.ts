import type { ProfileHealthState, ProfileHealthStatus } from "./types.js";

export interface ProfileHealthListEntry {
  label: string;
  status: string;
  title: string;
}

const STATUS_LABELS: Record<ProfileHealthStatus, string> = {
  available: "可用",
  degraded: "降级",
  rate_limited: "限流",
  auth_failed: "鉴权",
  model_unavailable: "模型",
  network_error: "网络",
  unknown: "未测",
};

export function buildProfileHealthListEntry(state?: ProfileHealthState): ProfileHealthListEntry {
  if (state?.running) {
    return { label: "检测中", status: "pending", title: "渠道健康检测进行中" };
  }
  const status = state?.status ?? "unknown";
  return {
    label: STATUS_LABELS[status],
    status: status === "available" ? "success" : status === "unknown" ? "unknown" : "fail",
    title: state?.last_failure || `渠道健康状态：${STATUS_LABELS[status]}`,
  };
}

export function formatProfileHealthDetails(state?: ProfileHealthState): string[] {
  if (!state) return ["尚未检测"];
  const details: string[] = [];
  details.push(`来源：${state.source === "passive" ? "受监控终端" : "主动检测"}`);
  if (state.verified_at) details.push(`最近验证：${formatDateTime(state.verified_at)}`);
  if (state.latency_ms !== undefined) details.push(`延迟：${state.latency_ms}ms`);
  if (state.consecutive_successes > 0) details.push(`连续成功：${state.consecutive_successes} 次`);
  if (state.last_failure) details.push(`最近失败：${state.last_failure}`);
  return details;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("zh-CN", { hour12: false });
}
