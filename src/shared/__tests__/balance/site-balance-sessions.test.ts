import { describe, expect, it } from "vitest";
import type { Profile } from "../../profile/types.js";
import {
  buildProfileBalanceCheckState,
  describeBalanceSessionHint,
  normalizeBalanceBaseUrl,
  normalizeSiteBalanceSessionsByBaseUrl,
  resolveBalanceAuth,
  resolveSharedBalanceProfileKeys,
  type SiteBalanceSession,
} from "../../balance/site-balance-sessions.js";
import type { BalanceCheckState } from "../../balance/types.js";

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    provider: "codex",
    name: "Relay",
    url: "https://new-api.example.com/v1",
    key: "sk-profile",
    ...overrides,
  };
}

function makeSession(id: string, label: string): SiteBalanceSession {
  return {
    id,
    label,
    base_url: "https://new-api.example.com",
    access_token: `token-${id}`,
    user_id: `${id.length * 10}`,
    updated_at: "2026-05-05T09:00:00.000Z",
  };
}

function makeBalanceState(overrides: Partial<BalanceCheckState> = {}): BalanceCheckState {
  return {
    provider: "codex",
    profile_name: "Source",
    base_url: "https://new-api.example.com",
    running: false,
    supported: true,
    success: true,
    message: "余额已更新",
    items: [{ label: "USD", remaining: 12.34, total: 20, used: 7.66, unit: "$" }],
    endpoint: "https://new-api.example.com/api/user/self",
    finished_at_display: "2026/05/07 15:00:00",
    ...overrides,
  };
}

