const DEFAULT_QUOTA_PER_USD = 500_000;

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
