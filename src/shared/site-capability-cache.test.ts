import { describe, expect, it } from "vitest";
import {
  normalizeSiteCapabilityCache,
  SITE_CAPABILITY_TTL_MS,
} from "./site-capability-cache.js";

describe("site capability cache", () => {
  it("drops expired and malformed paths while retaining current enum-only metadata", () => {
    const now = Date.parse("2026-07-28T12:00:00.000Z");
    const cache = normalizeSiteCapabilityCache({
      checkin_by_account: {
        current: {
          platform: "management",
          endpoint_path: "/api/user/checkin",
          method: "POST",
          authorization_mode: "bearer",
          cookie_mode: "none",
          requires_user_id: true,
          learned_at: new Date(now).toISOString(),
          credential_updated_at: "credential-v1",
        },
        expired: {
          platform: "management",
          endpoint_path: "/api/user/checkin",
          method: "POST",
          authorization_mode: "raw",
          cookie_mode: "none",
          requires_user_id: true,
          learned_at: new Date(now - SITE_CAPABILITY_TTL_MS - 1).toISOString(),
          credential_updated_at: "credential-v1",
        },
        unsafe: {
          platform: "management",
          endpoint_path: "/api/user/checkin",
          method: "POST",
          authorization_mode: "Bearer secret-token",
          cookie_mode: "none",
          requires_user_id: true,
          learned_at: new Date(now).toISOString(),
          credential_updated_at: "credential-v1",
        },
      },
    }, now);

    expect(Object.keys(cache.checkin_by_account)).toEqual(["current"]);
    expect(JSON.stringify(cache)).not.toContain("secret-token");
  });
});
