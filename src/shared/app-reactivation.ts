export const APP_REACTIVATED_CHANNEL = "app:reactivated";
export const APP_REACTIVATION_STALE_AFTER_MS = 5 * 60 * 1000;

export type AppReactivationReason = "second_instance";

export interface AppReactivationEvent {
  reason: AppReactivationReason;
  reactivated_at: string;
}

export function shouldReconcileAfterHidden(
  hiddenAt: number | null,
  now = Date.now(),
  staleAfterMs = APP_REACTIVATION_STALE_AFTER_MS,
): boolean {
  return hiddenAt !== null && now - hiddenAt >= staleAfterMs;
}
