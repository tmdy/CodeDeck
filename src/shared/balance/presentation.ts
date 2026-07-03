import type { ProfileKey } from "../profile/types.js";
import type { BalanceCheckItem, BalanceCheckState } from "./types.js";

export type BalanceListStatus = "" | "pending" | "success" | "unsupported" | "fail";

export interface BalanceListEntry {
  label: string;
  status: BalanceListStatus;
}

function formatAmount(value: number): string {
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(value);
}

function pickPrimaryAmount(item: BalanceCheckItem): number | null {
  return item.remaining ?? item.total ?? item.used;
}

export function formatBalanceItemValue(item: BalanceCheckItem): string {
  const amount = pickPrimaryAmount(item);
  if (amount === null) {
    return item.label;
  }

  const formatted = formatAmount(amount);
  if (item.unit === "$") {
    return `$${formatted}`;
  }

  const prefix = item.unit || item.label;
  return prefix ? `${prefix} ${formatted}` : formatted;
}

export function formatBalanceItemLine(item: BalanceCheckItem): string {
  const parts: string[] = [];
  if (item.remaining !== null) {
    parts.push(`剩余 ${formatBalanceItemValue({ ...item, total: null, used: null })}`);
  }
  if (item.total !== null) {
    parts.push(`总额 ${item.unit === "$" ? `$${formatAmount(item.total)}` : `${item.unit || item.label} ${formatAmount(item.total)}`}`);
  }
  if (item.used !== null) {
    parts.push(`已用 ${item.unit === "$" ? `$${formatAmount(item.used)}` : `${item.unit || item.label} ${formatAmount(item.used)}`}`);
  }
  return parts.length > 0 ? `${item.label}: ${parts.join(" / ")}` : item.label;
}

export function summarizeBalanceState(state: BalanceCheckState | null | undefined): string {
  if (!state) {
    return "";
  }
  if (state.running) {
    return state.message || "检测中...";
  }
  if (state.success && state.items.length > 0) {
    return `${formatBalanceItemValue(state.items[0])} 剩余`;
  }
  if (state.success) {
    return state.message || "余额已更新";
  }
  if (!state.supported) {
    return state.message || "该站点暂不支持余额查询";
  }
  return state.message || "余额检测失败";
}

export function buildBalanceListEntry(state: BalanceCheckState | null | undefined): BalanceListEntry {
  if (!state) {
    return { label: "", status: "" };
  }
  if (state.running) {
    return { label: "检测中", status: "pending" };
  }
  if (state.success && state.items.length > 0) {
    return {
      label: `余额 ${formatBalanceItemValue(state.items[0])}`,
      status: "success",
    };
  }
  if (state.success) {
    return {
      label: state.message || "已更新",
      status: "success",
    };
  }
  if (!state.supported && (state.message || state.finished_at_display)) {
    return { label: "N/A", status: "unsupported" };
  }
  if (state.message || state.finished_at_display) {
    return { label: "", status: "" };
  }
  return { label: "", status: "" };
}

export function balanceStateVariant(
  state: BalanceCheckState | null | undefined,
): "success" | "danger" | "info" | "muted" {
  if (!state) {
    return "muted";
  }
  if (state.running) {
    return "info";
  }
  if (state.success) {
    return "success";
  }
  if (!state.supported) {
    return "muted";
  }
  return "danger";
}

export function getBalanceStateForProfile(
  balanceChecks: Record<ProfileKey, BalanceCheckState> | null | undefined,
  profileKey: ProfileKey,
): BalanceCheckState | null {
  if (!profileKey || !balanceChecks) {
    return null;
  }
  return balanceChecks[profileKey] ?? null;
}
