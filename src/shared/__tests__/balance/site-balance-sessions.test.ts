import { describe, expect, it } from "vitest";
import type { Profile } from "../../profile/types.js";
import {
  describeBalanceSessionHint,
  normalizeBalanceBaseUrl,
  resolveBalanceAuth,
  type SiteBalanceSession,
} from "../../balance/site-balance-sessions.js";

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

describe("site-balance-sessions", () => {
  it("normalizes balance base urls to the site root", () => {
    expect(normalizeBalanceBaseUrl("https://new-api.example.com/v1/chat/completions")).toBe(
      "https://new-api.example.com",
    );
  });

  it("resolves an implicit single session when the profile stays on auto", () => {
    const resolved = resolveBalanceAuth(makeProfile(), {
      "https://new-api.example.com": [makeSession("sess-a", "后台 A")],
    });

    expect(resolved.kind).toBe("implicit_single_session");
    if (resolved.kind !== "implicit_single_session") {
      throw new Error("expected implicit_single_session");
    }
    expect(resolved.session.label).toBe("后台 A");
  });

  it("returns ambiguous_multiple_sessions when auto mode meets multiple site sessions", () => {
    const resolved = resolveBalanceAuth(makeProfile(), {
      "https://new-api.example.com": [
        makeSession("sess-a", "后台 A"),
        makeSession("sess-b", "后台 B"),
      ],
    });

    expect(resolved.kind).toBe("ambiguous_multiple_sessions");
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

    expect(hint).toBe("后台会话：后台 A");
  });

  it("warns when auto mode meets multiple site sessions", () => {
    const hint = describeBalanceSessionHint(
      makeProfile(),
      {
        "https://new-api.example.com": [
          makeSession("sess-a", "后台 A"),
          makeSession("sess-b", "后台 B"),
        ],
      },
    );

    expect(hint).toBe("未选择后台会话");
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
});
