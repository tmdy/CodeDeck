import { describe, expect, it } from "vitest";
import { buildProfileCheckinEntries, formatCheckinReward } from "../../checkin/presentation.js";
import { normalizeCheckinStatesByAccount } from "../../checkin/types.js";
import type { SiteBalanceSessionsByBaseUrl } from "../../balance/site-balance-sessions.js";
import type { Profile } from "../../profile/types.js";

describe("formatCheckinReward", () => {
  it("converts New API raw quota rewards to USD", () => {
    expect(formatCheckinReward("614271")).toBe("$1.23");
    expect(formatCheckinReward("250000")).toBe("$0.5");
  });

  it("preserves non-numeric reward text", () => {
    expect(formatCheckinReward("奖励券 x1")).toBe("奖励券 x1");
  });
});

describe("profile check-in attention", () => {
  it("maps hydrated failures only to explicitly bound enabled accounts and clears recovered results", () => {
    const profiles: Profile[] = [
      { provider: "codex", name: "Any", url: "https://anyrouter.top/v1", key: "test", balance_session_id: "account-a" },
      { provider: "claude", name: "Shared", url: "https://anyrouter.top", key: "test", balance_session_id: "account-a" },
      { provider: "codex", name: "Other", url: "https://anyrouter.top", key: "test", balance_session_id: "account-b" },
      { provider: "codex", name: "Unbound", url: "https://anyrouter.top", key: "test" },
      { provider: "codex", name: "WrongSite", url: "https://other.example", key: "test", balance_session_id: "account-a" },
    ];
    const sessions: SiteBalanceSessionsByBaseUrl = {
      "https://anyrouter.top": ["account-a", "account-b"].map((id) => ({
        id, label: id, base_url: "https://anyrouter.top", access_token: "", user_id: "42", updated_at: "", auto_checkin_enabled: true,
      })),
    };
    const states = normalizeCheckinStatesByAccount({
      "https://anyrouter.top::account-a": {
        status: "failed", trigger: "automatic", message: "网络请求超时", last_attempt_at: "2026-09-11T08:00:00Z",
      },
    });
    const entries = buildProfileCheckinEntries(profiles, sessions, states);
    expect(Object.keys(entries)).toEqual(["codex::Any", "claude::Shared"]);
    expect(entries["codex::Any"]).toMatchObject({ label: "签到失败", variant: "danger" });
    expect(entries["codex::Any"].title).toContain("网络请求超时");
    expect(entries["codex::Any"].title).toContain("最近自动签到");
    expect(buildProfileCheckinEntries(profiles, sessions, {
      "https://anyrouter.top::account-a": { status: "success", trigger: "manual", message: "签到成功" },
    })).toEqual({});
    sessions["https://anyrouter.top"][0].auto_checkin_enabled = false;
    expect(buildProfileCheckinEntries(profiles, sessions, states)).toEqual({});
  });
});
