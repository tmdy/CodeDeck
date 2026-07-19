import { describe, expect, it, vi } from "vitest";
import type { SiteBalanceSession } from "../../balance/site-balance-sessions.js";
import {
  CheckinService,
  type CheckinDiagnosticAttempt,
} from "../../services/checkin-service.js";

function makeSession(overrides: Partial<SiteBalanceSession> = {}): SiteBalanceSession {
  return {
    id: "account-a",
    label: "账号1",
    base_url: "https://new-api.example.com",
    access_token: "access-token-a",
    user_id: "42",
    auto_checkin_enabled: true,
    updated_at: "",
    ...overrides,
  };
}

function jsonResponse(payload: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestHeaders(init?: RequestInit): Record<string, string> {
  return (init?.headers ?? {}) as Record<string, string>;
}

function isStatusRequest(input: RequestInfo | URL, init?: RequestInit): boolean {
  return init?.method === "GET" && String(input).includes("/api/user/checkin?month=");
}

function statusPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    success: true,
    data: {
      enabled: true,
      captcha_enabled: false,
      stats: { checked_in_today: false },
      ...overrides,
    },
  };
}

describe("CheckinService", () => {
  it("preflights status and checks in with the same raw access-token headers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => (
      isStatusRequest(input, init)
        ? jsonResponse(statusPayload())
        : jsonResponse({
          success: true,
          message: "签到成功",
          data: { quota_awarded: 12 },
        })
    ));

    const result = await new CheckinService(fetchMock as unknown as typeof fetch)
      .checkin(makeSession());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("/api/user/checkin?month=");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
    expect(fetchMock.mock.calls[1][0]).toBe("https://new-api.example.com/api/user/checkin");
    expect(fetchMock.mock.calls[1][1]).toEqual(expect.objectContaining({ method: "POST" }));
    for (const call of fetchMock.mock.calls) {
      expect(requestHeaders(call[1])).toEqual(expect.objectContaining({
        Authorization: "access-token-a",
        "New-API-User": "42",
        "Veloera-User": "42",
        "User-id": "42",
        "X-Api-User": "42",
        "X-User-Id": "42",
      }));
    }
    expect(result).toMatchObject({ status: "success", success: true, reward: "12" });
  });

  it("falls back from raw authorization to Bearer before performing the action", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const authorization = requestHeaders(init).Authorization;
      if (authorization !== "Bearer access-token-a") {
        return jsonResponse({ success: false, message: "invalid access token" });
      }
      return isStatusRequest(input, init)
        ? jsonResponse(statusPayload())
        : jsonResponse({ success: true, message: "签到成功" });
    });

    const result = await new CheckinService(fetchMock as unknown as typeof fetch)
      .checkin(makeSession());

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(requestHeaders(fetchMock.mock.calls[0][1]).Authorization).toBe("access-token-a");
    expect(requestHeaders(fetchMock.mock.calls[1][1]).Authorization).toBe("Bearer access-token-a");
    expect(requestHeaders(fetchMock.mock.calls[2][1]).Authorization).toBe("Bearer access-token-a");
    expect(result.status).toBe("success");
  });

  it("returns already checked from status without sending a POST", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(statusPayload({
      stats: { checked_in_today: true },
    })));

    const result = await new CheckinService(fetchMock as unknown as typeof fetch)
      .checkin(makeSession());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
    expect(result).toMatchObject({ status: "already_checked", success: true });
  });

  it("requires manual handling when status enables an image captcha", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(statusPayload({
      captcha_enabled: true,
    })));

    const result = await new CheckinService(fetchMock as unknown as typeof fetch)
      .checkin(makeSession());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: "manual_required",
      error_code: "turnstile_required",
      manual_url: "https://new-api.example.com/console/personal",
    });
    expect(result.message).toContain("图形验证码");
  });

  it("returns only the confirmed Cookie mode as verification metadata", async () => {
    const savedCookie = "session=cookie-value";
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = requestHeaders(init);
      return headers.Cookie === savedCookie
        ? jsonResponse(statusPayload({ captcha_enabled: true }))
        : jsonResponse({ success: false, message: "not logged in" }, 401);
    });

    const result = await new CheckinService(fetchMock as unknown as typeof fetch)
      .checkin(makeSession({ access_token: savedCookie }));

    expect(result).toMatchObject({
      status: "manual_required",
      verification: { cookie_mode: "raw" },
    });
    expect(JSON.stringify(result.verification)).not.toContain("cookie-value");
  });

  it("uses an authenticated Cookie business failure instead of earlier token errors", async () => {
    const events: CheckinDiagnosticAttempt[] = [];
    const savedToken = "token=cookie-value";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = requestHeaders(init);
      if (headers.Cookie === `session=${savedToken}`) {
        return isStatusRequest(input, init)
          ? jsonResponse(statusPayload())
          : jsonResponse({ success: false, message: "签到失败，请稍后重试" });
      }
      if (headers.Cookie) {
        return jsonResponse({ success: false, message: "not logged in" }, 401);
      }
      return jsonResponse({ success: false, message: "invalid access token" });
    });

    const result = await new CheckinService(fetchMock as unknown as typeof fetch).checkin(
      makeSession({ access_token: savedToken }),
      10_000,
      {
        runId: "abcdef123456",
        trigger: "manual",
        onDiagnostic: (event) => events.push(event),
      },
    );

    expect(result).toMatchObject({
      status: "failed",
      error_code: "business_rejected",
      message: "签到失败，请稍后重试",
      diagnostic_run_id: "abcdef123456",
    });
    expect(events.at(-1)).toMatchObject({
      stage: "checkin_cookie",
      cookie_mode: "session_wrapped",
      http_status: 200,
      message_code: "business_rejected",
      message_preview: "签到失败，请稍后重试",
    });
    expect(events.some((event) => event.cookie_mode === "token_wrapped")).toBe(false);
  });

  it("uses the Metapi-compatible session wrapper for a named token cookie", async () => {
    const savedToken = "token=cookie-value";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = requestHeaders(init);
      if (headers.Cookie === `session=${savedToken}`) {
        return isStatusRequest(input, init)
          ? jsonResponse(statusPayload())
          : jsonResponse({ success: true, message: "签到成功" });
      }
      return headers.Cookie
        ? jsonResponse({ success: false, message: "not logged in" }, 401)
        : jsonResponse({ success: false, message: "invalid access token" });
    });

    const result = await new CheckinService(fetchMock as unknown as typeof fetch)
      .checkin(makeSession({ access_token: savedToken }));

    const cookieHeaders = fetchMock.mock.calls
      .map((call) => requestHeaders(call[1]).Cookie)
      .filter(Boolean);
    expect(cookieHeaders).toContain(savedToken);
    expect(cookieHeaders).toContain(`session=${savedToken}`);
    expect(result.status).toBe("success");
  });

  it("discovers a corrected user id and reuses the same cookie transport", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = requestHeaders(init);
      if (headers.Authorization) {
        return jsonResponse({ success: false, message: "invalid access token" });
      }
      if (headers.Cookie !== "session=session-cookie-a") {
        return jsonResponse({ success: false, message: "not logged in" }, 401);
      }
      if (url.endsWith("/api/user/self")) {
        return jsonResponse({ success: true, data: { id: 99 } });
      }
      if (isStatusRequest(input, init) && headers["New-API-User"] === "42") {
        return jsonResponse({ success: false, message: "User ID mismatch" }, 401);
      }
      if (isStatusRequest(input, init) && headers["New-API-User"] === "99") {
        return jsonResponse(statusPayload());
      }
      if (url.endsWith("/api/user/checkin") && headers["New-API-User"] === "99") {
        return jsonResponse({ success: true, message: "签到成功" });
      }
      return jsonResponse({ success: false, message: "not logged in" }, 401);
    });

    const result = await new CheckinService(fetchMock as unknown as typeof fetch)
      .checkin(makeSession({ access_token: "session-cookie-a", user_id: "42" }));

    expect(result.status).toBe("success");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://new-api.example.com/api/user/self",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Cookie: "session=session-cookie-a" }),
      }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://new-api.example.com/api/user/checkin",
      expect.objectContaining({
        headers: expect.objectContaining({
          Cookie: "session=session-cookie-a",
          "New-API-User": "99",
        }),
      }),
    );
  });

  it("discovers a missing user id before status and action requests", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = requestHeaders(init);
      if (url.endsWith("/api/user/self") && headers.Authorization === "access-token-a") {
        return jsonResponse({ success: true, data: { id: 77 } });
      }
      if (isStatusRequest(input, init) && headers["New-API-User"] === "77") {
        return jsonResponse(statusPayload());
      }
      if (url.endsWith("/api/user/checkin") && headers["New-API-User"] === "77") {
        return jsonResponse({ success: true, message: "签到成功" });
      }
      return jsonResponse({ success: false, message: "not logged in" }, 401);
    });

    const result = await new CheckinService(fetchMock as unknown as typeof fetch)
      .checkin(makeSession({ user_id: "" }));

    expect(result.status).toBe("success");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls.every((call) => (
      requestHeaders(call[1]).Authorization === "access-token-a"
    ))).toBe(true);
  });

  it("falls back to the legacy sign-in endpoint only when check-in is absent", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const headers = requestHeaders(init);
      if (url.endsWith("/api/user/sign_in") && headers.Cookie === "session=session-cookie-a") {
        return jsonResponse({ success: true, message: "签到成功" });
      }
      return new Response("not found", { status: 404 });
    });

    const result = await new CheckinService(fetchMock as unknown as typeof fetch)
      .checkin(makeSession({ access_token: "session-cookie-a" }));

    expect(result.status).toBe("success");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/api/user/sign_in")))
      .toBe(true);
    const firstSignInIndex = fetchMock.mock.calls.findIndex((call) => (
      String(call[0]).endsWith("/api/user/sign_in")
    ));
    expect(fetchMock.mock.calls.slice(0, firstSignInIndex).every((call) => (
      String(call[0]).includes("/api/user/checkin")
    ))).toBe(true);
  });

  it("does not mistake a GET status payload for a successful check-in action", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isStatusRequest(input, init)) {
        return new Response("method not allowed", { status: 405 });
      }
      if (String(input).endsWith("/api/user/checkin") && init?.method === "POST") {
        return new Response("method not allowed", { status: 405 });
      }
      if (String(input).endsWith("/api/user/checkin") && init?.method === "GET") {
        return jsonResponse(statusPayload());
      }
      return new Response("not found", { status: 404 });
    });

    const result = await new CheckinService(fetchMock as unknown as typeof fetch)
      .checkin(makeSession());

    expect(result.success).toBe(false);
    expect(result.status).toBe("unsupported");
  });

  it("returns an actionable manual result for a Turnstile response", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      success: false,
      message: "Turnstile token validation failed",
    }, 403));

    const result = await new CheckinService(fetchMock as unknown as typeof fetch)
      .checkin(makeSession());

    expect(result).toMatchObject({
      status: "manual_required",
      success: false,
      manual_url: "https://new-api.example.com/console/personal",
      error_code: "turnstile_required",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("marks missing status, action, and legacy endpoints as unsupported", async () => {
    const fetchMock = vi.fn(async () => new Response("not found", { status: 404 }));

    const result = await new CheckinService(fetchMock as unknown as typeof fetch)
      .checkin(makeSession());

    expect(result.status).toBe("unsupported");
    expect(result.error_code).toBe("endpoint_missing");
    expect(result.manual_url).toContain("/console/personal");
  });

  it("does not retry network failures as alternate credential requests", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network offline"));

    const result = await new CheckinService(fetchMock as unknown as typeof fetch)
      .checkin(makeSession());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe("failed");
    expect(result.error_code).toBe("network_error");
    expect(result.message).toContain("network offline");
  });

  it("uses deterministic auth precedence when no transport authenticates", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = requestHeaders(init);
      if (headers.Authorization === "access-token-a") {
        return jsonResponse({ success: false, message: "invalid access token" });
      }
      return jsonResponse({
        success: false,
        message: "Unauthorized, not logged in and no access token provided with a much longer message",
      }, 401);
    });

    const result = await new CheckinService(fetchMock as unknown as typeof fetch)
      .checkin(makeSession());

    expect(result.error_code).toBe("access_token_invalid");
    expect(result.message).toContain("所有已保存凭证形式");
    expect(result.message).not.toContain("much longer message");
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith("/api/user/sign_in")))
      .toBe(false);
  });

  it("logs only a redacted bounded JSON business-message preview", async () => {
    const events: CheckinDiagnosticAttempt[] = [];
    const secret = "super-secret-token";
    const userId = "8675309";
    const longValue = "abcdefghijklmnopqrstuvwxyz0123456789";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const headers = requestHeaders(init);
      if (headers.Cookie === `session=${secret}`) {
        return isStatusRequest(input, init)
          ? jsonResponse(statusPayload())
          : jsonResponse({
            success: false,
            message: `user ${userId} ${secret} foo@example.com https://secret.test/${longValue} ${longValue}`,
          });
      }
      return headers.Cookie
        ? jsonResponse({ success: false, message: "not logged in" }, 401)
        : jsonResponse({ success: false, message: "invalid access token" });
    });

    const result = await new CheckinService(fetchMock as unknown as typeof fetch).checkin(
      makeSession({ access_token: secret, user_id: userId }),
      10_000,
      {
        runId: "abcdef123456",
        trigger: "automatic",
        onDiagnostic: (event) => events.push(event),
      },
    );

    expect(events[0]).toMatchObject({
      run_id: "abcdef123456",
      trigger: "automatic",
      stage: "checkin_status",
      authorization_mode: "raw",
      endpoint_path: expect.stringContaining("/api/user/checkin?month="),
    });
    const businessEvent = events.find((event) => event.message_code === "business_rejected");
    const messagePreview = businessEvent?.message_preview ?? "";
    expect(messagePreview).toContain("[REDACTED]");
    expect(messagePreview).toContain("[EMAIL]");
    expect(messagePreview).toContain("[URL]");
    expect(messagePreview.length).toBeLessThanOrEqual(160);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain(userId);
    expect(serialized).not.toContain("foo@example.com");
    expect(serialized).not.toContain("https://secret.test");
    expect(serialized).not.toContain(longValue);
    expect(result.error_code).toBe("business_rejected");
    expect(result.diagnostic_run_id).toBe("abcdef123456");
    expect(result.message).not.toContain(secret);
    expect(result.message).not.toContain(userId);
  });

  it("checks in through VoAPI v2 stats and submit endpoints", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).endsWith("/api/check_in/stats")) {
        return jsonResponse({ code: 0, data: { todaySigned: false, nextAmount: "1.25" } });
      }
      return jsonResponse({ code: 0, data: { amount: "1.25" } });
    });

    const result = await new CheckinService(fetchMock as unknown as typeof fetch).checkin(
      makeSession({
        base_url: "https://voapi-v2.example.com",
        access_token: "voapi-jwt",
        user_id: "",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://voapi-v2.example.com/api/check_in/stats");
    expect(fetchMock.mock.calls[0][1]).toEqual(expect.objectContaining({ method: "GET" }));
    expect(requestHeaders(fetchMock.mock.calls[0][1]).Authorization).toBe("voapi-jwt");
    expect(fetchMock.mock.calls[1][0]).toBe("https://voapi-v2.example.com/api/check_in");
    expect(result).toMatchObject({ status: "success", success: true, reward: "$1.25" });
  });

  it("marks VoAPI v2 already-signed responses as completed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      code: 0,
      data: { todaySigned: true },
    }));

    const result = await new CheckinService(fetchMock as unknown as typeof fetch).checkin(
      makeSession({ base_url: "https://voapi-v2.example.com", access_token: "voapi-jwt" }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "already_checked", success: true });
  });

  it("reports account platforms without a check-in API as unsupported", async () => {
    const fetchMock = vi.fn();

    const result = await new CheckinService(fetchMock as typeof fetch).checkin(
      makeSession({ base_url: "https://console.aihubmix.com", user_id: "" }),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: "unsupported", success: false });
    expect(result.message).toContain("不提供用户签到接口");
  });

  it("uses AnyRouter's native top-up page for manual verification", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      success: false,
      message: "Turnstile token 为空",
    }));

    const result = await new CheckinService(fetchMock as unknown as typeof fetch).checkin(
      makeSession({ base_url: "https://anyrouter.top" }),
    );

    expect(result).toMatchObject({
      status: "manual_required",
      manual_url: "https://anyrouter.top/console/topup",
    });
  });
});
