import { describe, expect, it, vi } from "vitest";
import { BalanceService, normalizeBalanceBaseUrl } from "../../services/balance-service.js";
import type { Profile } from "../../profile/types.js";
import type { SiteBalanceSession } from "../../balance/site-balance-sessions.js";

function makeProfile(url: string): Profile {
  return {
    provider: "codex",
    name: "Balance Probe",
    url,
    key: "sk-test",
  };
}

function makeJwt(payload: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.signature`;
}

function makeEncodedSessionToken(payload: string): string {
  return Buffer.from(payload).toString("base64");
}

function jsonResponse(payload: unknown, status: number = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

function textResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: async () => ({ message: body }),
    text: async () => body,
  };
}

function makeResolvedSession(overrides: Partial<SiteBalanceSession> = {}): SiteBalanceSession {
  return {
    id: "sess-a",
    label: "后台 A",
    base_url: "https://new-api.example.com",
    access_token: "access-token-a",
    user_id: "42",
    updated_at: "2026-05-05T09:00:00.000Z",
    ...overrides,
  };
}

describe("BalanceService", () => {
  it("normalizes base urls back to the site root before probing", () => {
    expect(normalizeBalanceBaseUrl("https://relay.example.com/v1/chat/completions")).toBe(
      "https://relay.example.com",
    );
    expect(normalizeBalanceBaseUrl("https://relay.example.com/anthropic/v1/messages")).toBe(
      "https://relay.example.com",
    );
  });

  it("parses DeepSeek balance_infos into normalized balance items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        is_available: true,
        balance_infos: [
          { currency: "CNY", total_balance: "21.50" },
          { currency: "USD", total_balance: "3.00" },
        ],
      }),
    );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://api.deepseek.com/v1"));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deepseek.com/user/balance",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer sk-test",
        }),
      }),
    );
    expect(result.supported).toBe(true);
    expect(result.success).toBe(true);
    expect(result.items).toEqual([
      {
        label: "CNY",
        remaining: 21.5,
        total: 21.5,
        used: null,
        unit: "CNY",
      },
      {
        label: "USD",
        remaining: 3,
        total: 3,
        used: null,
        unit: "$",
      },
    ]);
  });

  it("parses common New API quota fields with the default multiplier", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          quota: 7_500_000,
          used_quota: 2_500_000,
        },
      }),
    );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://new-api.example.com/v1"));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://new-api.example.com/api/user/self",
      expect.any(Object),
    );
    expect(result.success).toBe(true);
    expect(result.items).toEqual([
      {
        label: "USD",
        remaining: 15,
        total: 20,
        used: 5,
        unit: "$",
      },
    ]);
  });

  it("uses resolved site balance sessions for New API requests before falling back to profile.key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          quota: 1_500_000,
          used_quota: 500_000,
        },
      }),
    );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(
      makeProfile("https://new-api.example.com/v1"),
      8000,
      makeResolvedSession(),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://new-api.example.com/api/user/self",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer access-token-a",
          "New-API-User": "42",
          "Veloera-User": "42",
          "X-Api-User": "42",
          "X-User-Id": "42",
        }),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.items[0].remaining).toBe(3);
  });

  it("retries resolved New API sessions as a session cookie when bearer auth is rejected", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: false,
          message: "Unauthorized, invalid access token",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            quota: 1_500_000,
            used_quota: 500_000,
          },
        }),
      );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(
      makeProfile("https://new-api.example.com/v1"),
      8000,
      makeResolvedSession({
        access_token: "session-cookie-token",
        user_id: "65",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://new-api.example.com/api/user/self",
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: "session=session-cookie-token",
          "New-API-User": "65",
          "Veloera-User": "65",
        }),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.items[0].remaining).toBe(3);
  });

  it("parses Veloera quota fields with its dedicated multiplier", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          quota: 3_000_000,
          used_quota: 1_000_000,
        },
      }),
    );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://gateway.veloera.example.com/v1"));

    expect(result.success).toBe(true);
    expect(result.items[0]).toEqual({
      label: "USD",
      remaining: 3,
      total: 4,
      used: 1,
      unit: "$",
    });
  });

  it("parses One API quota fields with the total-minus-used semantics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          quota: 6_000_000,
          used_quota: 1_000_000,
        },
      }),
    );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://oneapi.example.com/v1"));

    expect(result.supported).toBe(true);
    expect(result.success).toBe(true);
    expect(result.items).toEqual([{
      label: "USD",
      remaining: 10,
      total: 12,
      used: 2,
      unit: "$",
    }]);
  });

  it("parses OneHub quota fields with the total-minus-used semantics", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          quota: 6_000_000,
          used_quota: 1_000_000,
        },
      }),
    );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://onehub.example.com/v1"));

    expect(result.supported).toBe(true);
    expect(result.success).toBe(true);
    expect(result.items).toEqual([{
      label: "USD",
      remaining: 10,
      total: 12,
      used: 2,
      unit: "$",
    }]);
  });

  it("parses DoneHub quota fields as remaining-plus-used totals", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          quota: 6_000_000,
          used_quota: 1_000_000,
        },
      }),
    );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://donehub.example.com/v1"));

    expect(result.supported).toBe(true);
    expect(result.success).toBe(true);
    expect(result.items).toEqual([{
      label: "USD",
      remaining: 12,
      total: 14,
      used: 2,
      unit: "$",
    }]);
  });

  it("parses Sub2API auth/me balances", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          balance: 12.34,
        },
      }),
    );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://sub2api.example.com/v1"));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://sub2api.example.com/api/v1/auth/me",
      expect.any(Object),
    );
    expect(result.success).toBe(true);
    expect(result.items).toEqual([
      {
        label: "USD",
        remaining: 12.34,
        total: null,
        used: null,
        unit: "$",
      },
    ]);
  });

  it("detects Sub2API balances from the endpoint response when the url has no platform hint", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://relay.example.com/api/v1/auth/me") {
        return jsonResponse({
          code: 0,
          message: "success",
          data: {
            balance: 12.34,
          },
        });
      }
      if (url === "https://relay.example.com/api/user/self") {
        return textResponse(404, "not found");
      }
      return textResponse(404, "not found");
    });
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://relay.example.com/v1"));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://relay.example.com/api/v1/auth/me",
      expect.any(Object),
    );
    expect(result.supported).toBe(true);
    expect(result.success).toBe(true);
    expect(result.items).toEqual([{
      label: "USD",
      remaining: 12.34,
      total: null,
      used: null,
      unit: "$",
    }]);
  });

  it("parses Sub2API subscription summary payloads into normalized balance items", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        code: 0,
        message: "success",
        data: {
          subscriptions: [
            {
              group_name: "Pro",
              status: "active",
              monthly_used_usd: 3.2,
              monthly_limit_usd: 20,
            },
          ],
        },
      }),
    );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://sub2api.example.com/v1"));

    expect(result.supported).toBe(true);
    expect(result.success).toBe(true);
    expect(result.items).toEqual([{
      label: "Pro",
      remaining: 16.8,
      total: 20,
      used: 3.2,
      unit: "$",
    }]);
  });

  it("returns an auth error when the balance endpoint rejects the API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textResponse(401, "unauthorized"));
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://new-api.example.com/v1"));

    expect(result.supported).toBe(true);
    expect(result.success).toBe(false);
    expect(result.message).toContain("鉴权失败");
  });

  it("returns a profile schema error when the site requires a user id header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      textResponse(400, "missing required New-API-User header"),
    );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://new-api.example.com/v1"));

    expect(result.supported).toBe(true);
    expect(result.success).toBe(false);
    expect(result.message).toContain("需要用户 ID");
  });

  it("maps 200 success:false New API responses that require a user id header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: false,
        message: "missing required New-API-User header",
      }),
    );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://new-api.example.com/v1"));

    expect(result.supported).toBe(true);
    expect(result.success).toBe(false);
    expect(result.message).toContain("需要用户 ID");
  });

  it("falls back from a mismatched resolved session user id to the probed session user id", async () => {
    const sessionToken = makeEncodedSessionToken("linuxdo_144408");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Authorization === `Bearer ${sessionToken}`) {
        return jsonResponse({
          success: false,
          message: "Unauthorized, invalid access token",
        });
      }
      if (headers.Cookie === `session=${sessionToken}` && headers["New-API-User"] === "159") {
        return jsonResponse({
          success: false,
          message: "missing required New-API-User header",
        });
      }
      if (headers.Cookie === `session=${sessionToken}` && headers["New-API-User"] === "144408") {
        return jsonResponse({
          success: true,
          data: {
            quota: 1_500_000,
            used_quota: 500_000,
          },
        });
      }
      return textResponse(400, "unexpected request");
    });
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(
      makeProfile("https://new-api.example.com/v1"),
      8000,
      makeResolvedSession({
        access_token: sessionToken,
        user_id: "159",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://new-api.example.com/api/user/self",
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: sessionToken,
          "New-API-User": "159",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://new-api.example.com/api/user/self",
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: `session=${sessionToken}`,
          "New-API-User": "159",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://new-api.example.com/api/user/self",
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: `session=${sessionToken}`,
          "New-API-User": "144408",
        }),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.items[0].remaining).toBe(3);
  });

  it("probes a session user id when the resolved session has no explicit user id", async () => {
    const sessionToken = makeEncodedSessionToken("linuxdo_8899");
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      if (headers.Authorization === `Bearer ${sessionToken}`) {
        return jsonResponse({
          success: false,
          message: "Unauthorized, invalid access token",
        });
      }
      if (headers.Cookie === `session=${sessionToken}` && !headers["New-API-User"]) {
        return jsonResponse({
          success: false,
          message: "missing required New-API-User header",
        });
      }
      if (headers.Cookie === `session=${sessionToken}` && headers["New-API-User"] === "8899") {
        return jsonResponse({
          success: true,
          data: {
            quota: 2_500_000,
            used_quota: 500_000,
          },
        });
      }
      return textResponse(400, "unexpected request");
    });
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(
      makeProfile("https://new-api.example.com/v1"),
      8000,
      makeResolvedSession({
        access_token: sessionToken,
        user_id: "",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://new-api.example.com/api/user/self",
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: `session=${sessionToken}`,
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://new-api.example.com/api/user/self",
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: `session=${sessionToken}`,
          "New-API-User": "8899",
        }),
      }),
    );
    expect(result.supported).toBe(true);
    expect(result.success).toBe(true);
    expect(result.items[0].remaining).toBe(5);
  });

  it("retries with decoded New API user headers when the token is a jwt", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        jsonResponse({
          success: false,
          message: "missing New-Api-User",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          success: true,
          data: {
            quota: 2_500_000,
            used_quota: 500_000,
          },
        }),
      );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query({
      ...makeProfile("https://new-api.example.com/v1"),
      key: makeJwt({ id: 42 }),
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://new-api.example.com/api/user/self",
      expect.objectContaining({
        headers: expect.objectContaining({
          "New-API-User": "42",
          "Veloera-User": "42",
          "voapi-user": "42",
          "User-id": "42",
          "Rix-Api-User": "42",
          "neo-api-user": "42",
        }),
      }),
    );
    expect(result.supported).toBe(true);
    expect(result.success).toBe(true);
    expect(result.items).toEqual([
      {
        label: "USD",
        remaining: 5,
        total: 6,
        used: 1,
        unit: "$",
      },
    ]);
  });

  it("maps 200 success:false New API auth failures to the standard auth error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: false,
        message: "invalid token",
      }),
    );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://new-api.example.com/v1"));

    expect(result.supported).toBe(true);
    expect(result.success).toBe(false);
    expect(result.message).toContain("鉴权失败");
  });

  it("explains when a New API balance endpoint rejects an sk api key as an access token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: false,
        message: "Unauthorized, invalid access token",
      }),
    );
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query({
      ...makeProfile("https://new-api.example.com/v1"),
      key: "sk-live-test",
    });

    expect(result.supported).toBe(true);
    expect(result.success).toBe(false);
    expect(result.message).toContain("Access Token");
    expect(result.message).toContain("sk- API Key");
  });

  it("summarizes New API challenge html responses instead of reporting a generic auth error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      textResponse(
        403,
        "<html><title>Just a moment...</title><form id=\"challenge-form\"></form></html>",
      ),
    );
    const service = new BalanceService(fetchMock as typeof fetch);

    const result = await service.query(makeProfile("https://new-api.example.com/v1"));

    expect(result.supported).toBe(true);
    expect(result.success).toBe(false);
    expect(result.message).toContain("挑战");
    expect(result.message).not.toContain("API Key");
  });

  it("parses wrapped camelCase New API quota fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          data: {
            remainQuota: 5_000_000,
            usedQuota: 1_000_000,
            totalQuota: 6_000_000,
          },
        },
      }),
    );
    const service = new BalanceService(fetchMock as typeof fetch);

    const result = await service.query(makeProfile("https://one-api.example.com/v1"));

    expect(result.supported).toBe(true);
    expect(result.success).toBe(true);
    expect(result.items).toEqual([
      {
        label: "USD",
        remaining: 10,
        total: 12,
        used: 2,
        unit: "$",
      },
    ]);
  });

  it("treats unlimited New API payloads as successful checks", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          unlimitedQuota: true,
        },
      }),
    );
    const service = new BalanceService(fetchMock as typeof fetch);

    const result = await service.query(makeProfile("https://anyrouter.example.com/v1"));

    expect(result.supported).toBe(true);
    expect(result.success).toBe(true);
    expect(result.items).toEqual([]);
    expect(result.message).toContain("无限额度");
  });

  it("reports unrecognized payloads instead of guessing balance fields", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        data: {
          plan: "pro",
        },
      }),
    );
    const service = new BalanceService(fetchMock as typeof fetch);

    const result = await service.query(makeProfile("https://one-api.example.com/v1"));

    expect(result.supported).toBe(true);
    expect(result.success).toBe(false);
    expect(result.message).toContain("未识别余额字段");
  });

  it("returns unsupported for unknown sites instead of misclassifying generic 401 responses", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://relay.example.com/api/v1/auth/me") {
        return textResponse(404, "not found");
      }
      if (url === "https://relay.example.com/api/user/self") {
        return textResponse(401, "unauthorized");
      }
      return textResponse(404, "not found");
    });
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://relay.example.com/v1"));

    expect(result.supported).toBe(false);
    expect(result.success).toBe(false);
    expect(result.message).toContain("暂未适配");
  });

  it("uses New API response headers to avoid treating a generic 502 as Sub2API", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "https://relay.example.com/api/user/self") {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ "X-New-API-Version": "v1.0.0-rc.20" }),
          text: async () => JSON.stringify({
            success: true,
            data: { quota: 1_000_000, used_quota: 250_000 },
          }),
        };
      }
      if (url === "https://relay.example.com/api/v1/auth/me") {
        return textResponse(502, "bad gateway");
      }
      return textResponse(404, "not found");
    });
    const service = new BalanceService(fetchMock as unknown as typeof fetch);

    const result = await service.query(makeProfile("https://relay.example.com/v1"));

    expect(fetchMock.mock.calls[0][0]).toBe("https://relay.example.com/api/user/self");
    expect(result.success).toBe(true);
    expect(result.items[0].remaining).toBe(2);
  });

  it("refreshes an expired Sub2API session before reading the balance", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/v1/auth/refresh")) {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBe(JSON.stringify({ refresh_token: "refresh-a" }));
        return jsonResponse({
          data: {
            access_token: "access-b",
            refresh_token: "refresh-b",
            expires_in: 3600,
          },
        });
      }
      return jsonResponse({ data: { balance: 8.5 } });
    });
    const service = new BalanceService(fetchMock as unknown as typeof fetch);
    const updated = vi.fn();

    const result = await service.query(
      makeProfile("https://sub2api.example.com/v1"),
      8000,
      makeResolvedSession({
        base_url: "https://sub2api.example.com",
        access_token: "access-a",
        refresh_token: "refresh-a",
        token_expires_at: Date.now() - 1000,
      }),
      { onSessionUpdated: updated },
    );

    expect(fetchMock.mock.calls[0][0]).toBe("https://sub2api.example.com/api/v1/auth/refresh");
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer access-b" }),
    }));
    expect(updated).toHaveBeenCalledWith(expect.objectContaining({
      access_token: "access-b",
      refresh_token: "refresh-b",
    }));
    expect(result.success).toBe(true);
    expect(result.items[0].remaining).toBe(8.5);
  });

  it("marks official OpenAI-compatible vendors without public balance APIs as unsupported", async () => {
    const fetchMock = vi.fn();
    const service = new BalanceService(fetchMock as typeof fetch);

    const result = await service.query(makeProfile("https://api.openai.com/v1"));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.supported).toBe(false);
    expect(result.success).toBe(false);
    expect(result.message).toContain("不提供公开余额查询");
  });

  it("uses AIHubMix raw management authorization and parses raw quota", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: true,
      data: { quota: 1_250_000, used_quota: 250_000 },
    }));
    const service = new BalanceService(fetchMock as typeof fetch);

    const result = await service.query(
      makeProfile("https://console.aihubmix.com/v1"),
      8000,
      makeResolvedSession({ access_token: "aihub-access", user_id: "" }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://aihubmix.com/api/user/self",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "aihub-access" }),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.items[0]).toMatchObject({ remaining: 2.5, used: 0.5, total: 3 });
  });

  it("parses VoAPI v2 basic and bound balances with raw authorization", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      code: 0,
      data: {
        basicBalance: "2.25",
        bindBalance: "1.75",
        usedBasicBalance: "0.5",
        usedBindBalance: "0.25",
      },
    }));
    const service = new BalanceService(fetchMock as typeof fetch);

    const result = await service.query(
      makeProfile("https://voapi-v2.example.com/v1"),
      8000,
      makeResolvedSession({ access_token: "voapi-jwt", user_id: "" }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://voapi-v2.example.com/api/user/info",
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "voapi-jwt" }),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.items[0]).toMatchObject({ remaining: 4, used: 0.75, total: 4.75 });
  });

  it("parses SharedChat Codex subscription balance from a saved Cookie", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      code: 1,
      data: {
        codex: {
          subscriptions: {
            subTypeName: "Codex Pro",
            amountLimit: 50,
            usedAmount: 12.5,
            remainingAmount: 37.5,
          },
        },
      },
    }));
    const service = new BalanceService(fetchMock as typeof fetch);

    const result = await service.query(
      makeProfile("https://new.sharedchat.cc/codex"),
      8000,
      makeResolvedSession({
        base_url: "https://new.sharedchat.cc",
        access_token: "sharedchat_session=cookie-value",
        user_id: "",
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://new.sharedchat.cc/frontend-api/vibe-code/quota",
      expect.objectContaining({
        headers: expect.objectContaining({ Cookie: "sharedchat_session=cookie-value" }),
      }),
    );
    expect(result.success).toBe(true);
    expect(result.items[0]).toMatchObject({
      label: "Codex Pro",
      remaining: 37.5,
      used: 12.5,
      total: 50,
    });
  });
});