describe("site-balance-sessions", () => {
  it("keeps sessions whose platform does not require a User ID", () => {
    const normalized = normalizeSiteBalanceSessionsByBaseUrl({
      "https://console.aihubmix.com": [{
        id: "aihub-account",
        label: "AIHubMix",
        base_url: "https://console.aihubmix.com",
        access_token: "management-token",
        user_id: "",
        updated_at: "2026-07-15T00:00:00.000Z",
      }],
    });

    expect(normalized["https://console.aihubmix.com"][0].user_id).toBe("");
  });

  it("preserves optional Sub2API refresh credentials while normalizing sessions", () => {
    const normalized = normalizeSiteBalanceSessionsByBaseUrl({
      "https://sub2api.example.com": [{
        id: "sub-account",
        label: "Sub2API",
        base_url: "https://sub2api.example.com",
        access_token: " access-a ",
        refresh_token: " refresh-a ",
        token_expires_at: 1_800_000_000_000,
        user_id: "",
      }],
    });

    expect(normalized["https://sub2api.example.com"][0]).toEqual(expect.objectContaining({
      access_token: "access-a",
      refresh_token: "refresh-a",
      token_expires_at: 1_800_000_000_000,
    }));
  });

  it("normalizes balance base urls to the site root", () => {
    expect(normalizeBalanceBaseUrl("https://new-api.example.com/v1/chat/completions")).toBe(
      "https://new-api.example.com",
    );
  });

  it("uses the profile api key in auto mode when the site has a single session", () => {
    const resolved = resolveBalanceAuth(makeProfile(), {
      "https://new-api.example.com": [makeSession("sess-a", "后台 A")],
    });

    expect(resolved.kind).toBe("none");
    if (resolved.kind !== "none") {
      throw new Error("expected profile api key auth");
    }
    expect(resolved.reason).toBe("no_session");
  });

  it("uses the profile api key in auto mode even when site sessions exist", () => {
    const resolved = resolveBalanceAuth(makeProfile(), {
      "https://new-api.example.com": [
        makeSession("sess-a", "后台 A"),
        makeSession("sess-b", "后台 B"),
      ],
    });

    expect(resolved.kind).toBe("none");
    if (resolved.kind !== "none") {
      throw new Error("expected profile api key auth");
    }
    expect(resolved.reason).toBe("no_session");
  });

  it("keeps using the explicitly bound session after other sessions are added", () => {
    const resolved = resolveBalanceAuth(makeProfile({ balance_session_id: "sess-a" }), {
      "https://new-api.example.com": [
        makeSession("sess-a", "后台 A"),
        makeSession("sess-b", "后台 B"),
      ],
    });

    expect(resolved.kind).toBe("explicit_session");
    if (resolved.kind !== "explicit_session") {
      throw new Error("expected explicit_session");
    }
    expect(resolved.session.id).toBe("sess-a");
  });

  it("reports deleted explicit bindings through a none result with a missing-session reason", () => {
    const resolved = resolveBalanceAuth(makeProfile({ balance_session_id: "sess-deleted" }), {
      "https://new-api.example.com": [makeSession("sess-a", "后台 A")],
    });

    expect(resolved.kind).toBe("none");
    if (resolved.kind !== "none") {
      throw new Error("expected none");
    }
    expect(resolved.reason).toBe("missing_bound_session");
  });

  it("describes the selected session label for explicit bindings", () => {
    const hint = describeBalanceSessionHint(
      makeProfile({ balance_session_id: "sess-a" }),
      {
        "https://new-api.example.com": [makeSession("sess-a", "后台 A")],
      },
    );

    expect(hint).toBe("后台会话：账号1");
  });

  it("renames legacy custom labels to sequential account labels", () => {
    const resolved = resolveBalanceAuth(makeProfile({ balance_session_id: "sess-b" }), {
      "https://new-api.example.com": [
        makeSession("sess-a", "主账号"),
        makeSession("sess-b", "运营后台"),
      ],
    });

    expect(resolved.kind).toBe("explicit_session");
    if (resolved.kind !== "explicit_session") {
      throw new Error("expected explicit_session");
    }
    expect(resolved.session.label).toBe("账号2");
  });

  it("does not warn about sessions in auto mode", () => {
    const hint = describeBalanceSessionHint(
      makeProfile(),
      {
        "https://new-api.example.com": [
          makeSession("sess-a", "后台 A"),
          makeSession("sess-b", "后台 B"),
        ],
      },
    );

    expect(hint).toBe("");
  });

  it("explains when an explicitly bound session has been deleted", () => {
    const hint = describeBalanceSessionHint(
      makeProfile({ balance_session_id: "sess-missing" }),
      {
        "https://new-api.example.com": [makeSession("sess-a", "后台 A")],
      },
    );

    expect(hint).toBe("后台会话：所绑定会话已被删除");
  });

  it("shares balance state for explicit sessions on the same normalized site", () => {
    const profiles: Profile[] = [
      makeProfile({ name: "Root", url: "https://new-api.example.com/v1", balance_session_id: "sess-a" }),
      makeProfile({ name: "Completions", url: "https://new-api.example.com/v1/chat/completions", balance_session_id: "sess-a" }),
    ];

    expect(
      resolveSharedBalanceProfileKeys(profiles, "codex::Root", {
        "https://new-api.example.com": [makeSession("sess-a", "后台 A")],
      }),
    ).toEqual(["codex::Root", "codex::Completions"]);
  });

  it("does not share an explicit session with auto api-key profiles", () => {
    const profiles: Profile[] = [
      makeProfile({ name: "Bound", balance_session_id: "sess-a" }),
      makeProfile({ name: "Auto" }),
    ];

    expect(
      resolveSharedBalanceProfileKeys(profiles, "codex::Bound", {
        "https://new-api.example.com": [makeSession("sess-a", "后台 A")],
      }),
    ).toEqual(["codex::Bound"]);
  });

  it("keeps different explicit sessions isolated on the same site", () => {
    const profiles: Profile[] = [
      makeProfile({ name: "Account A", balance_session_id: "sess-a" }),
      makeProfile({ name: "Account B", balance_session_id: "sess-b" }),
    ];

    expect(
      resolveSharedBalanceProfileKeys(profiles, "codex::Account A", {
        "https://new-api.example.com": [
          makeSession("sess-a", "后台 A"),
          makeSession("sess-b", "后台 B"),
        ],
      }),
    ).toEqual(["codex::Account A"]);
  });

  it("does not share an ambiguous auto session across profiles", () => {
    const profiles: Profile[] = [
      makeProfile({ name: "Auto A" }),
      makeProfile({ name: "Auto B" }),
    ];

    expect(
      resolveSharedBalanceProfileKeys(profiles, "codex::Auto A", {
        "https://new-api.example.com": [
          makeSession("sess-a", "后台 A"),
          makeSession("sess-b", "后台 B"),
        ],
      }),
    ).toEqual(["codex::Auto A"]);
  });

  it("shares the same site session across providers", () => {
    const profiles: Profile[] = [
      makeProfile({ provider: "codex", name: "Codex", balance_session_id: "sess-a" }),
      makeProfile({ provider: "claude", name: "Claude", balance_session_id: "sess-a" }),
    ];

    expect(
      resolveSharedBalanceProfileKeys(profiles, "codex::Codex", {
        "https://new-api.example.com": [makeSession("sess-a", "后台 A")],
      }),
    ).toEqual(["codex::Codex", "claude::Claude"]);
  });

  it("does not share sessions across different normalized sites", () => {
    const profiles: Profile[] = [
      makeProfile({ name: "Site A", url: "https://new-api.example.com/v1", balance_session_id: "sess-a" }),
      makeProfile({ name: "Site B", url: "https://other.example.com/v1", balance_session_id: "sess-a" }),
    ];

    expect(
      resolveSharedBalanceProfileKeys(profiles, "codex::Site A", {
        "https://new-api.example.com": [makeSession("sess-a", "后台 A")],
        "https://other.example.com": [{ ...makeSession("sess-a", "后台 A"), base_url: "https://other.example.com" }],
      }),
    ).toEqual(["codex::Site A"]);
  });

  it("builds per-profile balance states without leaking source profile identity", () => {
    const targetProfile = makeProfile({
      provider: "claude",
      name: "Target",
      url: "https://new-api.example.com/v1/chat/completions",
    });
    const state = makeBalanceState({ running: true, success: false, message: "正在检测余额..." });

    expect(buildProfileBalanceCheckState(targetProfile, state)).toEqual({
      ...state,
      provider: "claude",
      profile_name: "Target",
      base_url: "https://new-api.example.com",
      items: [{ label: "USD", remaining: 12.34, total: 20, used: 7.66, unit: "$" }],
    });
  });
});
