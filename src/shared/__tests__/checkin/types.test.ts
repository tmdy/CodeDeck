import { describe, expect, it } from "vitest";
import { normalizeCheckinStatesByAccount } from "../../checkin/types.js";

describe("normalizeCheckinStatesByAccount", () => {
  it("recovers a persisted verifying state as manual-required after restart", () => {
    expect(normalizeCheckinStatesByAccount({
      "https://example.com::account-a": {
        status: "verifying",
        trigger: "automatic",
        message: "等待人工验证",
        verification: { cookie_mode: "session_wrapped" },
      },
    })).toEqual({
      "https://example.com::account-a": {
        status: "manual_required",
        trigger: "automatic",
        message: "上次人工验证已中断，请重新打开验证窗口",
        verification: { cookie_mode: "session_wrapped" },
      },
    });
  });

  it("drops unknown verification metadata instead of exposing arbitrary persisted values", () => {
    const normalized = normalizeCheckinStatesByAccount({
      account: {
        status: "manual_required",
        message: "需要验证",
        verification: {
          cookie_mode: "session_wrapped",
          cookie: "secret-cookie",
          token: "secret-token",
        },
      },
    });

    expect(normalized.account.verification).toEqual({ cookie_mode: "session_wrapped" });
    expect(JSON.stringify(normalized)).not.toContain("secret-cookie");
    expect(JSON.stringify(normalized)).not.toContain("secret-token");
  });
});
