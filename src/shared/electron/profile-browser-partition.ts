import { createHash } from "node:crypto";
import {
  parseProfileBrowserTarget,
  resolveBaseUrlBrowserTarget,
  type ProfileBrowserTarget,
} from "./open-url.js";

const CUSTOM_COMPATIBILITY_PARTITION_PREFIX = "persist:codedeck-custom-compatibility-";

export interface SavedProfileBrowserAccount {
  auth_kind?: string;
  browser_origin?: string;
}

export interface ProfileBrowserIdentitySlot {
  browser_session_id: string;
}

export interface ProfileBrowserPartitionDependencies<
  TSavedAccount extends SavedProfileBrowserAccount,
> {
  defaultPartition: string;
  normalizeBaseUrl: (rawBaseUrl: string) => string;
  normalizeBrowserOrigin: (browserOrigin: string) => string;
  findSavedSession: (normalizedBaseUrl: string, sessionId: string) => TSavedAccount;
  getSavedSessionPartition: (account: TSavedAccount) => string;
  findBrowserSlot: (slot: number) => ProfileBrowserIdentitySlot | undefined;
  getBrowserSlotPartition: (browserSessionId: string) => string;
  preparePendingPartition: (normalizedBaseUrl: string) => string;
}

export function resolveProfileBrowserPartitionRequest<
  TSavedAccount extends SavedProfileBrowserAccount,
>(
  rawBaseUrl: string,
  targetInput: unknown,
  dependencies: ProfileBrowserPartitionDependencies<TSavedAccount>,
): { partition: string; target: ProfileBrowserTarget } {
  const target = parseProfileBrowserTarget(targetInput);
  if (!target) {
    throw new Error("Profile 浏览器打开目标无效");
  }
  const targetOrigin = resolveBaseUrlBrowserTarget(rawBaseUrl);
  const normalizedBaseUrl = dependencies.normalizeBaseUrl(rawBaseUrl);
  if (!normalizedBaseUrl) {
    throw new Error("Base URL 不能为空");
  }

  if (target.kind === "saved_session") {
    const selectedAccount = dependencies.findSavedSession(
      normalizedBaseUrl,
      target.session_id,
    );
    const browserOrigin = selectedAccount.browser_origin
      ? dependencies.normalizeBrowserOrigin(selectedAccount.browser_origin)
      : "";
    if (
      selectedAccount.auth_kind !== "browser_session"
      || browserOrigin !== targetOrigin
    ) {
      throw new Error("后台账号与 Base URL 来源不一致");
    }
    return {
      partition: dependencies.getSavedSessionPartition(selectedAccount),
      target,
    };
  }

  if (target.kind === "browser_slot") {
    const slot = dependencies.findBrowserSlot(target.slot);
    if (!slot) {
      throw new Error(`浏览器账号${target.slot}不存在`);
    }
    return {
      partition: dependencies.getBrowserSlotPartition(slot.browser_session_id),
      target,
    };
  }

  if (target.kind === "pending_browser_account") {
    return {
      partition: dependencies.preparePendingPartition(normalizedBaseUrl),
      target,
    };
  }

  return { partition: dependencies.defaultPartition, target };
}

export function customCompatibilityPartitionName(accountKey: string): string {
  const normalized = accountKey.trim();
  if (!normalized) {
    throw new Error("自定义兼容账号标识不能为空");
  }
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 24);
  return `${CUSTOM_COMPATIBILITY_PARTITION_PREFIX}${digest}`;
}
