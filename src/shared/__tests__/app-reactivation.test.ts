import { describe, expect, it } from "vitest";
import {
  APP_REACTIVATION_STALE_AFTER_MS,
  shouldReconcileAfterHidden,
} from "../app-reactivation.js";

describe("app reactivation", () => {
  it("reconciles only after the configured hidden threshold", () => {
    const hiddenAt = 1_000;

    expect(shouldReconcileAfterHidden(null, hiddenAt + APP_REACTIVATION_STALE_AFTER_MS)).toBe(false);
    expect(shouldReconcileAfterHidden(
      hiddenAt,
      hiddenAt + APP_REACTIVATION_STALE_AFTER_MS - 1,
    )).toBe(false);
    expect(shouldReconcileAfterHidden(
      hiddenAt,
      hiddenAt + APP_REACTIVATION_STALE_AFTER_MS,
    )).toBe(true);
  });
});
